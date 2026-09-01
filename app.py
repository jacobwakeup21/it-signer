import os
import sys
import io
import re
import json
import base64
import socket
import logging
import zipfile
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_file, send_from_directory, redirect, url_for
import pymupdf
import qrcode
from PIL import Image

# Initialize Flask app
app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['MAX_CONTENT_LENGTH'] = 64 * 1024 * 1024  # 64MB max upload

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / 'config.json'

DEFAULT_CONFIG = {
    "host": "0.0.0.0",
    "port": 5000,
    "public_url": "",
    "pending_dir": "pending",
    "signed_dir": "signed",
    "archive_dir": "pending/.archive",
    "dual_signature": True,
    "signature_placement": {
        "recipient": {
            "page": -1,
            "x": 320,
            "y": 630,
            "width": 210,
            "height": 70,
            "label": "Employee / Recipient",
            "add_timestamp": True,
            "timestamp_fontsize": 7.5
        },
        "issuer": {
            "page": -1,
            "x": 60,
            "y": 630,
            "width": 200,
            "height": 70,
            "label": "IT Admin / Issuer",
            "add_timestamp": True,
            "timestamp_fontsize": 7.5
        }
    },
    "auto_archive_pending": True,
    "github_repo": "",
    "github_token": "",
    "github_branch": "main",
    "auto_delete_github_pending": True,
    "auto_upload_github_signed": True
}

def load_config():
    """Load configuration from JSON file or create with defaults."""
    if not CONFIG_FILE.exists():
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            merged = DEFAULT_CONFIG.copy()
            # Normalize legacy single placement to recipient
            if "signature_placement" in data:
                pl = data["signature_placement"]
                if "x" in pl and "recipient" not in pl:
                    data["signature_placement"] = {
                        "recipient": pl,
                        "issuer": DEFAULT_CONFIG["signature_placement"]["issuer"]
                    }
            merged.update(data)
            return merged
    except Exception as e:
        print(f"Error loading config.json: {e}, using defaults.")
        return DEFAULT_CONFIG.copy()

def save_config(config_data):
    """Save configuration to JSON file."""
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=4)
        return True
    except Exception as e:
        print(f"Error saving config.json: {e}")
        return False

def get_resolved_path(folder_path_str):
    """Resolve relative or absolute folder paths (supports OneDrive & env vars)."""
    expanded = os.path.expandvars(os.path.expanduser(str(folder_path_str).strip()))
    p = Path(expanded)
    if not p.is_absolute():
        p = BASE_DIR / p
    p.mkdir(parents=True, exist_ok=True)
    return p

def get_local_ips():
    """Discover all accessible local IPv4 addresses."""
    ips = []
    
    # 1. Primary outgoing route IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        primary = s.getsockname()[0]
        s.close()
        if primary and primary not in ips and not primary.startswith('127.'):
            ips.append(primary)
    except Exception:
        pass

    # 2. Hostname resolution
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if ip not in ips and not ip.startswith('127.') and ':' not in ip:
                ips.append(ip)
    except Exception:
        pass

    if not ips:
        ips.append('127.0.0.1')
    return ips

