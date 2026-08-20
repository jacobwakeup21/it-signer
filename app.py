import os
import sys
import io
import json
import base64
import socket
import logging
import zipfile
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
    "signature_placement": {
        "page": -1,              # -1 for last page, or 1, 2, ...
        "x": 320,                # X coordinate in PDF points (A4 is 595x842)
        "y": 630,                # Y coordinate
        "width": 210,            # Signature box width
        "height": 70,            # Signature box height
        "keep_aspect_ratio": True,
        "add_timestamp": True,
        "timestamp_x": 320,
        "timestamp_y": 705,
        "timestamp_fontsize": 7.5
    },
    "auto_archive_pending": True
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
    """Resolve relative or absolute folder paths."""
    p = Path(folder_path_str)
    if not p.is_absolute():
        p = BASE_DIR / p
    p.mkdir(parents=True, exist_ok=True)
    return p

def get_local_ips():
    """Discover all accessible local IPv4 addresses."""
    ips = []
    
    # 1. Primary outgoing route IP (most reliable)
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

def get_pdf_metadata(filepath):
    """Extract page count and basic metadata from PDF using PyMuPDF."""
    try:
        doc = pymupdf.open(str(filepath))
        page_count = len(doc)
        doc.close()
        return page_count
    except Exception:
        return 1

# ----------------- ROUTES: WEB PAGES -----------------

@app.route('/')
def desktop_dashboard():
    """Desktop interface: QR code, pending & signed files, settings."""
    config = load_config()
    ips = get_local_ips()
    primary_ip = ips[0]
    port = int(os.environ.get('PORT', config.get('port', 5000)))
    
    # Check for public URL from environment or config
    public_url = os.environ.get('PUBLIC_URL') or config.get('public_url', '').strip()
    
    # Check if request was proxied through a public domain / reverse proxy (Render, Cloudflare, ngrok, etc.)
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
    
    return render_template('sign.html', 
                           filename=filename, 
                           page_count=page_count,
                           file_size=file_size,
                           mod_time=mod_time,
                           config=config)

@app.route('/signed-success/<path:filename>')
def signed_success(filename):
    """Success confirmation page for mobile user."""
    return render_template('signed_success.html', filename=filename)

# ----------------- ROUTES: API ENDPOINTS -----------------

@app.route('/api/documents')
def api_documents():
    """Return lists of pending and signed PDF files."""
    config = load_config()
    pending_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    signed_dir = get_resolved_path(config.get('signed_dir', 'signed'))
    
    def scan_dir(directory, is_pending=True):
        files_data = []
        if not directory.exists():
            return files_data
            
        for entry in directory.iterdir():
            if entry.is_file() and entry.suffix.lower() == '.pdf' and not entry.name.startswith('.'):
                stat = entry.stat()
                page_count = get_pdf_metadata(entry)
                files_data.append({
                    "name": entry.name,
                    "size_bytes": stat.st_size,
                    "size_formatted": format_file_size(stat.st_size),
                    "modified_timestamp": stat.st_mtime,
                    "modified_formatted": datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                    "page_count": page_count,
                    "preview_url": f"/api/preview/{'pending' if is_pending else 'signed'}/{entry.name}/1",
                    "last_page_preview_url": f"/api/preview/{'pending' if is_pending else 'signed'}/{entry.name}/{page_count}",
                    "download_url": f"/download/{'pending' if is_pending else 'signed'}/{entry.name}",
                    "sign_url": f"/sign/{entry.name}" if is_pending else None
                })
        # Sort newest modified first
        files_data.sort(key=lambda x: x['modified_timestamp'], reverse=True)
        return files_data

    return jsonify({
        "pending": scan_dir(pending_dir, is_pending=True),
        "signed": scan_dir(signed_dir, is_pending=False)
    })

