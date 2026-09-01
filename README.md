# IT Handover PDF Signer

A lightweight, enterprise-ready Python Flask web application designed for seamlessly signing IT hardware handover protocols and acknowledgement forms on Android phones and tablets.

---

## 🌟 Key Features

- 📂 **Dynamic Upload & Local Watching**: Drop PDFs into the desktop dashboard or `./pending` folder on demand.
- 🐙 **GitHub Pending & Cloud Manager**: Direct integration with GitHub REST API allows viewing and deleting files sitting in the GitHub repository's `pending/` folder with 1-click, plus automatic removal of pending files and auto-uploading of signed documents upon signature completion.
- 📱 **Mobile Touch & Stylus Signing**: Smooth, responsive vector signature capture powered by `signature_pad.js` with retina/high-DPI canvas scaling and palm/gesture rejection.
- ⚡ **Instant PyMuPDF Overlay**: Accurately embeds drawn signatures (with optional timestamp & signer metadata) directly onto the target coordinates of the PDF's last page and saves to `./signed`.
- 📲 **Desktop Dashboard with QR Codes**: Displays automatic LAN IP detection and high-resolution QR codes for immediate one-scan mobile access.
- 🖼️ **Real-time PDF Thumbnails**: Fast, high-fidelity PDF page rendering via PyMuPDF without requiring external binary tools like Poppler.
- ⚙️ **Configurable Coordinates & Settings**: Easily customize signature placement coordinates (X, Y, Width, Height) via `config.json` or directly through the web UI.
- 🌐 **Offline / Intranet Ready**: Bundled vendor scripts allow full operation inside isolated LAN/intranet networks without an active internet connection.

---

## 🚀 Quick Start

### 1. Launch the Application
Simply double-click `run.bat` (Windows) or execute via PowerShell:
```powershell
.\start.ps1
```

Or run manually:
```bash
pip install -r requirements.txt
python app.py
```

### 2. Workflow
1. **Upload PDF**: Drag and drop any handover PDF into the Desktop Dashboard at `http://localhost:5000` (or place it into `./pending`).
2. **Scan QR Code**: Scan the QR code displayed on the desktop screen using your phone.
3. **Sign**: Draw the recipient's and/or IT issuer's signature on the touch screen and tap **"Save & Overlay Signature"**.
4. **Complete**: 
   - The signed PDF is instantly saved to `signed/<filename>_signed.pdf` where it stays permanently.
   - The original pending file is automatically moved out of pending (archived).
   - If GitHub integration is enabled, the pending file is automatically deleted from GitHub and the signed PDF is uploaded to GitHub's `signed/` folder.

---

## 📁 Directory Structure

```
it-handover-signer/
├── app.py                      # Flask backend & PyMuPDF signing pipeline + GitHub API
├── config.json                 # Placement coordinates, folder config & GitHub settings
├── clean_github_pending.ps1    # PowerShell script to purge GitHub pending files
├── requirements.txt            # Python dependencies
├── .gitignore                  # Prevents committing pending & signed PDFs to GitHub
├── run.bat                     # Windows one-click launcher
├── start.ps1                   # PowerShell launcher
├── pending/                    # Input folder for unsigned PDFs (starts clean)
│   └── .gitkeep
├── signed/                     # Output folder for signed PDFs (stays permanently)
│   └── .gitkeep
├── samples/                    # Sample template PDFs (not auto-loaded)
├── templates/
│   ├── base.html               # Base layout & styles
│   ├── desktop.html            # Desktop dashboard with QR code, file & GitHub manager
│   ├── mobile_list.html        # Mobile document selection
│   ├── sign.html               # Mobile touch signature interface
│   ├── signed_success.html     # Completion confirmation screen
│   └── error.html              # Error page
└── static/
    ├── css/
    │   └── style.css           # Styling & animations
    ├── js/
    │   ├── signature_pad.umd.min.js # Local offline SignaturePad
    │   ├── qrcode.min.js       # Local offline QR generator
    │   └── desktop.js          # Desktop dashboard logic & GitHub interactions
```

---

## ⚙️ Configuration (`config.json`)

```json
{
    "host": "0.0.0.0",
    "port": 5000,
    "pending_dir": "pending",
    "signed_dir": "signed",
    "signature_placement": {
        "recipient": {
            "page": -1,
            "x": 320,
            "y": 630,
            "width": 210,
            "height": 70,
            "label": "Employee / Recipient",
            "add_timestamp": true,
            "timestamp_fontsize": 7.5
        },
        "issuer": {
            "page": -1,
            "x": 60,
            "y": 630,
            "width": 200,
            "height": 70,
            "label": "IT Admin / Issuer",
            "add_timestamp": true,
            "timestamp_fontsize": 7.5
        }
    },
    "auto_archive_pending": true,
    "github_repo": "your-username/it-handover-signer",
    "github_token": "ghp_...",
    "github_branch": "main",
    "auto_delete_github_pending": true,
    "auto_upload_github_signed": true
}
```

*All coordinate units are in PDF standard points (Standard A4 is 595 × 842 points).*
