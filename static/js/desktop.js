/**
 * Desktop Dashboard Management Script with Visual Calibrator & Dual Signatures
 */

let currentIp = '';
let currentPort = 5000;
let pendingFiles = [];
let signedFiles = [];
let currentDocQrUrl = '';
let searchTerm = '';
let sortMode = 'date_desc';

// Calibrator State
let calibActiveBox = 'recipient'; // 'recipient' or 'issuer'
let calibPdfWidth = 595.32;
let calibPdfHeight = 841.92;
let calibFilename = '';
let calibCoords = {
    recipient: { x: 320, y: 630, width: 210, height: 70 },
    issuer: { x: 60, y: 630, width: 200, height: 70 }
};

// GitHub Integration State
let gitHubConfig = { is_configured: false, repo: '', branch: 'main' };
let gitHubPendingFiles = [];
let gitHubSignedFiles = [];
let currentGitHubTab = 'pending'; // 'pending' or 'signed'

// Local PC Auto-Save State
let localFolderHandle = null;
let autoSaveActive = false;
let autoSavedFiles = new Set(JSON.parse(localStorage.getItem('it_autosaved_files') || '[]'));

document.addEventListener('DOMContentLoaded', () => {
    initNetworkControls();
    initDropZone();
    initCalibratorInteractions();
    refreshDocuments();
    checkGitHubStatus();
    initLocalAutoSave();
    
    // Auto-refresh document list every 5 seconds & GitHub status every 15s
    setInterval(refreshDocuments, 5000);
    setInterval(checkGitHubStatus, 15000);
});

function formatLocalTime(epochSec, fallbackStr) {
    if (epochSec && typeof epochSec === 'number') {
        const d = new Date(epochSec * 1000);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return fallbackStr || '';
}

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

        sortAndRenderDocuments();
        triggerAutoSaveForNewDocs(signedFiles);
    } catch (err) {
        console.error('Failed to load documents:', err);
    }
}

function filterDocuments() {
    const input = document.getElementById('docSearchInput');
    searchTerm = input ? input.value.trim().toLowerCase() : '';
    sortAndRenderDocuments();
}

function sortAndRenderDocuments() {
    const sortSelect = document.getElementById('docSortSelect');
    sortMode = sortSelect ? sortSelect.value : 'date_desc';

    function sortFiles(list) {
        let filtered = list.filter(f => {
            if (!searchTerm) return true;
            const metaStr = f.metadata ? `${f.metadata.employee_name || ''} ${f.metadata.email || ''} ${(f.metadata.hardware || []).join(' ')}` : '';
            const full = `${f.name} ${f.modified_formatted} ${metaStr}`.toLowerCase();
            return full.includes(searchTerm);
        });

        filtered.sort((a, b) => {
            if (sortMode === 'date_desc') return b.modified_timestamp - a.modified_timestamp;
            if (sortMode === 'date_asc') return a.modified_timestamp - b.modified_timestamp;
            if (sortMode === 'name_asc') return a.name.localeCompare(b.name);
            if (sortMode === 'size_desc') return b.size_bytes - a.size_bytes;
            return 0;
        });
        return filtered;
    }

    renderPendingGrid(sortFiles(pendingFiles));
    renderSignedGrid(sortFiles(signedFiles));
}

