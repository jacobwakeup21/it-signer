# Cloud & Microserver Deployment Guide

This guide explains how to host the **IT Handover PDF Signer** so it is accessible from both your corporate laptop and an Android phone on a separate network (cellular data or guest Wi-Fi).

---

## 🎯 Solution Overview

When your laptop is restricted to a corporate subnet and cannot directly communicate with mobile devices on other subnets or 4G/5G, you have 3 easy options:

| Method | Where It Runs | Internet Access | Setup Effort |
| :--- | :--- | :--- | :--- |
| **Option 1: Free Cloud Hosting (Render / Railway)** | Cloud Web Server | Yes (24/7 HTTPS) | 2 minutes (Zero-maintenance) |
| **Option 2: Cloudflare Quick Tunnel** | Local Laptop + Cloudflare | Yes (Temporary HTTPS) | 30 seconds (1 command) |
| **Option 3: Docker on VPS / Microserver** | Linux VPS / Micro-instance | Yes (Permanent) | 1 minute (`docker-compose`) |

---

## 🚀 Option 1: 1-Click Free Cloud Deployment (Render.com)

[Render.com](https://render.com) offers free web service hosting with automatic HTTPS.

1. Push or upload this `it-handover-signer` folder to a GitHub/GitLab repository.
2. Log in to [Render.com](https://dashboard.render.com/) and click **New + > Web Service**.
3. Select your repository.
4. Render will automatically detect `render.yaml` or you can fill:
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn wsgi:app --bind 0.0.0.0:$PORT`
5. Click **Deploy**.
6. Render will generate a public HTTPS URL (e.g. `https://it-handover-signer.onrender.com`).
   - Open that URL on your laptop.
   - The desktop dashboard QR code will automatically use the public URL.
   - Scan the QR code with any phone on 4G/5G/guest Wi-Fi to sign.

---

## ⚡ Option 2: Cloudflare Quick Tunnel (Zero Cloud Setup)

If you want to keep the server running on your laptop with local files, you can expose the local Flask app to a secure public HTTPS URL using Cloudflare's free tunnel.

### Step 1: Download `cloudflared` (Standalone Single Executable)
- Download `cloudflared-windows-amd64.exe` from [Cloudflare Releases](https://github.com/cloudflare/cloudflared/releases/latest).
- Rename it to `cloudflared.exe` and place it in the `it-handover-signer` folder.

### Step 2: Start Tunnel
Run:
```cmd
cloudflared tunnel --url http://localhost:5000
```
Cloudflare will output a public URL like:
```
https://rapid-words-example.trycloudflare.com
```

### Step 3: Connect
1. Start Flask (`python app.py` or `run.bat`).
2. On the Desktop Dashboard (`http://localhost:5000`), select **"🌐 Custom Cloud / Tunnel URL..."** from the network dropdown and paste your `https://...trycloudflare.com` URL.
3. The QR code will immediately update to the public HTTPS URL.
4. Scan the QR code on your Android phone from any network.

---

## 🐳 Option 3: Docker / Docker Compose on a Microserver / VPS

If you have a Linux microserver (Ubuntu, Debian, Raspberry Pi, AWS Lightsail, DigitalOcean Droplet, Linode):

1. Copy the `it-handover-signer` folder to the server.
2. Run:
```bash
docker compose up -d --build
```
3. The service will start on port `5000` with persistent volumes for `./pending` and `./signed`.
4. Set the environment variable `PUBLIC_URL=https://your-domain.com` in `docker-compose.yml` or your reverse proxy (Nginx / Caddy / Traefik).

---

## 🌐 Setting a Custom Domain / Public URL in the UI

You can set your public microserver URL at any time:
1. Open the Desktop Dashboard.
2. Click **"Edit Overlay Placement"** or **"Configure"** (Settings).
3. Enter your domain under **"Public Cloud URL / Tunnel Domain"** (e.g. `https://it-signer.mycompany.com`).
4. Click **Save Settings**. All generated QR codes and mobile links will instantly use this public domain!
