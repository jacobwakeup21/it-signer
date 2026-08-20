/**
 * Desktop Dashboard Management Script
 */

let currentIp = '';
let currentPort = 5000;
let pendingFiles = [];
let signedFiles = [];
let currentDocQrUrl = '';

document.addEventListener('DOMContentLoaded', () => {
    initNetworkControls();
    initDropZone();
    refreshDocuments();
    
    // Auto-refresh document list every 5 seconds to catch phone signature completions
    setInterval(refreshDocuments, 4000);
});

function getBaseUrl() {
    if (currentIp.startsWith('http://') || currentIp.startsWith('https://')) {
        return currentIp.replace(/\/+$/, '');
    }
    return `http://${currentIp}:${currentPort}`;
}

function initNetworkControls() {
    const ipSelect = document.getElementById('ipSelect');
    if (ipSelect) {
        currentIp = ipSelect.value;
        ipSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom_url') {
                const userUrl = prompt('Enter your public Cloud / Tunnel URL (e.g. https://my-signer.onrender.com or https://xyz.trycloudflare.com):');
                if (userUrl && userUrl.trim()) {
                    let clean = userUrl.trim();
                    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
                        clean = 'https://' + clean;
                    }
                    const opt = document.createElement('option');
                    opt.value = clean;
                    opt.textContent = `🌐 ${clean}`;
                    opt.selected = true;
                    ipSelect.insertBefore(opt, ipSelect.firstChild);
                    currentIp = clean;
                } else {
                    ipSelect.value = currentIp;
                    return;
                }
            } else {
                currentIp = e.target.value;
            }
            updateHeroQr();
            renderPendingGrid(pendingFiles);
        });
    }
}

function updateHeroQr() {
    const qrImg = document.getElementById('qrImage');
    const fullUrlSpan = document.getElementById('fullMobileUrl');
    const openLink = document.getElementById('openMobileLink');
    
    const targetUrl = `${getBaseUrl()}/mobile`;
    if (qrImg) qrImg.src = `/api/qr?url=${encodeURIComponent(targetUrl)}`;
    if (fullUrlSpan) fullUrlSpan.textContent = targetUrl;
    if (openLink) openLink.href = targetUrl;
}

function copyMobileUrl() {
    const url = document.getElementById('fullMobileUrl').textContent;
    navigator.clipboard.writeText(url).then(() => {
        const btnText = document.getElementById('copyBtnText');
        const orig = btnText.textContent;
        btnText.textContent = 'Copied!';
        setTimeout(() => { btnText.textContent = orig; }, 1800);
    });
}

async function refreshDocuments() {
    try {
        const res = await fetch('/api/documents');
        const data = await res.json();
        
        pendingFiles = data.pending || [];
        signedFiles = data.signed || [];

        document.getElementById('pendingCountBadge').textContent = `${pendingFiles.length} file${pendingFiles.length === 1 ? '' : 's'}`;
        document.getElementById('signedCountBadge').textContent = `${signedFiles.length} file${signedFiles.length === 1 ? '' : 's'}`;

        renderPendingGrid(pendingFiles);
        renderSignedGrid(signedFiles);
    } catch (err) {
        console.error('Failed to load documents:', err);
    }
}