def format_file_size(size_bytes):
    """Format file size in human-readable units."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.2f} MB"

def get_github_config():
    """Retrieve normalized GitHub settings from config or environment variables."""
    cfg = load_config()
    raw_repo = os.environ.get('GITHUB_REPO') or cfg.get('github_repo', '')
    token = os.environ.get('GITHUB_TOKEN') or cfg.get('github_token', '')
    branch = os.environ.get('GITHUB_BRANCH') or cfg.get('github_branch', 'main')
    auto_delete = cfg.get('auto_delete_github_pending', True)
    auto_upload = cfg.get('auto_upload_github_signed', True)

    repo = raw_repo.strip()
    if repo.startswith('http://') or repo.startswith('https://'):
        repo = re.sub(r'^https?://[^/]+/', '', repo)
    repo = re.sub(r'\.git$', '', repo).strip('/')

    return {
        "repo": repo,
        "token": token.strip(),
        "branch": branch.strip() or "main",
        "auto_delete_github_pending": auto_delete,
        "auto_upload_github_signed": auto_upload,
        "is_configured": bool(repo and token)
    }

def github_api_request(method, endpoint, data=None, token=None):
    """Execute a GitHub REST API v3 request."""
    gh_cfg = get_github_config()
    auth_token = token or gh_cfg['token']
    if not auth_token:
        raise ValueError("GitHub Personal Access Token is not configured.")

    url = f"https://api.github.com/{endpoint.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "IT-Handover-Signer/1.0",
        "X-GitHub-Api-Version": "2022-11-28"
    }

    body_bytes = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body_bytes = json.dumps(data).encode('utf-8')

    req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_body = resp.read().decode('utf-8')
            return json.loads(resp_body) if resp_body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        try:
            err_json = json.loads(err_body)
            msg = err_json.get('message', err_body)
        except Exception:
            msg = err_body
        raise RuntimeError(f"GitHub API error ({e.code}): {msg}")
    except Exception as e:
        raise RuntimeError(f"Network error connecting to GitHub: {str(e)}")

def github_test_connection(repo=None, token=None):
    """Test connection to GitHub repository."""
    gh = get_github_config()
    target_repo = repo or gh['repo']
    target_token = token or gh['token']
    if not target_repo or not target_token:
        return {"success": False, "error": "Both repository (owner/repo) and GitHub token must be provided."}

    clean_repo = target_repo.strip()
    if clean_repo.startswith('http://') or clean_repo.startswith('https://'):
        clean_repo = re.sub(r'^https?://[^/]+/', '', clean_repo)
    clean_repo = re.sub(r'\.git$', '', clean_repo).strip('/')

    try:
        data = github_api_request("GET", f"repos/{clean_repo}", token=target_token)
        return {
            "success": True,
            "full_name": data.get("full_name"),
            "default_branch": data.get("default_branch", "main"),
            "private": data.get("private", False),
            "message": f"Successfully connected to GitHub repository '{clean_repo}'"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

def github_list_pending_files():
    """List all files in GitHub repo's pending directory."""
    gh = get_github_config()
    if not gh['is_configured']:
        return []
    try:
        endpoint = f"repos/{gh['repo']}/contents/pending?ref={gh['branch']}"
        items = github_api_request("GET", endpoint)
        if isinstance(items, list):
            files = []
            for item in items:
                if item.get('type') == 'file' and item.get('name') != '.gitkeep':
                    files.append({
                        "name": item.get('name'),
                        "path": item.get('path'),
                        "sha": item.get('sha'),
                        "size": item.get('size', 0),
                        "size_formatted": format_file_size(item.get('size', 0)),
                        "download_url": item.get('download_url'),
                        "html_url": item.get('html_url')
                    })
            return files
        return []
    except Exception as e:
        if "404" in str(e):
            return []
        print(f"Error listing GitHub pending files: {e}")
        return []

def github_delete_file(path_in_repo, sha=None, commit_msg=None):
    """Delete a file from GitHub repository."""
    gh = get_github_config()
    if not gh['is_configured']:
        raise ValueError("GitHub integration is not configured.")

    clean_path = path_in_repo.lstrip('/')
    if not sha:
        endpoint = f"repos/{gh['repo']}/contents/{clean_path}?ref={gh['branch']}"
        item = github_api_request("GET", endpoint)
        sha = item.get('sha')
        if not sha:
            raise RuntimeError(f"Could not retrieve SHA for {clean_path}")

    filename = Path(clean_path).name
    msg = commit_msg or f"Delete {filename} from pending folder via IT Handover Signer"
    payload = {
        "message": msg,
        "sha": sha,
        "branch": gh['branch']
    }
    return github_api_request("DELETE", f"repos/{gh['repo']}/contents/{clean_path}", data=payload)

def github_upload_file(path_in_repo, file_bytes, commit_msg=None):
    """Upload or update a file in GitHub repository."""
    gh = get_github_config()
    if not gh['is_configured']:
        raise ValueError("GitHub integration is not configured.")

    clean_path = path_in_repo.lstrip('/')
    filename = Path(clean_path).name
    b64_content = base64.b64encode(file_bytes).decode('ascii')

    payload = {
        "message": commit_msg or f"Add signed document {filename} via IT Handover Signer",
        "content": b64_content,
        "branch": gh['branch']
    }

    try:
        existing = github_api_request("GET", f"repos/{gh['repo']}/contents/{clean_path}?ref={gh['branch']}")
        if isinstance(existing, dict) and "sha" in existing:
            payload["sha"] = existing["sha"]
    except Exception:
        pass

    return github_api_request("PUT", f"repos/{gh['repo']}/contents/{clean_path}", data=payload)

def get_pdf_metadata(filepath):
    """Extract page count and basic metadata from PDF using PyMuPDF."""
    try:
        doc = pymupdf.open(str(filepath))
        page_count = len(doc)
        doc.close()
        return page_count
    except Exception:
        return 1

