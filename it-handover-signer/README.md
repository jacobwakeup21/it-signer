# IT Handover PDF Signer

A lightweight, enterprise-ready Python Flask web application designed for seamlessly signing IT hardware handover protocols and acknowledgement forms on Android phones and tablets.

---

## 🌟 Key Features

- 📂 **Local Folder Watching / Management**: Automatically detects and lists PDF documents placed in `./pending`.
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
1. **Drop PDF**: Place any handover PDF into the `pending/` folder (or drag and drop it into the Desktop Dashboard at `http://localhost:5000`).
2. **Scan QR Code**: Open the camera or browser on your Android phone/tablet and scan the QR code displayed on the desktop screen.
3. **Sign**: Review the document thumbnail, draw the recipient's signature with your finger or stylus, and tap **"Save & Overlay Signature"**.
4. **Complete**: The signed PDF is instantly saved to `signed/` with the signature embedded at the exact target location, and the pending file is archived.

---

## 📁 Directory Structure

```
it-handover-signer/
├── app.py                      # Flask backend & PyMuPDF signing pipeline
├── config.json                 # Placement coordinates & folder configuration
├── requirements.txt            # Python dependencies
├── run.bat                     # Windows one-click launcher
├── start.ps1                   # PowerShell launcher
├── pending/                    # Input folder for unsigned PDFs
│   └── IT_Equipment_Handover_Protocol_001.pdf
├── signed/                     # Output folder for signed PDFs
├── templates/
│   ├── base.html               # Base layout & styles
│   ├── desktop.html            # Desktop dashboard with QR code & file manager
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
    │   └── desktop.js          # Desktop dashboard logic
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
        "page": -1,
        "x": 320,
        "y": 630,
        "width": 210,
        "height": 70,
        "keep_aspect_ratio": true,
        "add_timestamp": true,
        "timestamp_x": 320,
        "timestamp_y": 705,
        "timestamp_fontsize": 7.5
    },
    "auto_archive_pending": true
}
```

*All coordinate units are in PDF standard points (Standard A4 is 595 × 842 points).*