function renderPendingGrid(files) {
    const container = document.getElementById('pendingContainer');
    if (!files || files.length === 0) {
        container.innerHTML = `
            <div class="col-span-full bg-slate-800/40 border border-slate-700/60 rounded-2xl p-8 text-center space-y-2">
                <i data-lucide="folder-open" class="w-8 h-8 mx-auto text-slate-500"></i>
                <h4 class="text-sm font-semibold text-slate-300">No pending files</h4>
                <p class="text-xs text-slate-500">Drag and drop a PDF file above or copy into <code class="text-sky-400 font-mono">./pending</code></p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = files.map(file => {
        const directSignUrl = `${getBaseUrl()}/sign/${encodeURIComponent(file.name)}`;
        return `
        <div class="doc-card bg-slate-800 border border-slate-700 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
            <div class="flex items-start gap-3">
                <!-- Thumbnail -->
                <div class="w-16 h-20 bg-slate-950 rounded-lg overflow-hidden border border-slate-700 flex-shrink-0 relative group cursor-pointer" onclick="openPdfPreview('pending', '${file.name}', '${file.preview_url}')">
                    <img src="${file.preview_url}?zoom=0.8" alt="${file.name}" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <i data-lucide="zoom-in" class="w-4 h-4 text-white"></i>
                    </div>
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                    <h4 class="text-xs font-bold text-white truncate" title="${file.name}">${file.name}</h4>
                    <p class="text-[11px] text-slate-400 mt-1">${file.modified_formatted}</p>
                    <div class="flex items-center gap-2 mt-2">
                        <span class="px-2 py-0.5 rounded bg-slate-900 text-sky-400 text-[10px] font-mono border border-slate-700">
                            ${file.size_formatted}
                        </span>
                        <span class="px-2 py-0.5 rounded bg-slate-900 text-slate-300 text-[10px] font-mono border border-slate-700">
                            ${file.page_count} ${file.page_count === 1 ? 'Page' : 'Pages'}
                        </span>
                    </div>
                </div>
            </div>

            <!-- Action buttons -->
            <div class="pt-2 border-t border-slate-700/60 flex items-center gap-2">
                <button onclick="showDocQr('${file.name}', '${directSignUrl}')" class="flex-1 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 border border-sky-500/30 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1">
                    <i data-lucide="qr-code" class="w-3.5 h-3.5"></i> Direct QR
                </button>
                <a href="/sign/${encodeURIComponent(file.name)}" class="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-medium transition flex items-center justify-center gap-1">
                    <i data-lucide="pen" class="w-3.5 h-3.5"></i> Sign
                </a>
                <a href="${file.download_url}" target="_blank" class="p-1.5 bg-slate-700/70 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition" title="Download original">
                    <i data-lucide="download" class="w-3.5 h-3.5"></i>
                </a>
            </div>
        </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function renderSignedGrid(files) {
    const container = document.getElementById('signedContainer');
    if (!files || files.length === 0) {
        container.innerHTML = `
            <div class="col-span-full bg-slate-800/40 border border-slate-700/60 rounded-2xl p-8 text-center space-y-2">
                <i data-lucide="check-circle" class="w-8 h-8 mx-auto text-slate-500"></i>
                <h4 class="text-sm font-semibold text-slate-300">No signed documents yet</h4>
                <p class="text-xs text-slate-500">Signed PDFs with embedded signatures will automatically appear here.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = files.map(file => `
        <div class="doc-card bg-slate-800 border border-slate-700 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
            <div class="flex items-start gap-3">
                <!-- Thumbnail showing signature -->
                <div class="w-16 h-20 bg-slate-950 rounded-lg overflow-hidden border border-emerald-500/30 flex-shrink-0 relative group cursor-pointer" onclick="openPdfPreview('signed', '${file.name}', '${file.last_page_preview_url || file.preview_url}')">
                    <img src="${file.last_page_preview_url || file.preview_url}?zoom=0.8" alt="${file.name}" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <i data-lucide="zoom-in" class="w-4 h-4 text-white"></i>
                    </div>
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                    <h4 class="text-xs font-bold text-white truncate" title="${file.name}">${file.name}</h4>
                    <p class="text-[11px] text-slate-400 mt-1">${file.modified_formatted}</p>
                    <div class="flex items-center gap-2 mt-2">
                        <span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold flex items-center gap-1 border border-emerald-500/20">
                            <i data-lucide="check" class="w-3 h-3"></i> Completed
                        </span>
                        <span class="text-[10px] text-slate-400 font-mono">${file.size_formatted}</span>
                    </div>
                </div>
            </div>

            <!-- Action buttons -->
            <div class="pt-2 border-t border-slate-700/60 flex items-center gap-2">
                <a href="${file.download_url}" target="_blank" class="w-full py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5">
                    <i data-lucide="download" class="w-3.5 h-3.5"></i> Download Signed PDF
                </a>
            </div>
        </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
}

function initDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('pdfFileInput');

    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    ['dragleave', 'dragend'].forEach(type => {
        dropZone.addEventListener(type, () => dropZone.classList.remove('dragover'));
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });
}

async function handleFileUpload(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Please upload a valid PDF document.');
        return;
    }

    const statusEl = document.getElementById('uploadStatus');
    statusEl.className = 'mt-3 text-xs text-sky-400 font-medium block';
    statusEl.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-1"></i> Uploading ${file.name}...`;
    if (window.lucide) lucide.createIcons();

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            statusEl.className = 'mt-3 text-xs text-emerald-400 font-medium block';
            statusEl.textContent = `✓ Uploaded ${data.filename} to ./pending`;
            refreshDocuments();
            setTimeout(() => { statusEl.classList.add('hidden'); }, 3000);
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (err) {
        statusEl.className = 'mt-3 text-xs text-rose-400 font-medium block';
        statusEl.textContent = `Error: ${err.message}`;
    }
}

// Modal Handlers
function showDocQr(filename, url) {
    currentDocQrUrl = url;
    document.getElementById('docQrFilename').textContent = filename;
    document.getElementById('docQrImg').src = `/api/qr?url=${encodeURIComponent(url)}`;
    document.getElementById('docQrDirectBtn').href = url;
    
    const modal = document.getElementById('docQrModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeDocQrModal() {
    const modal = document.getElementById('docQrModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function copyDocQrUrl() {
    navigator.clipboard.writeText(currentDocQrUrl).then(() => {
        alert('Direct signing link copied to clipboard!');
    });
}

function openPdfPreview(folder, filename, previewUrl) {
    document.getElementById('pdfPreviewTitle').textContent = filename;
    document.getElementById('pdfPreviewImg').src = `${previewUrl}?zoom=1.8&t=${Date.now()}`;
    document.getElementById('pdfPreviewDownloadBtn').href = `/download/${folder}/${encodeURIComponent(filename)}`;

    const modal = document.getElementById('pdfPreviewModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closePdfPreviewModal() {
    const modal = document.getElementById('pdfPreviewModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function openSettingsModal() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        const placement = config.signature_placement || {};

        document.getElementById('setting_x').value = placement.x || 320;
        document.getElementById('setting_y').value = placement.y || 630;
        document.getElementById('setting_w').value = placement.width || 210;
        document.getElementById('setting_h').value = placement.height || 70;
        document.getElementById('setting_public_url').value = config.public_url || '';
        document.getElementById('setting_timestamp').checked = placement.add_timestamp !== false;
        document.getElementById('setting_archive').checked = config.auto_archive_pending !== false;

        const modal = document.getElementById('settingsModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function saveSettings(e) {
    e.preventDefault();
    const pubUrl = document.getElementById('setting_public_url').value.trim();
    const payload = {
        public_url: pubUrl,
        signature_placement: {
            page: -1,
            x: parseFloat(document.getElementById('setting_x').value) || 320,
            y: parseFloat(document.getElementById('setting_y').value) || 630,
            width: parseFloat(document.getElementById('setting_w').value) || 210,
            height: parseFloat(document.getElementById('setting_h').value) || 70,
            keep_aspect_ratio: true,
            add_timestamp: document.getElementById('setting_timestamp').checked,
            timestamp_x: parseFloat(document.getElementById('setting_x').value) || 320,
            timestamp_y: (parseFloat(document.getElementById('setting_y').value) || 630) + (parseFloat(document.getElementById('setting_h').value) || 70) + 10,
            timestamp_fontsize: 7.5
        },
        auto_archive_pending: document.getElementById('setting_archive').checked
    };

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            closeSettingsModal();
            alert('Settings saved successfully!');
            if (pubUrl) {
                currentIp = pubUrl;
                updateHeroQr();
                renderPendingGrid(pendingFiles);
            }
        }
    } catch (err) {
        alert(`Failed to save settings: ${err.message}`);
    }
}