def extract_pdf_metadata(doc_or_path):
    """Extract employee name, email, hardware, date, and doc ID from PDF text."""
    should_close = False
    if isinstance(doc_or_path, (str, Path)):
        try:
            doc = pymupdf.open(str(doc_or_path))
            should_close = True
        except Exception:
            return {}
    else:
        doc = doc_or_path

    full_text = ''
    try:
        for page in doc:
            full_text += page.get_text('text') + '\n'
    except Exception:
        pass
    finally:
        if should_close:
            doc.close()

    meta = {
        'employee_name': '',
        'email': '',
        'username': '',
        'location': '',
        'hardware': [],
        'date': '',
        'doc_number': '',
        'issuer_name': ''
    }

    if not full_text.strip():
        return meta

    # 1. Employee Name
    given_match = re.search(r'Given\s*name\s*\n+([^\n\r]+)', full_text, re.I)
    surname_match = re.search(r'Surname\s*\n+([^\n\r]+)', full_text, re.I)
    if given_match and surname_match:
        meta['employee_name'] = f"{given_match.group(1).strip()} {surname_match.group(1).strip()}".strip()

    if not meta['employee_name']:
        name_match = re.search(r'(?:Employee\s*Name|Recipient|Employee|Name|User):\s*([^\n\r,]+)', full_text, re.I)
        if name_match:
            meta['employee_name'] = name_match.group(1).strip()

    # 2. Email
    email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', full_text)
    if email_match:
        meta['email'] = email_match.group(0).strip()

    # 3. Windows User / Username
    user_match = re.search(r'(?:Windows\s*User|Username|User ID|EMP-\w+):\s*([^\n\r]+)', full_text, re.I)
    if not user_match:
        user_match = re.search(r'([A-Z0-9_\.-]+\\[a-zA-Z0-9_\.-]+)', full_text)
    if user_match:
        meta['username'] = user_match.group(1).strip() if hasattr(user_match, 'group') else user_match

    # 4. Location
    loc_match = re.search(r'Location\s*[:\n]+([^\n\r]+)', full_text, re.I)
    if loc_match:
        meta['location'] = loc_match.group(1).strip()

    # 5. Hardware / Devices
    hw_match = re.search(r'HARDWARE:\s*\n+([^\n\r]+)', full_text, re.I)
    if hw_match and hw_match.group(1).strip():
        meta['hardware'].append(hw_match.group(1).strip())

    for line in full_text.split('\n'):
        line_clean = line.strip()
        if not line_clean:
            continue
        if re.search(r'(?:IMEI|SN-|Serial|ThinkPad|Latitude|MacBook|iPhone|iPad|Dock|Monitor|YubiKey)', line_clean, re.I):
            if line_clean not in meta['hardware'] and not line_clean.startswith('HARDWARE'):
                meta['hardware'].append(line_clean)

    # 6. Date
    date_match = re.search(r'(\d{1,2}\.\s*\d{1,2}\.\s*\d{4}|\d{4}-\d{2}-\d{2})', full_text)
    if date_match:
        meta['date'] = date_match.group(1).strip()

    # 7. Document number
    doc_num_match = re.search(r'(?:Document|Protocol|Doc)\s*(?:No|Number|#)?[:\s]+([A-Za-z0-9\-_]+)', full_text, re.I)
    if doc_num_match:
        meta['doc_number'] = doc_num_match.group(1).strip()

    # 8. Issuer Name
    issuer_match = re.search(r'(?:Handed over by|Issuer|IT Admin|IT Support):\s*([^\n\r]+)', full_text, re.I)
    if issuer_match:
        meta['issuer_name'] = issuer_match.group(1).strip()

    return meta

# ----------------- ROUTES: WEB PAGES -----------------

@app.route('/')
def desktop_dashboard():
    """Desktop interface: QR code, pending & signed files, calibrator, settings."""
    config = load_config()
    ips = get_local_ips()
    primary_ip = ips[0]
    port = int(os.environ.get('PORT', config.get('port', 5000)))
    
    public_url = os.environ.get('PUBLIC_URL') or config.get('public_url', '').strip()
    forwarded_proto = request.headers.get('X-Forwarded-Proto', request.scheme)
    forwarded_host = request.headers.get('X-Forwarded-Host', request.host)
    
    if public_url:
        base_mobile_url = f"{public_url.rstrip('/')}/mobile"
    elif forwarded_host and not forwarded_host.startswith('127.0.0.1') and not forwarded_host.startswith('localhost'):
        base_mobile_url = f"{forwarded_proto}://{forwarded_host}/mobile"
    else:
        base_mobile_url = f"http://{primary_ip}:{port}/mobile"

    return render_template('desktop.html', 
                           config=config, 
                           ips=ips, 
                           primary_ip=primary_ip, 
                           port=port,
                           public_url=public_url,
                           mobile_url=base_mobile_url)

@app.route('/mobile')
def mobile_list():
    """Mobile document list page."""
    config = load_config()
    return render_template('mobile_list.html', config=config)

