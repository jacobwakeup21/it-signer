# IT Signer — Multi-User Digital Signature Hub

A lightweight, enterprise-ready Python Flask web application designed for seamlessly signing IT hardware handover protocols and acknowledgement forms on Android phones, iPhones, iPads, and PCs, with complete multi-user account isolation.

---

## 🌟 Key Features

- 👤 **Multi-User Accounts & Workspaces**: Each technician or employee has their own account and login.
- 🔒 **Document Privacy & Isolation**: Users only see their own documents in **Pending** and **Completed/Signed** lists. Documents uploaded or signed by one user are completely hidden from other users.
- 📁 **Custom Per-User Folders (OneDrive Sync)**: Each user can independently configure their own signed destination folder (e.g. `$HOME\OneDrive - Nokian Tyres\Signed Handover Documents` or custom paths) and pending folders.
- 📱 **One-Scan Quick Mobile Access**: Desktop QR codes automatically embed the user's personal access token, so scanning the QR code with a phone instantly opens that user's pending documents without retyping credentials.
- ✍️ **Mobile Touch & Stylus Signing**: Smooth, responsive vector signature capture powered by `signature_pad.js` with retina/high-DPI canvas scaling, touch/stylus support, and palm/gesture rejection.
- ⚡ **Instant PyMuPDF Overlay**: Accurately embeds drawn signatures (single or dual signatures: IT Admin & Recipient) with automatic timestamps and metadata directly onto the PDF.
- 🔄 **Local PC Folder Sync (`sync_signed_to_pc.ps1`)**: Background PowerShell sync script that automatically downloads only that user's signed documents into their local PC or OneDrive folder using their personal token.
- 🐙 **GitHub Integration**: Supports syncing signed documents to a GitHub repository and cleaning up pending files upon signature completion.

---

## 🚀 Quick Start

### 1. Launch the Application
Double-click `run.bat` (Windows) or execute in PowerShell:
```powershell
.\start.ps1
```

Or run manually:
```bash
pip install -r requirements.txt
python app.py
```

### 2. Workflow
1. **Create an Account / Sign In**:
   - Navigate to `http://localhost:5000` (or your LAN/cloud URL).
   - If visiting for the first time, click **Create Account** to register your username and password.
2. **Configure Your Personal Output Folder**:
   - Click the **Settings** gear icon.
   - Set **Signed Output Folder Path** to your personal OneDrive directory (click **"Use OneDrive Path"** for quick fill).
3. **Upload PDF**:
   - Drag and drop any handover PDF into the Desktop Dashboard. It will be placed into your private pending folder.
4. **Scan & Sign on Mobile**:
   - Scan the QR code on your desktop screen with your phone camera.
   - Your phone will automatically log into your workspace and display your pending documents.
   - Tap **Sign Document Now**, draw your signature, and tap **Save & Overlay Signature**.
5. **Complete**:
   - The signed PDF is instantly saved to your configured output folder (e.g. OneDrive) and appears in your Completed list.

---

## 📁 Directory Structure

```
IT Signer/
├── app.py                      # Flask backend, PyMuPDF signing pipeline & auth
├── db.py                       # SQLite user accounts, tokens & settings database
├── it_signer.db                # SQLite database (auto-generated)
├── config.json                 # System fallback defaults
├── requirements.txt            # Python dependencies
├── run.bat                     # Windows one-click launcher
├── start.ps1                   # PowerShell launcher
├── sync_signed_to_pc.ps1       # Background PC folder sync script
├── pending/                    # User pending folders (e.g. pending/<username>/)
├── signed/                     # User signed folders (e.g. signed/<username>/ or custom OneDrive)
├── static/                     # CSS, JS, branding assets
└── templates/                  # HTML templates (login, desktop, mobile, sign)
```

---

## 💻 Background PC Sync Script

Each user has a personalized command in **Settings &rarr; My Account & Quick Sync**:
```powershell
powershell -ExecutionPolicy Bypass -File .\sync_signed_to_pc.ps1 -Token "<your-personal-token>"
```
This automatically watches and downloads any newly signed documents created by your account into your personal local folder.