@app.route('/api/preview/<folder_type>/<path:filename>/<int:page>')
def api_preview(folder_type, filename, page):
    """Render a specific PDF page as PNG thumbnail using PyMuPDF."""
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
        
        # 1-indexed to 0-indexed
        page_idx = max(0, min(page - 1, total_pages - 1))
        pdf_page = doc[page_idx]
        
        # Render at 1.5x resolution for crisp high-DPI thumbnail
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

    # Sanitize filename
    clean_name = Path(file.filename).name
    save_path = pending_dir / clean_name

    # Avoid accidental overwrite if file exists with same name
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
    """
    config = load_config()
    pending_dir = get_resolved_path(config.get('pending_dir', 'pending'))
    signed_dir = get_resolved_path(config.get('signed_dir', 'signed'))
    archive_dir = get_resolved_path(config.get('archive_dir', 'pending/.archive'))

    source_path = pending_dir / filename
    if not source_path.exists():
        return jsonify({"success": False, "error": f"Pending file '{filename}' not found."}), 404

    data = request.get_json(silent=True) or {}
    signature_data_url = data.get('signature', '')
    signer_name = data.get('signer_name', '').strip()
    signer_notes = data.get('signer_notes', '').strip()

    if not signature_data_url:
        return jsonify({"success": False, "error": "No signature data received."}), 400

    # Decode base64 image
    try:
        if ',' in signature_data_url:
            base64_str = signature_data_url.split(',', 1)[1]
        else:
            base64_str = signature_data_url
        sig_bytes = base64.b64decode(base64_str)
    except Exception as e:
        return jsonify({"success": False, "error": f"Invalid signature image data: {str(e)}"}), 400

    # Signature placement settings
    placement = config.get('signature_placement', DEFAULT_CONFIG['signature_placement'])
    
    # Allow client coordinate overrides if passed
    req_coords = data.get('coordinates')
    if req_coords and isinstance(req_coords, dict):
        placement = {**placement, **req_coords}

    target_page_num = placement.get('page', -1)
    sig_x = float(placement.get('x', 320))
    sig_y = float(placement.get('y', 630))
    sig_w = float(placement.get('width', 210))
    sig_h = float(placement.get('height', 70))
    keep_aspect = placement.get('keep_aspect_ratio', True)
    add_timestamp = placement.get('add_timestamp', True)
    ts_x = float(placement.get('timestamp_x', sig_x))
    ts_y = float(placement.get('timestamp_y', sig_y + sig_h + 10))
    ts_size = float(placement.get('timestamp_fontsize', 7.5))

    try:
        doc = pymupdf.open(str(source_path))
        num_pages = len(doc)
        
        # Determine target page
        if target_page_num == -1 or target_page_num >= num_pages:
            page = doc[-1]
        elif target_page_num <= 0:
            page = doc[0]
        else:
            page = doc[target_page_num - 1]

        # Calculate bounding box
        rect = pymupdf.Rect(sig_x, sig_y, sig_x + sig_w, sig_y + sig_h)

        # Overlay signature image onto PDF page
        page.insert_image(
            rect,
            stream=sig_bytes,
            keep_proportion=keep_aspect,
            overlay=True
        )

        # Optional timestamp / signer text overlay
        if add_timestamp or signer_name:
            now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            stamp_text = f"Digitally Signed: {now_str}"
            if signer_name:
                stamp_text = f"Signed by: {signer_name} | {now_str}"
            if signer_notes:
                stamp_text += f" | {signer_notes}"
                
            page.insert_text(
                (ts_x, ts_y),
                stamp_text,
                fontsize=ts_size,
                fontname="helv",
                color=(0.25, 0.25, 0.25)
            )

        # Determine signed filename
        stem = source_path.stem
        signed_filename = f"{stem}_signed.pdf"
        output_path = signed_dir / signed_filename
        
        # If signed file already exists, avoid collision
        if output_path.exists():
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            signed_filename = f"{stem}_signed_{ts}.pdf"
            output_path = signed_dir / signed_filename

        # Save signed document
        doc.save(str(output_path), garbage=4, deflate=True)
        doc.close()

        # Handle pending original file
        if config.get('auto_archive_pending', True):
            try:
                archive_dir.mkdir(parents=True, exist_ok=True)
                archived_path = archive_dir / source_path.name
                if archived_path.exists():
                    archived_path = archive_dir / f"{source_path.stem}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
                source_path.rename(archived_path)
            except Exception as e:
                print(f"Notice: could not move pending file to archive: {e}")
                # Fallback: remove from pending
                try:
                    source_path.unlink(missing_ok=True)
                except Exception:
                    pass

        return jsonify({
            "success": True,
            "filename": signed_filename,
            "download_url": f"/download/signed/{signed_filename}",
            "preview_url": f"/api/preview/signed/{signed_filename}/1"
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
    """Delete a document from pending, signed, or archive folder."""
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

    if not file_path.exists():
        return jsonify({"success": False, "error": f"File '{clean_name}' not found."}), 404

    try:
        file_path.unlink()
        return jsonify({"success": True, "message": f"Deleted {clean_name}"})
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to delete file: {str(e)}"}), 500

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