@app.route('/sign/<path:filename>')
def mobile_sign(filename):
    """Mobile signing interface for a specific PDF."""
    config = load_config()
    pending_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    file_path = pending_dir / filename
    
    if not file_path.exists():
        return render_template('error.html', 
                               title="Document Not Found", 
                               message=f"The requested document '{filename}' is no longer in the pending folder. It may have already been signed."), 404
        
    page_count = get_pdf_metadata(file_path)
    file_size = format_file_size(file_path.stat().st_size)
    mod_time = datetime.fromtimestamp(file_path.stat().st_mtime).strftime('%Y-%m-%d %H:%M')
    metadata = extract_pdf_metadata(file_path)
    
    return render_template('sign.html', 
                           filename=filename, 
                           page_count=page_count,
                           file_size=file_size,
                           mod_time=mod_time,
                           metadata=metadata,
                           config=config)

@app.route('/signed-success/<path:filename>')
def signed_success(filename):
    """Success confirmation page for mobile user."""
    return render_template('signed_success.html', filename=filename)

# ----------------- ROUTES: API ENDPOINTS -----------------

@app.route('/api/documents')
def api_documents():
    """Return lists of pending and signed PDF files with extracted metadata."""
    config = load_config()
    pending_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    signed_dir = get_resolved_path(config.get('signed_dir', 'signed'))
    
    def scan_dir(directory, is_pending=True):
        files_data = []
        if not directory.exists():
            return files_data
            
        for entry in directory.iterdir():
            if entry.is_file() and entry.suffix.lower() == '.pdf' and not entry.name.startswith('.'):
                try:
                    stat = entry.stat()
                    doc = pymupdf.open(str(entry))
                    page_count = len(doc)
                    metadata = extract_pdf_metadata(doc)
                    doc.close()

                    files_data.append({
                        "name": entry.name,
                        "size_bytes": stat.st_size,
                        "size_formatted": format_file_size(stat.st_size),
                        "modified_timestamp": stat.st_mtime,
                        "modified_formatted": datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                        "page_count": page_count,
                        "metadata": metadata,
                        "preview_url": f"/api/preview/{'pending' if is_pending else 'signed'}/{entry.name}/1",
                        "last_page_preview_url": f"/api/preview/{'pending' if is_pending else 'signed'}/{entry.name}/{page_count}",
                        "download_url": f"/download/{'pending' if is_pending else 'signed'}/{entry.name}",
                        "sign_url": f"/sign/{entry.name}" if is_pending else None
                    })
                except Exception as e:
                    print(f"Error reading file {entry.name}: {e}")
                    
        files_data.sort(key=lambda x: x['modified_timestamp'], reverse=True)
        return files_data

    return jsonify({
        "pending": scan_dir(pending_dir, is_pending=True),
        "signed": scan_dir(signed_dir, is_pending=False)
    })

@app.route('/api/metadata/<folder_type>/<path:filename>')
def api_get_metadata(folder_type, filename):
    """Return extracted metadata for a specific PDF."""
    config = load_config()
    target_dir = get_resolved_path(config.get('pending_dir' if folder_type == 'pending' else 'signed_dir', folder_type))
    file_path = target_dir / filename
    if not file_path.exists():
        return jsonify({"success": False, "error": "File not found"}), 404
    return jsonify({"success": True, "metadata": extract_pdf_metadata(file_path)})