function renderPendingGrid(files) {
    const container = document.getElementById('pendingContainer');
    if (!files || files.length === 0) {
        container.innerHTML = `
            <div class="col-span-full bg-[#0b1329]/60 border border-cyan-500/20 rounded-2xl p-8 text-center space-y-2 shadow-xl">
                <i data-lucide="folder-open" class="w-8 h-8 mx-auto text-cyan-400/60"></i>
                <h4 class="text-sm font-semibold text-slate-200">${searchTerm ? 'No matching pending files' : 'No pending files'}</h4>
                <p class="text-xs text-slate-400">${searchTerm ? 'Try adjusting your search query.' : 'Drag and drop a PDF file above or place it into the pending folder.'}</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = files.map(file => {
        const directSignUrl = `${getBaseUrl()}/sign/${encodeURIComponent(file.name)}`;
        const meta = file.metadata || {};
        const employeeName = meta.employee_name;
        const hwFirst = meta.hardware && meta.hardware.length > 0 ? meta.hardware[0] : null;

        return `
        <div class="doc-card bg-[#0b1329]/90 border border-cyan-500/25 hover:border-cyan-400/50 rounded-2xl p-4 shadow-xl shadow-cyan-950/25 flex flex-col justify-between space-y-3 transition">
            <div class="flex items-start gap-3">
                <!-- Thumbnail -->
                <div class="w-16 h-20 bg-[#070c18] rounded-lg overflow-hidden border border-cyan-500/30 flex-shrink-0 relative group cursor-pointer" onclick="openPdfPreview('pending', '${file.name}', '${file.preview_url}')">
                    <img src="${file.preview_url}?zoom=0.8" alt="${file.name}" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <i data-lucide="zoom-in" class="w-4 h-4 text-cyan-300"></i>
                    </div>
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                    <h4 class="text-xs font-bold text-white truncate" title="${file.name}">${file.name}</h4>
                    <p class="text-[11px] text-slate-400 mt-0.5">${formatLocalTime(file.modified_timestamp, file.modified_formatted)}</p>

                    <!-- Extracted Metadata Badges -->
                    <div class="mt-1.5 flex flex-wrap gap-1">
                        ${employeeName ? `
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 text-[10px] font-semibold border border-cyan-400/30 truncate max-w-full">
                                <i data-lucide="user" class="w-2.5 h-2.5"></i> ${employeeName}
                            </span>
                        ` : ''}
                        ${hwFirst ? `
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-medium border border-indigo-500/30 truncate max-w-full" title="${hwFirst}">
                                <i data-lucide="smartphone" class="w-2.5 h-2.5"></i> ${hwFirst.split('//')[0].trim()}
                            </span>
                        ` : ''}
                    </div>

                    <div class="flex items-center gap-2 mt-2">
                        <span class="px-1.5 py-0.5 rounded bg-[#070c18] text-cyan-400 text-[10px] font-mono border border-cyan-500/25">
                            ${file.size_formatted}
                        </span>
                        <span class="px-1.5 py-0.5 rounded bg-[#070c18] text-slate-300 text-[10px] font-mono border border-slate-700">
                            ${file.page_count} ${file.page_count === 1 ? 'Page' : 'Pages'}
                        </span>
                    </div>
                </div>
            </div>

            <!-- Action buttons -->
            <div class="pt-2 border-t border-cyan-500/15 flex items-center gap-1.5">
                <button onclick="showDocQr('${file.name}', '${directSignUrl}')" class="flex-1 py-1.5 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-400/30 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1 shadow-sm">
                    <i data-lucide="qr-code" class="w-3.5 h-3.5"></i> QR
                </button>
                <a href="/sign/${encodeURIComponent(file.name)}" class="flex-1 py-1.5 bg-[#101c3d] hover:bg-[#182b5c] text-white border border-cyan-500/30 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1">
                    <i data-lucide="pen" class="w-3.5 h-3.5 text-cyan-400"></i> Sign
                </a>
                <button onclick="openCalibratorModal('${file.name}')" class="p-1.5 bg-[#101c3d] hover:bg-[#182b5c] text-cyan-300 border border-cyan-500/20 rounded-lg text-xs transition" title="Calibrate placement on this PDF">
                    <i data-lucide="move" class="w-3.5 h-3.5"></i>
                </button>
                <a href="${file.download_url}" target="_blank" class="p-1.5 bg-[#101c3d] hover:bg-[#182b5c] text-cyan-300 border border-cyan-500/20 rounded-lg text-xs transition" title="Download original">
                    <i data-lucide="download" class="w-3.5 h-3.5"></i>
                </a>
                <button data-filename="${encodeURIComponent(file.name)}" onclick="deleteDocument('pending', decodeURIComponent(this.getAttribute('data-filename')))" class="p-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs transition" title="Delete file">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
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
            <div class="col-span-full bg-[#0b1329]/60 border border-cyan-500/20 rounded-2xl p-8 text-center space-y-2 shadow-xl">
                <i data-lucide="check-circle" class="w-8 h-8 mx-auto text-emerald-400/60"></i>
                <h4 class="text-sm font-semibold text-slate-200">${searchTerm ? 'No matching signed documents' : 'No signed documents yet'}</h4>
                <p class="text-xs text-slate-400">${searchTerm ? 'Try adjusting your search query.' : 'Signed PDFs with embedded signatures will automatically appear here.'}</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = files.map(file => {
        const meta = file.metadata || {};
        const employeeName = meta.employee_name;

        return `
        <div class="doc-card bg-[#0b1329]/90 border border-emerald-500/30 hover:border-emerald-400/50 rounded-2xl p-4 shadow-xl shadow-emerald-950/20 flex flex-col justify-between space-y-3 transition">
            <div class="flex items-start gap-3">
                <!-- Thumbnail showing signature -->
                <div class="w-16 h-20 bg-[#070c18] rounded-lg overflow-hidden border border-emerald-500/30 flex-shrink-0 relative group cursor-pointer" onclick="openPdfPreview('signed', '${file.name}', '${file.last_page_preview_url || file.preview_url}')">
                    <img src="${file.last_page_preview_url || file.preview_url}?zoom=0.8" alt="${file.name}" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <i data-lucide="zoom-in" class="w-4 h-4 text-emerald-300"></i>
                    </div>
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                    <h4 class="text-xs font-bold text-white truncate" title="${file.name}">${file.name}</h4>
                    <p class="text-[11px] text-slate-400 mt-0.5">${formatLocalTime(file.modified_timestamp, file.modified_formatted)}</p>
                    
                    ${employeeName ? `
                        <div class="mt-1">
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 text-[10px] font-semibold border border-cyan-400/30 truncate max-w-full">
                                <i data-lucide="user" class="w-2.5 h-2.5"></i> ${employeeName}
                            </span>
                        </div>
                    ` : ''}

                    <div class="flex items-center gap-2 mt-2">
                        <span class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold flex items-center gap-1 border border-emerald-500/30">
                            <i data-lucide="check" class="w-3 h-3"></i> Signed
                        </span>
                        <span class="text-[10px] text-slate-400 font-mono">${file.size_formatted}</span>
                    </div>
                </div>
            </div>

            <!-- Action buttons -->
            <div class="pt-2 border-t border-emerald-500/20 flex items-center gap-1.5">
                <a href="${file.download_url}" target="_blank" class="flex-1 py-1.5 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 hover:from-emerald-600/30 hover:to-teal-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm">
                    <i data-lucide="download" class="w-3.5 h-3.5"></i> Download PDF
                </a>
                <button onclick="openPdfPreview('signed', '${file.name}', '${file.last_page_preview_url || file.preview_url}')" class="p-1.5 bg-[#101c3d] hover:bg-[#182b5c] text-cyan-300 border border-cyan-500/20 rounded-lg text-xs transition" title="Preview document">
                    <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                </button>
                <button onclick="deleteDocument('signed', '${file.name}')" class="p-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs transition" title="Remove signed document">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

async function deleteDocument(folder, filename) {
    let deleteFromGh = false;
    let confirmMsg = `Are you sure you want to remove "${filename}"?`;
    
    if (folder === 'pending' && gitHubConfig && gitHubConfig.is_configured) {
        confirmMsg = `Remove "${filename}" from pending documents?`;
    } else if (folder === 'signed' && gitHubConfig && gitHubConfig.is_configured) {
        confirmMsg = `Remove "${filename}" from signed documents?`;
    }

    if (!confirm(confirmMsg)) {
        return;
    }

    if ((folder === 'pending' || folder === 'signed') && gitHubConfig && gitHubConfig.is_configured) {
        deleteFromGh = confirm(`Do you also want to delete "${filename}" from the GitHub repository?`);
    }

    try {
        const res = await fetch(`/api/delete/${folder}/${encodeURIComponent(filename)}?delete_github=${deleteFromGh}`, {
            method: 'POST'
        });
        const data = await res.json();
        if (data.success) {
            refreshDocuments();
            if (gitHubConfig && gitHubConfig.is_configured) checkGitHubStatus();
        } else {
            alert(`Error deleting document: ${data.error}`);
        }
    } catch (err) {
        alert(`Failed to delete document: ${err.message}`);
    }
}

async function clearAllPendingDocs() {
    if (!confirm('Are you sure you want to remove ALL local pending documents?')) {
        return;
    }

    let clearGh = false;
    if (gitHubConfig && gitHubConfig.is_configured) {
        clearGh = confirm('Do you also want to clear all pending files from the GitHub repository?');
    }

    try {
        if (clearGh) {
            await fetch('/api/github/clear-pending', { method: 'POST' });
        }
        const res = await fetch('/api/clear/pending', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            refreshDocuments();
            if (gitHubConfig && gitHubConfig.is_configured) checkGitHubStatus();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (err) {
        alert(`Failed to clear pending documents: ${err.message}`);
    }
}

async function clearAllSignedDocs() {
    if (!confirm('Are you sure you want to remove ALL completed signed documents from the view?')) {
        return;
    }

    let clearGh = false;
    if (gitHubConfig && gitHubConfig.is_configured) {
        clearGh = confirm('Do you also want to delete all signed files from the GitHub repository?');
    }

    try {
        if (clearGh) {
            await fetch('/api/github/clear-signed', { method: 'POST' });
        }
        const res = await fetch('/api/clear/signed', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            refreshDocuments();
            if (gitHubConfig && gitHubConfig.is_configured) checkGitHubStatus();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (err) {
        alert(`Failed to clear signed documents: ${err.message}`);
    }
}

function setOneDrivePreset() {
    const defaultOneDrive = 'C:/Users/v-jkuchar/OneDrive - Nokian Tyres/IT_Handover';
    document.getElementById('setting_pending_dir').value = `${defaultOneDrive}/pending`;
    document.getElementById('setting_signed_dir').value = `${defaultOneDrive}/signed`;
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

// ----------------- VISUAL CALIBRATOR LOGIC -----------------

async function openCalibratorModal(targetFilename) {
    try {
        const cfgRes = await fetch('/api/config');
        const config = await cfgRes.json();
        
        const placement = config.signature_placement || {};
        if (placement.recipient) {
            calibCoords.recipient = { ...placement.recipient };
            calibCoords.issuer = { ...(placement.issuer || calibCoords.issuer) };
        } else if (placement.x) {
            calibCoords.recipient = { ...placement };
        }

        calibFilename = targetFilename || (pendingFiles.length > 0 ? pendingFiles[0].name : (signedFiles.length > 0 ? signedFiles[0].name : ''));
        const folder = pendingFiles.some(f => f.name === calibFilename) ? 'pending' : (signedFiles.some(f => f.name === calibFilename) ? 'signed' : 'pending');

        if (calibFilename) {
            const dimRes = await fetch(`/api/page-dimensions/${folder}/${encodeURIComponent(calibFilename)}/-1`);
            const dimData = await dimRes.json();
            if (dimData.success) {
                calibPdfWidth = dimData.width || 595.32;
                calibPdfHeight = dimData.height || 841.92;
            }
            document.getElementById('calibPageImg').src = `/api/preview/${folder}/${encodeURIComponent(calibFilename)}/-1?zoom=1.5&t=${Date.now()}`;
        } else {
            calibPdfWidth = 595.32;
            calibPdfHeight = 841.92;
            document.getElementById('calibPageImg').src = '';
        }

        const modal = document.getElementById('calibratorModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        selectCalibBox(calibActiveBox);
        setTimeout(updateCalibratorBoxVisuals, 100);
    } catch (err) {
        console.error('Error opening calibrator:', err);
    }
}

function closeCalibratorModal() {
    const modal = document.getElementById('calibratorModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function selectCalibBox(role) {
    calibActiveBox = role;
    const tabRecip = document.getElementById('calibTabRecip');
    const tabIssuer = document.getElementById('calibTabIssuer');

    if (role === 'recipient') {
        tabRecip.className = 'px-3 py-1 rounded-lg font-semibold bg-sky-600 text-white flex items-center gap-1.5 shadow';
        tabIssuer.className = 'px-3 py-1 rounded-lg font-semibold bg-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5';
    } else {
        tabIssuer.className = 'px-3 py-1 rounded-lg font-semibold bg-indigo-600 text-white flex items-center gap-1.5 shadow';
        tabRecip.className = 'px-3 py-1 rounded-lg font-semibold bg-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5';
    }

    updateCalibratorReadout();
}

function updateCalibratorReadout() {
    const coords = calibCoords[calibActiveBox];
    document.getElementById('calib_read_x').textContent = Math.round(coords.x);
    document.getElementById('calib_read_y').textContent = Math.round(coords.y);
    document.getElementById('calib_read_w').textContent = Math.round(coords.width);
    document.getElementById('calib_read_h').textContent = Math.round(coords.height);
}

function updateCalibratorBoxVisuals() {
    const container = document.getElementById('calibContainer');
    if (!container) return;

    const cWidth = container.offsetWidth;
    const cHeight = container.offsetHeight;
    if (!cWidth || !cHeight) return;

    const scaleX = cWidth / calibPdfWidth;
    const scaleY = cHeight / calibPdfHeight;

    // Position Recipient box
    const boxR = document.getElementById('boxRecipient');
    const cr = calibCoords.recipient;
    boxR.style.left = `${cr.x * scaleX}px`;
    boxR.style.top = `${cr.y * scaleY}px`;
    boxR.style.width = `${cr.width * scaleX}px`;
    boxR.style.height = `${cr.height * scaleY}px`;
    document.getElementById('boxRecipCoords').textContent = `${Math.round(cr.x)}, ${Math.round(cr.y)}`;

    // Position Issuer box
    const boxI = document.getElementById('boxIssuer');
    const ci = calibCoords.issuer;
    boxI.style.left = `${ci.x * scaleX}px`;
    boxI.style.top = `${ci.y * scaleY}px`;
    boxI.style.width = `${ci.width * scaleX}px`;
    boxI.style.height = `${ci.height * scaleY}px`;
    document.getElementById('boxIssuerCoords').textContent = `${Math.round(ci.x)}, ${Math.round(ci.y)}`;

    updateCalibratorReadout();
}

function initCalibratorInteractions() {
    ['boxRecipient', 'boxIssuer'].forEach(boxId => {
        const box = document.getElementById(boxId);
        if (!box) return;

        const role = boxId === 'boxRecipient' ? 'recipient' : 'issuer';
        let isDragging = false;
        let isResizing = false;
        let startX, startY, startLeft, startTop, startW, startH;

        box.addEventListener('mousedown', (e) => {
            selectCalibBox(role);
            if (e.target.classList.contains('resize-handle')) {
                isResizing = true;
            } else {
                isDragging = true;
            }
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseFloat(box.style.left) || 0;
            startTop = parseFloat(box.style.top) || 0;
            startW = parseFloat(box.style.width) || 100;
            startH = parseFloat(box.style.height) || 40;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging && !isResizing) return;
            const container = document.getElementById('calibContainer');
            const scaleX = container.offsetWidth / calibPdfWidth;
            const scaleY = container.offsetHeight / calibPdfHeight;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (isDragging) {
                let newL = Math.max(0, Math.min(startLeft + dx, container.offsetWidth - parseFloat(box.style.width)));
                let newT = Math.max(0, Math.min(startTop + dy, container.offsetHeight - parseFloat(box.style.height)));
                box.style.left = `${newL}px`;
                box.style.top = `${newT}px`;
                calibCoords[role].x = newL / scaleX;
                calibCoords[role].y = newT / scaleY;
            } else if (isResizing) {
                let newW = Math.max(40, startW + dx);
                let newH = Math.max(20, startH + dy);
                box.style.width = `${newW}px`;
                box.style.height = `${newH}px`;
                calibCoords[role].width = newW / scaleX;
                calibCoords[role].height = newH / scaleY;
            }

            updateCalibratorBoxVisuals();
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            isResizing = false;
        });
    });
}

function applyCalibPreset(preset) {
    if (preset === 'dual_bottom') {
        calibCoords.recipient = { x: 320, y: 630, width: 210, height: 70 };
        calibCoords.issuer = { x: 60, y: 630, width: 200, height: 70 };
    } else if (preset === 'right_only') {
        calibCoords.recipient = { x: 320, y: 630, width: 220, height: 80 };
        calibCoords.issuer = { x: 0, y: 0, width: 0, height: 0 };
    }
    updateCalibratorBoxVisuals();
}

async function saveCalibratorPlacement() {
    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                signature_placement: {
                    recipient: {
                        page: -1,
                        x: Math.round(calibCoords.recipient.x),
                        y: Math.round(calibCoords.recipient.y),
                        width: Math.round(calibCoords.recipient.width),
                        height: Math.round(calibCoords.recipient.height),
                        label: 'Employee / Recipient',
                        add_timestamp: true,
                        timestamp_fontsize: 7.5
                    },
                    issuer: {
                        page: -1,
                        x: Math.round(calibCoords.issuer.x),
                        y: Math.round(calibCoords.issuer.y),
                        width: Math.round(calibCoords.issuer.width),
                        height: Math.round(calibCoords.issuer.height),
                        label: 'IT Admin / Issuer',
                        add_timestamp: true,
                        timestamp_fontsize: 7.5
                    }
                }
            })
        });
        const data = await res.json();
        if (data.success) {
            closeCalibratorModal();
            alert('Signature box coordinates saved successfully!');
            document.getElementById('badge_recip_coords').textContent = `${Math.round(calibCoords.recipient.x)}, ${Math.round(calibCoords.recipient.y)} (${Math.round(calibCoords.recipient.width)}×${Math.round(calibCoords.recipient.height)})`;
            document.getElementById('badge_issuer_coords').textContent = `${Math.round(calibCoords.issuer.x)}, ${Math.round(calibCoords.issuer.y)} (${Math.round(calibCoords.issuer.width)}×${Math.round(calibCoords.issuer.height)})`;
        }
    } catch (e) {
        alert('Failed to save coordinates: ' + e.message);
    }
}

// ----------------- SETTINGS & MODALS -----------------

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
        const recip = placement.recipient || placement || {};
        const issuer = placement.issuer || {};

        document.getElementById('setting_x').value = recip.x || 320;
        document.getElementById('setting_y').value = recip.y || 630;
        document.getElementById('setting_w').value = recip.width || 210;
        document.getElementById('setting_h').value = recip.height || 70;

        document.getElementById('setting_issuer_x').value = issuer.x || 60;
        document.getElementById('setting_issuer_y').value = issuer.y || 630;
        document.getElementById('setting_issuer_w').value = issuer.width || 200;
        document.getElementById('setting_issuer_h').value = issuer.height || 70;

        document.getElementById('setting_public_url').value = config.public_url || '';
        document.getElementById('setting_pending_dir').value = config.pending_dir || 'pending';
        document.getElementById('setting_signed_dir').value = config.signed_dir || 'signed';

        // GitHub fields
        const ghRepoInput = document.getElementById('setting_github_repo');
        const ghTokenInput = document.getElementById('setting_github_token');
        const ghBranchInput = document.getElementById('setting_github_branch');
        const ghAutoDelInput = document.getElementById('setting_gh_auto_delete');
        const ghAutoUpInput = document.getElementById('setting_gh_auto_upload');
        const ghTestResult = document.getElementById('ghSettingsTestResult');
        let repoVal = config.github_repo || '';
        let tokenVal = config.github_token || '';
        let branchVal = config.github_branch || 'main';

        if (!repoVal || !tokenVal) {
            try {
                const cached = localStorage.getItem('it_signer_github_sync');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (!repoVal && parsed.github_repo) repoVal = parsed.github_repo;
                    if (!tokenVal && parsed.github_token) tokenVal = parsed.github_token;
                    if (parsed.github_branch) branchVal = parsed.github_branch;
                }
            } catch (e) {}
        }

        if (ghRepoInput) ghRepoInput.value = repoVal;
        if (ghTokenInput) ghTokenInput.value = tokenVal;
        if (ghBranchInput) ghBranchInput.value = branchVal;
        if (ghAutoDelInput) ghAutoDelInput.checked = config.auto_delete_github_pending !== false;
        if (ghAutoUpInput) ghAutoUpInput.checked = config.auto_upload_github_signed !== false;
        if (ghTestResult) ghTestResult.textContent = '';

        document.getElementById('setting_timestamp').checked = recip.add_timestamp !== false;
        document.getElementById('setting_archive').checked = config.auto_archive_pending !== false;
        if (document.getElementById('setting_timezone')) {
            document.getElementById('setting_timezone').value = config.timezone || 'Europe/Prague';
        }

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
    const pendingDir = document.getElementById('setting_pending_dir').value.trim();
    const signedDir = document.getElementById('setting_signed_dir').value.trim();
    const timezone = document.getElementById('setting_timezone') ? document.getElementById('setting_timezone').value : 'Europe/Prague';

    const ghRepo = (document.getElementById('setting_github_repo') ? document.getElementById('setting_github_repo').value.trim() : '');
    const ghToken = (document.getElementById('setting_github_token') ? document.getElementById('setting_github_token').value.trim() : '');
    const ghBranch = (document.getElementById('setting_github_branch') ? document.getElementById('setting_github_branch').value.trim() : 'main');
    const ghAutoDelete = document.getElementById('setting_gh_auto_delete') ? document.getElementById('setting_gh_auto_delete').checked : true;
    const ghAutoUpload = document.getElementById('setting_gh_auto_upload') ? document.getElementById('setting_gh_auto_upload').checked : true;

    const payload = {
        public_url: pubUrl,
        timezone: timezone,
        pending_dir: pendingDir || 'pending',
        signed_dir: signedDir || 'signed',
        github_repo: ghRepo,
        github_token: ghToken,
        github_branch: ghBranch || 'main',
        auto_delete_github_pending: ghAutoDelete,
        auto_upload_github_signed: ghAutoUpload,
        dual_signature: true,
        signature_placement: {
            recipient: {
                page: -1,
                x: parseFloat(document.getElementById('setting_x').value) || 320,
                y: parseFloat(document.getElementById('setting_y').value) || 630,
                width: parseFloat(document.getElementById('setting_w').value) || 210,
                height: parseFloat(document.getElementById('setting_h').value) || 70,
                label: 'Employee / Recipient',
                keep_aspect_ratio: true,
                add_timestamp: document.getElementById('setting_timestamp').checked,
                timestamp_fontsize: 7.5
            },
            issuer: {
                page: -1,
                x: parseFloat(document.getElementById('setting_issuer_x').value) || 60,
                y: parseFloat(document.getElementById('setting_issuer_y').value) || 630,
                width: parseFloat(document.getElementById('setting_issuer_w').value) || 200,
                height: parseFloat(document.getElementById('setting_issuer_h').value) || 70,
                label: 'IT Admin / Issuer',
                keep_aspect_ratio: true,
                add_timestamp: document.getElementById('setting_timestamp').checked,
                timestamp_fontsize: 7.5
            }
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
            // Save GitHub config to localStorage as client-side backup against ephemeral cloud resets (Render)
            try {
                if (ghRepo && ghToken) {
                    localStorage.setItem('it_signer_github_sync', JSON.stringify({
                        github_repo: ghRepo,
                        github_token: ghToken,
                        github_branch: ghBranch || 'main',
                        auto_delete_github_pending: ghAutoDelete,
                        auto_upload_github_signed: ghAutoUpload
                    }));
                } else {
                    localStorage.removeItem('it_signer_github_sync');
                }
            } catch (storageErr) {
                console.warn('Could not cache GitHub settings in localStorage:', storageErr);
            }

            closeSettingsModal();
            alert('Settings saved successfully!');
            if (pubUrl) {
                currentIp = pubUrl;
                updateHeroQr();
            }
            refreshDocuments();
            checkGitHubStatus();
        }
    } catch (err) {
        alert(`Failed to save settings: ${err.message}`);
    }
}

// ----------------- GITHUB REPOSITORY MANAGER -----------------

async function checkGitHubStatus() {
    try {
        let res = await fetch('/api/github/status');
        let data = await res.json();

        // If backend lost config (e.g. Render restarted / spun down), auto-restore from browser localStorage
        if (!data.is_configured) {
            try {
                const cached = localStorage.getItem('it_signer_github_sync');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed.github_repo && parsed.github_token) {
                        console.log('Restoring GitHub credentials from browser storage...');
                        const restoreRes = await fetch('/api/config', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(parsed)
                        });
                        const restoreData = await restoreRes.json();
                        if (restoreData.success) {
                            res = await fetch('/api/github/status');
                            data = await res.json();
                        }
                    }
                }
            } catch (syncErr) {
                console.warn('Could not restore GitHub config from localStorage:', syncErr);
            }
        }

        gitHubConfig = data;

        if (data.is_configured) {
            try {
                const [pRes, sRes] = await Promise.all([
                    fetch('/api/github/pending'),
                    fetch('/api/github/signed')
                ]);
                const pData = await pRes.json();
                const sData = await sRes.json();
                if (pData.success && Array.isArray(pData.files)) gitHubPendingFiles = pData.files;
                if (sData.success && Array.isArray(sData.files)) gitHubSignedFiles = sData.files;
            } catch (e) {
                console.warn('Error updating GitHub lists:', e);
            }

            const pBadge = document.getElementById('ghPendingCountBadge');
            if (pBadge) pBadge.textContent = gitHubPendingFiles.length;
            const sBadge = document.getElementById('ghSignedCountBadge');
            if (sBadge) sBadge.textContent = gitHubSignedFiles.length;

            const tpBadge = document.getElementById('ghTabPendingBadge');
            if (tpBadge) tpBadge.textContent = gitHubPendingFiles.length;
            const tsBadge = document.getElementById('ghTabSignedBadge');
            if (tsBadge) tsBadge.textContent = gitHubSignedFiles.length;
        } else {
            const pBadge = document.getElementById('ghPendingCountBadge');
            if (pBadge) pBadge.textContent = 'Not setup';
            const sBadge = document.getElementById('ghSignedCountBadge');
            if (sBadge) sBadge.textContent = 'Not setup';
        }
    } catch (err) {
        console.error('Error checking GitHub status:', err);
    }
}

function openGitHubManagerModal(folder = 'pending') {
    const modal = document.getElementById('githubModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    switchGitHubTab(folder || 'pending');
}

function closeGitHubManagerModal() {
    const modal = document.getElementById('githubModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function switchGitHubTab(folder) {
    currentGitHubTab = folder || 'pending';
    const pendingBtn = document.getElementById('ghTabPendingBtn');
    const signedBtn = document.getElementById('ghTabSignedBtn');
    const clearBtnLabel = document.getElementById('ghClearBtnLabel');

    if (currentGitHubTab === 'signed') {
        if (signedBtn) {
            signedBtn.className = 'px-4 py-2 border-b-2 border-emerald-500 text-emerald-400 font-semibold text-xs flex items-center gap-2 transition';
        }
        if (pendingBtn) {
            pendingBtn.className = 'px-4 py-2 border-b-2 border-transparent text-slate-400 hover:text-slate-200 font-semibold text-xs flex items-center gap-2 transition';
        }
        if (clearBtnLabel) clearBtnLabel.textContent = 'Delete All from GitHub Signed';
    } else {
        if (pendingBtn) {
            pendingBtn.className = 'px-4 py-2 border-b-2 border-sky-500 text-sky-400 font-semibold text-xs flex items-center gap-2 transition';
        }
        if (signedBtn) {
            signedBtn.className = 'px-4 py-2 border-b-2 border-transparent text-slate-400 hover:text-slate-200 font-semibold text-xs flex items-center gap-2 transition';
        }
        if (clearBtnLabel) clearBtnLabel.textContent = 'Delete All from GitHub Pending';
    }

    refreshCurrentGitHubFolder();
}

async function refreshCurrentGitHubFolder() {
    const container = document.getElementById('ghFileListContainer');
    const statusDot = document.getElementById('ghStatusDot');
    const statusText = document.getElementById('ghStatusText');
    const setupPrompt = document.getElementById('ghSetupPrompt');
    const clearBtn = document.getElementById('ghClearAllBtn');
    const folder = currentGitHubTab || 'pending';
    const folderLabel = folder === 'signed' ? 'Signed' : 'Pending';

    if (!container) return;

    container.innerHTML = `
        <div class="py-8 text-center text-slate-500 text-xs">
            <i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto mb-2 text-sky-400"></i>
            Loading GitHub ${folderLabel.toLowerCase()} files...
        </div>
    `;
    if (window.lucide) lucide.createIcons();

    try {
        const statusRes = await fetch('/api/github/status');
        const statusData = await statusRes.json();
        gitHubConfig = statusData;

        if (!statusData.is_configured) {
            if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
            if (statusText) statusText.textContent = 'GitHub integration not configured';
            if (setupPrompt) setupPrompt.classList.remove('hidden');
            if (clearBtn) {
                clearBtn.disabled = true;
                clearBtn.classList.add('opacity-50', 'cursor-not-allowed');
            }

            container.innerHTML = `
                <div class="bg-slate-950/40 border border-slate-800 rounded-xl p-6 text-center space-y-2">
                    <i data-lucide="github" class="w-8 h-8 mx-auto text-slate-600"></i>
                    <h4 class="text-xs font-bold text-slate-300">GitHub Repository Not Connected</h4>
                    <p class="text-[11px] text-slate-500 max-w-sm mx-auto">Configure your repository and Personal Access Token in Settings to view and delete files sitting in GitHub.</p>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        if (setupPrompt) setupPrompt.classList.add('hidden');
        if (clearBtn) {
            clearBtn.disabled = false;
            clearBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
        if (statusText) statusText.innerHTML = `Connected to <strong class="text-white font-mono">${statusData.repo}</strong> (<span class="text-sky-300 font-mono">${statusData.branch}</span>)`;

        const res = await fetch(`/api/github/${folder}`);
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || `Failed to load GitHub ${folder} files`);
        }

        const files = data.files || [];
        if (folder === 'signed') {
            gitHubSignedFiles = files;
            const b = document.getElementById('ghSignedCountBadge');
            if (b) b.textContent = files.length;
            const tb = document.getElementById('ghTabSignedBadge');
            if (tb) tb.textContent = files.length;
        } else {
            gitHubPendingFiles = files;
            const b = document.getElementById('ghPendingCountBadge');
            if (b) b.textContent = files.length;
            const tb = document.getElementById('ghTabPendingBadge');
            if (tb) tb.textContent = files.length;
        }

        if (files.length === 0) {
            container.innerHTML = `
                <div class="bg-slate-950/40 border border-slate-800 rounded-xl p-8 text-center space-y-2">
                    <i data-lucide="check-circle-2" class="w-8 h-8 mx-auto text-emerald-400"></i>
                    <h4 class="text-xs font-bold text-slate-200">GitHub ${folderLabel} Folder is Clean!</h4>
                    <p class="text-[11px] text-slate-400">No ${folderLabel.toLowerCase()} files found on GitHub repository.</p>
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        container.innerHTML = files.map(file => {
            return `
            <div class="bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-xl p-3 flex items-center justify-between gap-3 transition">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-9 h-9 rounded-lg ${folder === 'signed' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-sky-500/10 border-sky-500/20 text-sky-400'} border flex items-center justify-center flex-shrink-0">
                        <i data-lucide="file-text" class="w-4 h-4"></i>
                    </div>
                    <div class="min-w-0">
                        <h4 class="text-xs font-bold text-white truncate" title="${file.name}">${file.name}</h4>
                        <div class="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-mono">
                            <span>${file.size_formatted}</span>
                            <span>•</span>
                            <a href="${file.html_url || '#'}" target="_blank" class="text-sky-400 hover:underline flex items-center gap-0.5">
                                View on GitHub <i data-lucide="external-link" class="w-2.5 h-2.5"></i>
                            </a>
                        </div>
                    </div>
                </div>
                <button data-folder="${folder}" data-filename="${encodeURIComponent(file.name)}" onclick="deleteGitHubFile(this.getAttribute('data-folder'), decodeURIComponent(this.getAttribute('data-filename')))" class="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition flex items-center gap-1 flex-shrink-0" title="Delete from GitHub repository">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete
                </button>
            </div>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();
    } catch (err) {
        if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-400';
        if (statusText) statusText.textContent = `GitHub Error: ${err.message}`;
        container.innerHTML = `
            <div class="bg-rose-950/20 border border-rose-800/40 rounded-xl p-4 text-center text-xs text-rose-300">
                ${err.message}
            </div>
        `;
    }
}

async function deleteGitHubFile(folder, filename) {
    const fType = folder || currentGitHubTab || 'pending';
    if (!confirm(`Are you sure you want to permanently delete "${filename}" from GitHub's ${fType} folder?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/github/delete/${fType}/${encodeURIComponent(filename)}`, {
            method: 'POST'
        });
        const data = await res.json();
        if (data.success) {
            refreshCurrentGitHubFolder();
            refreshDocuments();
            checkGitHubStatus();
        } else {
            const rawErr = data.error || 'Unknown error';
            const displayErr = rawErr.startsWith('Failed to delete') ? rawErr : `Failed to delete from GitHub: ${rawErr}`;
            alert(displayErr);
        }
    } catch (err) {
        alert(`Error: ${err.message}`);
    }
}

async function clearAllCurrentGitHubFolder() {
    const fType = currentGitHubTab || 'pending';
    if (!confirm(`Are you sure you want to permanently delete ALL files from the GitHub ${fType} folder?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/github/clear-${fType}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            refreshCurrentGitHubFolder();
            refreshDocuments();
            checkGitHubStatus();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (err) {
        alert(`Failed to clear GitHub ${fType}: ${err.message}`);
    }
}

// ----------------- LOCAL PC AUTO-SAVE (DIRECT FILE SYSTEM ACCESS) -----------------

const IDB_NAME = 'ITSignerStore';
const IDB_STORE = 'handles';

function getIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key) {
    try {
        const db = await getIDB();
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
}

async function idbSet(key, val) {
    try {
        const db = await getIDB();
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(val, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {}
}

async function idbDel(key) {
    try {
        const db = await getIDB();
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch (e) {}
}

async function initLocalAutoSave() {
    try {
        const savedHandle = await idbGet('signed_folder_handle');
        const enabled = localStorage.getItem('it_autosave_enabled') === 'true';
        if (savedHandle && enabled) {
            localFolderHandle = savedHandle;
            const perm = await savedHandle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                autoSaveActive = true;
                updateAutoSaveUI(savedHandle.name, true);
            } else {
                updateAutoSaveUI(savedHandle.name, false);
            }
        }
    } catch (e) {
        console.warn('Auto-save init check:', e);
    }
}

function updateAutoSaveUI(folderName, isGranted = true) {
    const label = document.getElementById('localAutoSaveLabel');
    const icon = document.getElementById('localAutoSaveIcon');
    const btn = document.getElementById('btnLocalAutoSave');
    const currBox = document.getElementById('localAutoSaveCurrentFolderBox');
    const currName = document.getElementById('localAutoSaveFolderName');
    const disableBtn = document.getElementById('btnDisableAutoSave');
    const pickBtnText = document.getElementById('btnPickFolderText');

    if (folderName && isGranted) {
        if (label) label.textContent = `Auto-Save: ${folderName}`;
        if (btn) {
            btn.className = 'px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow-sm';
        }
        if (icon) icon.className = 'w-3.5 h-3.5 text-emerald-400';
        if (currBox) currBox.classList.remove('hidden');
        if (currName) currName.textContent = folderName;
        if (disableBtn) disableBtn.classList.remove('hidden');
        if (pickBtnText) pickBtnText.textContent = 'Change Target Folder';
    } else if (folderName && !isGranted) {
        if (label) label.textContent = `Auto-Save: ${folderName} (Click to authorize)`;
        if (btn) {
            btn.className = 'px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow-sm';
        }
        if (icon) icon.className = 'w-3.5 h-3.5 text-amber-400';
        if (currBox) currBox.classList.remove('hidden');
        if (currName) currName.textContent = `${folderName} (needs permission)`;
        if (disableBtn) disableBtn.classList.remove('hidden');
        if (pickBtnText) pickBtnText.textContent = 'Re-authorize / Change Folder';
    } else {
        if (label) label.textContent = 'Auto-Save to PC Folder';
        if (btn) {
            btn.className = 'px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow-sm';
        }
        if (icon) icon.className = 'w-3.5 h-3.5 text-sky-400';
        if (currBox) currBox.classList.add('hidden');
        if (disableBtn) disableBtn.classList.add('hidden');
        if (pickBtnText) pickBtnText.textContent = 'Choose Folder on Computer';
    }
}

function setupLocalAutoSave() {
    const modal = document.getElementById('localAutoSaveModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeLocalAutoSaveModal() {
    const modal = document.getElementById('localAutoSaveModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function pickLocalDirectory() {
    if (!window.showDirectoryPicker) {
        alert('Your web browser does not support Direct Folder Access. Please open this page in Microsoft Edge or Google Chrome to enable native folder auto-saving.');
        return;
    }

    try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        if (handle) {
            localFolderHandle = handle;
            autoSaveActive = true;
            await idbSet('signed_folder_handle', handle);
            localStorage.setItem('it_autosave_enabled', 'true');
            updateAutoSaveUI(handle.name, true);
            closeLocalAutoSaveModal();
            showToast(`✓ Auto-save activated for folder: ${handle.name}`);

            triggerAutoSaveForNewDocs(signedFiles);
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            alert(`Could not access folder: ${err.message}`);
        }
    }
}

async function disableLocalAutoSave() {
    localFolderHandle = null;
    autoSaveActive = false;
    localStorage.removeItem('it_autosave_enabled');
    await idbDel('signed_folder_handle');
    updateAutoSaveUI(null);
    closeLocalAutoSaveModal();
    showToast('Auto-save to PC folder turned off.');
}

async function triggerAutoSaveForNewDocs(signedList) {
    if (!autoSaveActive || !localFolderHandle || !Array.isArray(signedList) || signedList.length === 0) return;

    for (const doc of signedList) {
        if (!autoSavedFiles.has(doc.name)) {
            try {
                const res = await fetch(`/download/signed/${encodeURIComponent(doc.name)}`);
                if (!res.ok) continue;
                const blob = await res.blob();

                const fileHandle = await localFolderHandle.getFileHandle(doc.name, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();

                autoSavedFiles.add(doc.name);
                localStorage.setItem('it_autosaved_files', JSON.stringify(Array.from(autoSavedFiles)));
                showToast(`💾 Auto-saved "${doc.name}" to your PC folder!`);
            } catch (err) {
                console.error('Error auto-saving document to PC:', doc.name, err);
            }
        }
    }
}

function showToast(message) {
    let toast = document.getElementById('itSignerToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'itSignerToast';
        toast.className = 'fixed bottom-5 right-5 z-50 bg-slate-900/95 border border-emerald-500/40 text-emerald-300 text-xs font-semibold px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 transform translate-y-12 opacity-0 flex items-center gap-2 backdrop-blur-sm';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400 flex-shrink-0"></i> <span>${message}</span>`;
    if (window.lucide) lucide.createIcons();

    toast.classList.remove('translate-y-12', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-12', 'opacity-0');
    }, 4000);
}

async function testGitHubConnectionFromSettings() {
    const repo = document.getElementById('setting_github_repo').value.trim();
    const token = document.getElementById('setting_github_token').value.trim();
    const resultEl = document.getElementById('ghSettingsTestResult');

    if (!repo) {
        resultEl.className = 'text-[11px] font-medium text-amber-400 py-1.5 leading-tight';
        resultEl.textContent = 'Please enter a repository (owner/repo).';
        return;
    }

    resultEl.className = 'text-[11px] font-medium text-sky-400 py-1.5 leading-tight';
    resultEl.innerHTML = '<i data-lucide="loader-2" class="w-3 h-3 animate-spin inline mr-1"></i> Testing...';
    if (window.lucide) lucide.createIcons();

    try {
        const res = await fetch('/api/github/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo, token })
        });
        const data = await res.json();

        if (data.success) {
            if (data.warning) {
                resultEl.className = 'text-[11px] font-medium text-amber-400 py-1.5 leading-relaxed';
                resultEl.innerHTML = `⚠️ <strong>Connected</strong>, but: ${data.warning}`;
            } else {
                resultEl.className = 'text-[11px] font-medium text-emerald-400 py-1.5 leading-relaxed';
                resultEl.textContent = `✓ Connected to ${data.full_name} (${data.default_branch}) with write access`;
            }
        } else {
            resultEl.className = 'text-[11px] font-medium text-rose-400 py-1.5 leading-relaxed';
            resultEl.textContent = `✕ ${data.error}`;
        }
    } catch (err) {
        resultEl.className = 'text-[11px] font-medium text-rose-400 py-1.5 leading-relaxed';
        resultEl.textContent = `✕ Connection failed: ${err.message}`;
    }
}