@app.route('/api/page-dimensions/<folder_type>/<path:filename>/<int(signed=True):page>')
@app.route('/api/page-dimensions/<folder_type>/<path:filename>/<page>')
def api_page_dimensions(folder_type, filename, page):
    """Return page width and height in PDF points for the visual calibrator."""
    try:
        page_num = int(page)
    except ValueError:
        page_num = -1

    config = load_config()
    target_dir = get_resolved_path(config.get('pending_dir' if folder_type == 'pending' else 'signed_dir', folder_type))
    file_path = target_dir / filename
    if not file_path.exists():
        return jsonify({"success": False, "error": "File not found"}), 404

    try:
        doc = pymupdf.open(str(file_path))
        total_pages = len(doc)
        page_idx = max(0, min(page_num - 1, total_pages - 1)) if page_num > 0 else total_pages - 1
        pdf_page = doc[page_idx]
        rect = pdf_page.rect
        doc.close()
        return jsonify({
            "success": True,
            "width": rect.width,
            "height": rect.height,
            "page": page_idx + 1,
            "total_pages": total_pages
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/preview/<folder_type>/<path:filename>/<int(signed=True):page>')
@app.route('/api/preview/<folder_type>/<path:filename>/<page>')
def api_preview(folder_type, filename, page):
    """Render a specific PDF page as PNG thumbnail using PyMuPDF."""
    try:
        page_num = int(page)
    except ValueError:
        page_num = -1

    config = load_config()
    if folder_type == 'pending':
        target_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    elif folder_type == 'signed':
        target_dir = get_resolved_path(config.get('signed_dir', 'signed'))
    else:
        return "Invalid folder", 400

    file_path = target_dir / filename
    if not file_path.exists():
        return "File not found", 404

    try:
        doc = pymupdf.open(str(file_path))
        total_pages = len(doc)
        
        page_idx = max(0, min(page_num - 1, total_pages - 1)) if page_num > 0 else total_pages - 1
        pdf_page = doc[page_idx]
        
        zoom = float(request.args.get('zoom', 1.5))
        matrix = pymupdf.Matrix(zoom, zoom)
        pix = pdf_page.get_pixmap(matrix=matrix, alpha=False)
        
        img_bytes = pix.tobytes("png")
        doc.close()
        
        response = send_file(io.BytesIO(img_bytes), mimetype='image/png')
        response.headers['Cache-Control'] = 'public, max-age=60'
        return response
    except Exception as e:
        print(f"Error rendering PDF thumbnail: {e}")
        return f"Error rendering PDF: {str(e)}", 500

@app.route('/api/qr')
def api_qr():
    """Generate QR code PNG for a given URL or text."""
    url = request.args.get('url', '').strip()
    if not url:
        config = load_config()
        path = request.args.get('path', '/mobile')
        public_url = os.environ.get('PUBLIC_URL') or config.get('public_url', '').strip()
        
        forwarded_proto = request.headers.get('X-Forwarded-Proto', request.scheme)
        forwarded_host = request.headers.get('X-Forwarded-Host', request.host)
        
        if public_url:
            url = f"{public_url.rstrip('/')}{path}"
        elif forwarded_host and not forwarded_host.startswith('127.0.0.1') and not forwarded_host.startswith('localhost'):
            url = f"{forwarded_proto}://{forwarded_host}{path}"
        else:
            ip = request.args.get('ip', get_local_ips()[0])
            port = int(os.environ.get('PORT', config.get('port', 5000)))
            url = f"http://{ip}:{port}{path}"

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="#0f172a", back_color="#ffffff")
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return send_file(buf, mimetype='image/png')

@app.route('/api/upload', methods=['POST'])
def api_upload():
    """Upload a new PDF into the pending directory."""
    config = load_config()
    pending_dir = get_resolved_path(config.get('pending_dir', 'pending'))

    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file part in request"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"success": False, "error": "No selected file"}), 400

    if not file.filename.lower().endswith('.pdf'):
        return jsonify({"success": False, "error": "Only PDF files are supported"}), 400

    clean_name = Path(file.filename).name
    save_path = pending_dir / clean_name

    if save_path.exists():
        stem = save_path.stem
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        clean_name = f"{stem}_{timestamp}.pdf"
        save_path = pending_dir / clean_name

    file.save(str(save_path))
    return jsonify({
        "success": True, 
        "filename": clean_name,
        "sign_url": f"/sign/{clean_name}"
    })

@app.route('/api/sign/<path:filename>', methods=['POST'])
def api_sign(filename):
    """
    Overlay signature PNG onto PDF using PyMuPDF and save to signed folder.
    Supports single or dual signature (role: 'recipient' | 'issuer' | 'both').
    """
    config = load_config()
    pending_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    signed_dir = get_resolved_path(config.get('signed_dir', 'signed'))
    archive_dir = get_resolved_path(config.get('archive_dir', 'pending/.archive'))

    source_path = pending_dir / filename
    if not source_path.exists():
        return jsonify({"success": False, "error": f"Pending file '{filename}' not found."}), 404

    data = request.get_json(silent=True) or {}
    role = data.get('role', 'recipient').lower()  # 'recipient', 'issuer', or 'both'
    signature_data_url = data.get('signature', '')
    signature_issuer_url = data.get('signature_issuer', '')
    signature_recipient_url = data.get('signature_recipient', '')
    signer_name = data.get('signer_name', '').strip()
    signer_notes = data.get('signer_notes', '').strip()

    if not signature_data_url and not signature_recipient_url and not signature_issuer_url:
        return jsonify({"success": False, "error": "No signature data received."}), 400

    # Get placement definitions
    cfg_placement = config.get('signature_placement', DEFAULT_CONFIG['signature_placement'])
    
    # Handle backward compatibility / normalization
    if "recipient" in cfg_placement:
        placement_recipient = cfg_placement["recipient"]
        placement_issuer = cfg_placement.get("issuer", DEFAULT_CONFIG["signature_placement"]["issuer"])
    else:
        placement_recipient = cfg_placement
        placement_issuer = DEFAULT_CONFIG["signature_placement"]["issuer"]

    # Allow custom coordinate override
    req_coords = data.get('coordinates')
    if req_coords and isinstance(req_coords, dict):
        if role == 'issuer':
            placement_issuer = {**placement_issuer, **req_coords}
        else:
            placement_recipient = {**placement_recipient, **req_coords}

    def decode_sig(data_url):
        if not data_url: return None
        if ',' in data_url:
            b64 = data_url.split(',', 1)[1]
        else:
            b64 = data_url
        return base64.b64decode(b64)

    try:
        doc = pymupdf.open(str(source_path))
        num_pages = len(doc)
        
        # Helper to apply one signature
        def apply_signature_to_page(sig_bytes, placement_info, label_name):
            target_p = placement_info.get('page', -1)
            if target_p == -1 or target_p >= num_pages:
                target_page = doc[-1]
            elif target_p <= 0:
                target_page = doc[0]
            else:
                target_page = doc[target_p - 1]

            sx = float(placement_info.get('x', 320))
            sy = float(placement_info.get('y', 630))
            sw = float(placement_info.get('width', 210))
            sh = float(placement_info.get('height', 70))
            keep_aspect = placement_info.get('keep_aspect_ratio', True)
            add_ts = placement_info.get('add_timestamp', True)
            ts_size = float(placement_info.get('timestamp_fontsize', 7.5))

            rect = pymupdf.Rect(sx, sy, sx + sw, sy + sh)
            target_page.insert_image(rect, stream=sig_bytes, keep_proportion=keep_aspect, overlay=True)

            if add_ts or label_name:
                now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                stamp_text = f"Digitally Signed: {now_str}"
                if label_name:
                    stamp_text = f"Signed by: {label_name} | {now_str}"
                target_page.insert_text(
                    (sx, sy + sh + 10),
                    stamp_text,
                    fontsize=ts_size,
                    fontname="helv",
                    color=(0.25, 0.25, 0.25)
                )

        # 1. Overlay based on role
        if role == 'both' or (signature_recipient_url and signature_issuer_url):
            if signature_issuer_url:
                apply_signature_to_page(decode_sig(signature_issuer_url), placement_issuer, data.get('issuer_name', 'IT Admin'))
            if signature_recipient_url:
                apply_signature_to_page(decode_sig(signature_recipient_url), placement_recipient, signer_name or 'Recipient')
        elif role == 'issuer':
            sig_bytes = decode_sig(signature_data_url or signature_issuer_url)
            apply_signature_to_page(sig_bytes, placement_issuer, signer_name or 'IT Admin')
        else: # recipient
            sig_bytes = decode_sig(signature_data_url or signature_recipient_url)
            apply_signature_to_page(sig_bytes, placement_recipient, signer_name or 'Recipient')

        # Determine signed filename
        stem = source_path.stem
        signed_filename = f"{stem}_signed.pdf"
        output_path = signed_dir / signed_filename
        
        if output_path.exists():
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            signed_filename = f"{stem}_signed_{ts}.pdf"
            output_path = signed_dir / signed_filename

        # Save signed document
        doc.save(str(output_path), garbage=4, deflate=True)
        doc.close()

        # Archive pending original file
        if config.get('auto_archive_pending', True):
            try:
                archive_dir.mkdir(parents=True, exist_ok=True)
                archived_path = archive_dir / source_path.name
                if archived_path.exists():
                    archived_path = archive_dir / f"{source_path.stem}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
                source_path.rename(archived_path)
            except Exception as e:
                print(f"Notice: could not move pending file to archive: {e}")
                try:
                    source_path.unlink(missing_ok=True)
                except Exception:
                    pass

        # GitHub Automated Sync (if configured)
        gh_cfg = get_github_config()
        gh_status = {"uploaded_signed": False, "deleted_pending": False}
        if gh_cfg['is_configured']:
            if gh_cfg['auto_upload_github_signed']:
                try:
                    with open(output_path, 'rb') as sf:
                        signed_bytes = sf.read()
                    github_upload_file(f"signed/{signed_filename}", signed_bytes, f"Add signed document: {signed_filename}")
                    gh_status["uploaded_signed"] = True
                except Exception as ge:
                    print(f"Notice: could not upload signed PDF to GitHub: {ge}")

            if gh_cfg['auto_delete_github_pending']:
                try:
                    github_delete_file(f"pending/{filename}", commit_msg=f"Delete pending signed document: {filename}")
                    gh_status["deleted_pending"] = True
                except Exception as ge:
                    print(f"Notice: could not delete pending PDF from GitHub: {ge}")

        return jsonify({
            "success": True,
            "filename": signed_filename,
            "download_url": f"/download/signed/{signed_filename}",
            "preview_url": f"/api/preview/signed/{signed_filename}/1",
            "github_sync": gh_status
        })

    except Exception as e:
        print(f"Error signing PDF '{filename}': {e}")
        return jsonify({"success": False, "error": f"Failed to overlay signature: {str(e)}"}), 500

@app.route('/download/<folder_type>/<path:filename>')
def download_file(folder_type, filename):
    """Download a pending or signed PDF."""
    config = load_config()
    if folder_type == 'pending':
        target_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    elif folder_type == 'signed':
        target_dir = get_resolved_path(config.get('signed_dir', 'signed'))
    elif folder_type == 'archive':
        target_dir = get_resolved_path(config.get('archive_dir', 'pending/.archive'))
    else:
        return "Invalid folder", 400

    return send_from_directory(str(target_dir), filename, as_attachment=False)

@app.route('/api/documents/<folder_type>/<path:filename>', methods=['DELETE'])
@app.route('/api/delete/<folder_type>/<path:filename>', methods=['POST', 'DELETE'])
def api_delete_document(folder_type, filename):
    """Delete a document from pending, signed, or archive folder, with optional GitHub deletion."""
    config = load_config()
    if folder_type == 'pending':
        target_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    elif folder_type == 'signed':
        target_dir = get_resolved_path(config.get('signed_dir', 'signed'))
    elif folder_type == 'archive':
        target_dir = get_resolved_path(config.get('archive_dir', 'pending/.archive'))
    else:
        return jsonify({"success": False, "error": "Invalid folder type"}), 400

    clean_name = Path(filename).name
    file_path = target_dir / clean_name

    deleted_local = False
    if file_path.exists():
        try:
            file_path.unlink()
            deleted_local = True
        except Exception as e:
            return jsonify({"success": False, "error": f"Failed to delete local file: {str(e)}"}), 500

    # Also check if user requested GitHub deletion
    delete_github = request.args.get('delete_github', 'false').lower() == 'true'
    gh_deleted = False
    gh_error = None

    if delete_github and folder_type == 'pending':
        gh_cfg = get_github_config()
        if gh_cfg['is_configured']:
            try:
                github_delete_file(f"pending/{clean_name}")
                gh_deleted = True
            except Exception as ge:
                gh_error = str(ge)

    if not deleted_local and not gh_deleted:
        return jsonify({"success": False, "error": f"File '{clean_name}' not found locally."}), 404

    return jsonify({
        "success": True, 
        "message": f"Deleted {clean_name}" + (" and removed from GitHub" if gh_deleted else ""),
        "deleted_local": deleted_local,
        "deleted_github": gh_deleted,
        "github_error": gh_error
    })

# ----------------- GITHUB INTEGRATION ENDPOINTS -----------------

@app.route('/api/github/status')
def api_github_status():
    """Get status of GitHub integration."""
    gh = get_github_config()
    return jsonify({
        "is_configured": gh["is_configured"],
        "repo": gh["repo"],
        "branch": gh["branch"],
        "auto_delete_pending": gh["auto_delete_github_pending"],
        "auto_upload_signed": gh["auto_upload_github_signed"],
        "has_token": bool(gh["token"])
    })

@app.route('/api/github/test', methods=['POST'])
def api_github_test():
    """Test GitHub connection with repository and token."""
    data = request.get_json(silent=True) or {}
    repo = data.get('repo')
    token = data.get('token')
    res = github_test_connection(repo, token)
    return jsonify(res)

@app.route('/api/github/pending')
def api_github_pending():
    """List all files in GitHub repo pending/ folder."""
    gh = get_github_config()
    if not gh['is_configured']:
        return jsonify({"success": False, "error": "GitHub is not configured with repository & token.", "files": []})
    try:
        files = github_list_pending_files()
        return jsonify({"success": True, "files": files, "repo": gh['repo'], "branch": gh['branch']})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "files": []}), 500

@app.route('/api/github/delete/pending/<path:filename>', methods=['POST', 'DELETE'])
def api_github_delete_pending(filename):
    """Delete a specific file from GitHub pending/ folder."""
    gh = get_github_config()
    if not gh['is_configured']:
        return jsonify({"success": False, "error": "GitHub is not configured."}), 400
    try:
        clean_name = Path(filename).name
        github_delete_file(f"pending/{clean_name}")
        return jsonify({"success": True, "message": f"Deleted {clean_name} from GitHub pending folder."})
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to delete from GitHub: {str(e)}"}), 500

@app.route('/api/github/clear-pending', methods=['POST'])
def api_github_clear_pending():
    """Delete all files from GitHub pending/ folder in batch."""
    gh = get_github_config()
    if not gh['is_configured']:
        return jsonify({"success": False, "error": "GitHub is not configured."}), 400
    try:
        files = github_list_pending_files()
        if not files:
            return jsonify({"success": True, "deleted_count": 0, "message": "GitHub pending folder is already empty."})

        deleted = 0
        errors = []
        for f in files:
            try:
                github_delete_file(f['path'], sha=f.get('sha'))
                deleted += 1
            except Exception as ge:
                errors.append(f"{f['name']}: {str(ge)}")

        return jsonify({
            "success": True, 
            "deleted_count": deleted, 
            "errors": errors, 
            "message": f"Successfully deleted {deleted} files from GitHub pending folder."
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/clear/<folder_type>', methods=['POST'])
def api_clear_folder(folder_type):
    """Clear all PDF files in a given folder."""
    config = load_config()
    if folder_type == 'signed':
        target_dir = get_resolved_path(config.get('signed_dir', 'signed'))
    elif folder_type == 'pending':
        target_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    elif folder_type == 'archive':
        target_dir = get_resolved_path(config.get('archive_dir', 'pending/.archive'))
    else:
        return jsonify({"success": False, "error": "Invalid folder type"}), 400

    deleted_count = 0
    if target_dir.exists():
        for f in target_dir.glob('*.pdf'):
            try:
                f.unlink()
                deleted_count += 1
            except Exception:
                pass

    return jsonify({"success": True, "count": deleted_count, "message": f"Cleared {deleted_count} files"})

@app.route('/api/download-all/<folder_type>')
def api_download_all_zip(folder_type):
    """Export all PDF documents in a folder as a single ZIP archive."""
    config = load_config()
    if folder_type == 'signed':
        target_dir = get_resolved_path(config.get('signed_dir', 'signed'))
        prefix = "signed_handover_documents"
    elif folder_type == 'pending':
        target_dir = get_resolved_path(config.get('pending_dir', 'pending'))
        prefix = "pending_handover_documents"
    else:
        return "Invalid folder", 400

    if not target_dir.exists():
        return "Directory not found", 404

    pdf_files = list(target_dir.glob('*.pdf'))
    if not pdf_files:
        return "No PDF files found to export", 404

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for pdf in pdf_files:
            zf.write(pdf, arcname=pdf.name)

    buf.seek(0)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    zip_filename = f"{prefix}_{timestamp}.zip"

    return send_file(
        buf,
        mimetype='application/zip',
        as_attachment=True,
        download_name=zip_filename
    )

@app.route('/api/config', methods=['GET', 'POST'])
def api_config():
    """Get or update application settings."""
    if request.method == 'POST':
        new_config = request.get_json(silent=True)
        if not new_config:
            return jsonify({"success": False, "error": "Invalid JSON"}), 400
        current = load_config()
        current.update(new_config)
        save_config(current)
        return jsonify({"success": True, "config": current})
    return jsonify(load_config())

@app.route('/api/network-info')
def api_network_info():
    """Return network IPs and URLs for easy connectivity."""
    config = load_config()
    ips = get_local_ips()
    port = config.get('port', 5000)
    urls = [{"ip": ip, "url": f"http://{ip}:{port}/mobile"} for ip in ips]
    return jsonify({
        "primary_ip": ips[0] if ips else '127.0.0.1',
        "all_ips": ips,
        "port": port,
        "mobile_urls": urls
    })

# ----------------- MAIN ENTRY POINT -----------------

if __name__ == '__main__':
    cfg = load_config()
    host = os.environ.get('HOST', cfg.get('host', '0.0.0.0'))
    port = int(os.environ.get('PORT', cfg.get('port', 5000)))
    public_url = os.environ.get('PUBLIC_URL') or cfg.get('public_url', '').strip()
    
    ips = get_local_ips()
    primary_ip = ips[0] if ips else '127.0.0.1'
    mobile_url = f"{public_url.rstrip('/')}/mobile" if public_url else f"http://{primary_ip}:{port}/mobile"

    print("=" * 60)
    print("  IT HANDOVER PDF SIGNER - FLASK SERVER")
    print("=" * 60)
    print(f"  * Desktop Dashboard: http://localhost:{port}")
    print(f"  * Mobile Phone URL:  {mobile_url}")
    print(f"  * Pending Folder:    {get_resolved_path(cfg.get('pending_dir', 'pending'))}")
    print(f"  * Signed Folder:     {get_resolved_path(cfg.get('signed_dir', 'signed'))}")
    print("=" * 60)
    print("  Scan the QR code on the desktop interface to open on Android.")
    print("=" * 60)

    app.run(host=host, port=port, debug=False)
