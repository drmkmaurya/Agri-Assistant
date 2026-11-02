let currentLanguage = 'hi';
let selectedAttachments = [];
let isWebSearchActive = false;
let currentActiveActionBar = null;
let memoryChatHistory = [];
let storageSaveTimer = null;
const CHAT_STORAGE_KEY = 'agri_mitra_chat_history_v2';
const FONT_PREF_KEY = 'agri_font_preference';

function nowTime() { 
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); 
}

function toBottom() { 
    const c = document.getElementById('chatCanvas'); 
    c.scrollTop = c.scrollHeight; 
}

function autoGrowTextarea(el) {
    el.style.height = 'auto';
    const newHeight = el.scrollHeight;
    if (newHeight > 96) {
        el.style.height = '96px';
        el.style.overflowY = 'auto';
    } else {
        el.style.height = Math.max(24, newHeight) + 'px';
        el.style.overflowY = 'hidden';
    }
}

function keyMonitor(e) { 
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); 
        submitMessage(); 
    } 
}

function handleLanguageChange(lang) {
    currentLanguage = lang;
    showToast(lang === 'hi' ? 'भाषा: हिन्दी सक्रिय (100% Hindi Response)' : 'Language: English Active (100% English Response)');
}

function toggleMenu() {
    const m = document.getElementById('userMenu');
    const b = document.getElementById('menuBackdrop');
    const isOpen = (m.style.display === 'block');
    m.style.display = isOpen ? 'none' : 'block';
    b.style.display = isOpen ? 'none' : 'block';
}

function closeMenu() {
    document.getElementById('userMenu').style.display = 'none';
    document.getElementById('menuBackdrop').style.display = 'none';
}

function setFontSize(size) {
    const root = document.documentElement;
    document.querySelectorAll('.font-size-btn').forEach(b => b.classList.remove('active'));
    if (size === 'small') {
        root.style.setProperty('--chat-font-size', '14px');
        root.style.setProperty('--chat-line-height', '1.45');
        document.getElementById('btnFontSmall').classList.add('active');
    } else if (size === 'large') {
        root.style.setProperty('--chat-font-size', '17.5px');
        root.style.setProperty('--chat-line-height', '1.55');
        document.getElementById('btnFontLarge').classList.add('active');
    } else {
        root.style.setProperty('--chat-font-size', '15.5px');
        root.style.setProperty('--chat-line-height', '1.5');
        document.getElementById('btnFontMedium').classList.add('active');
    }
    localStorage.setItem(FONT_PREF_KEY, size);
}

function loadSavedFontPreference() {
    const saved = localStorage.getItem(FONT_PREF_KEY) || 'medium';
    setFontSize(saved);
}

function clearLocalHistoryManual() {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    alert('स्थानीय चैट हिस्ट्री साफ़ कर दी गई है।');
    location.reload();
}

function triggerAttachmentPicker() {
    if (!isUserPaidActive) {
        document.getElementById('featureLockModal').style.display = 'flex';
        return;
    }
    document.getElementById('fileInput').click();
}

function closeFeatureLock() {
    document.getElementById('featureLockModal').style.display = 'none';
}

function showAttachmentErrorModal(title, msgHtml) {
    document.getElementById('attachErrorTitle').textContent = title;
    document.getElementById('attachErrorDesc').innerHTML = msgHtml;
    document.getElementById('attachmentErrorModal').style.display = 'flex';
}

function closeAttachmentErrorModal() {
    document.getElementById('attachmentErrorModal').style.display = 'none';
}

function handleFileSelected(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    if (files.length > 2) {
        showAttachmentErrorModal('फाइलों की सीमा पार हुई', `आप एक बार में <b>अधिकतम 2 फाइलें</b> ही संलग्न कर सकते हैं। आपने <b>${files.length} फाइलें</b> चुनी हैं।`);
        event.target.value = '';
        return;
    }

    const validFiles = [];
    for (let f of files) {
        const sizeMb = f.size / (1024 * 1024);
        if (sizeMb > 10) {
            showAttachmentErrorModal('फाइल साइज़ अधिक है', `फाइल "<b>${f.name}</b>" का साइज़ <b>${sizeMb.toFixed(1)}MB</b> है।<br>कृपया <b>10MB से छोटी</b> फाइल चुनें।`);
            event.target.value = '';
            return;
        }
        const isImage = f.type.startsWith('image/');
        const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
        if (!isImage && !isPdf) {
            showAttachmentErrorModal('अमान्य फाइल प्रारूप', `फाइल "<b>${f.name}</b>" अमान्य है। केवल <b>फोटो (JPG, PNG, WEBP)</b> या <b>PDF</b> ही स्वीकार्य हैं।`);
            event.target.value = '';
            return;
        }
        validFiles.push(f);
    }

    selectedAttachments = validFiles;
    const chip = document.getElementById('attachmentChip');
    const fileNameEl = document.getElementById('attachedFileName');
    fileNameEl.textContent = `📎 ${validFiles.length} फाइल संलग्न (${validFiles.map(f => f.name.substring(0, 10)).join(', ')})`;
    chip.style.display = 'flex';
}

function removeAttachment() {
    selectedAttachments = [];
    document.getElementById('fileInput').value = '';
    document.getElementById('attachmentChip').style.display = 'none';
}

function toggleWebSearch() {
    if (!isUserPaidActive || currentUserPlan !== 'pro') {
        showToast('🌐 इंटरनेट सर्च केवल Pro प्लान में उपलब्ध है।');
        openPricing();
        return;
    }
    isWebSearchActive = !isWebSearchActive;
    const btn = document.getElementById('btnWebToggle');
    if (isWebSearchActive) {
        btn.classList.add('active');
        showToast('🌐 इंटरनेट सर्च सक्रिय (Live Web Enabled)');
    } else {
        btn.classList.remove('active');
        showToast('🌐 इंटरनेट सर्च बंद (Channel Library Only)');
    }
}

function askQuickChip(questionText) {
    document.getElementById('msgField').value = questionText;
    submitMessage(questionText);
}

function queueSaveLocalMessage(type, html, time, rawText = '') {
    memoryChatHistory.push({ type, html, time, rawText, timestamp: Date.now() });
    if (memoryChatHistory.length > 20) {
        memoryChatHistory.shift();
    }
    clearTimeout(storageSaveTimer);
    storageSaveTimer = setTimeout(() => {
        try {
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(memoryChatHistory));
        } catch(e) {}
    }, 1200);
}

function cleanAndLoadLocalHistory() {
    try {
        const raw = localStorage.getItem(CHAT_STORAGE_KEY);
        if (!raw) return;
        const messages = JSON.parse(raw);
        const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
        memoryChatHistory = messages.filter(m => m.timestamp > dayAgo).slice(-20);

        memoryChatHistory.forEach((m, idx) => {
            const isLast = (idx === memoryChatHistory.length - 1 && m.type === 'bot');
            if (m.type === 'user') {
                renderUserBubbleDirect(m.html, m.time, true);
            } else {
                renderBotBubbleDirect(m.html, m.time, isLast, m.rawText);
            }
        });
    } catch(e) {}
}

function updateDateDivider() {
    const d = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    document.getElementById('todayDateDivider').textContent = `आज • ${d.toLocaleDateString('hi-IN', options)}`;
}

function extractTextFromActionBtn(btn) {
    const bubble = btn.closest('.bot-bubble');
    if (!bubble) return '';
    const clone = bubble.cloneNode(true);
    const bar = clone.querySelector('.meta-action-bar');
    if (bar) bar.remove();
    const meta = clone.querySelector('.bubble-meta');
    if (meta) meta.remove();
    const header = clone.querySelector('.bubble-meta-header');
    if (header) header.remove();
    const sources = clone.querySelector('.sources-wrapper');
    if (sources) sources.remove();
    return clone.innerText.trim();
}

function handleCopyClick(btn) {
    const text = extractTextFromActionBtn(btn);
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => showToast('उत्तर कॉपी हो गया!')).catch(() => {});
}

function handleWhatsAppClick(btn) {
    const raw = extractTextFromActionBtn(btn);
    if (!raw) return;
    let formatted = raw.replace(/\*\*(.*?)\*\*/g, '*$1*').trim();
    const shareMessage = `🌾 *Agri Mitra (कृषि मित्र) सलाह*\n\n${formatted}\n\n━━━━━━━━━━━━━━━━━━━━\n📲 *कृषि मित्र AI से अपनी फसल के सवाल पूछें:* https://agri-assistant-two.vercel.app`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessage)}`, '_blank');
}

function renderUserBubbleDirect(textHtml, time, isHistory = false) {
    const rowId = 'usr-' + Date.now();
    const uHtml = `
        <div class="msg-row user" id="${rowId}">
            <div class="bubble user-bubble">
                ${textHtml}
                <div class="bubble-meta">
                    <span>${time}</span>
                    <svg class="tick-svg ${isHistory ? 'blue' : ''}" viewBox="0 0 16 11">
                        <path d="M11.5 0L6.5 5.5 4.5 3.5 3 5l3.5 3.5 6.5-7.5zM15 0L10 5.5 11 6.5 15.5 1.5z"/>
                    </svg>
                </div>
            </div>
        </div>`;
    document.getElementById('plantLoader').insertAdjacentHTML('beforebegin', uHtml);
    toBottom();
    return rowId;
}

function renderBotBubbleDirect(innerHtml, time, isLatest = false, rawForCopy = '') {
    if (currentActiveActionBar && currentActiveActionBar.parentNode) {
        currentActiveActionBar.remove();
        currentActiveActionBar = null;
    }

    let actionsHtml = '';
    if (isLatest) {
        actionsHtml = `
            <div class="meta-action-bar" id="activeActionBar">
                <span class="ai-gen-label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#008069"><path d="M7.5 5.6L5 7l1.4-2.5L5 2l2.5 1.4L10 2 8.6 4.5 10 7 7.5 5.6zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14l-2.5 1.4zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5L22 2z"/></svg>
                    AI Generated
                </span>
                <div class="action-pills-group">
                    <button class="action-pill-btn" onclick="handleCopyClick(this)" title="कॉपी करें">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                        <span>Copy</span>
                    </button>
                    <button class="action-pill-btn whatsapp-share-btn" onclick="handleWhatsAppClick(this)" title="WhatsApp पर साझा करें">
                        <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.91-9.91-9.91zm0 18.16c-1.49 0-2.95-.4-4.22-1.16l-.3-.18-3.13.82.84-3.05-.2-.31c-.83-1.32-1.27-2.85-1.27-4.47 0-4.55 3.7-8.25 8.25-8.25 4.55 0 8.25 3.7 8.25 8.25 0 4.55-3.7 8.25-8.22 8.25zm4.52-6.19c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43s-.56-1.34-.76-1.84c-.2-.49-.4-.42-.56-.43h-.47c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.61.12.17 1.77 2.7 4.29 3.79.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.18-.47-.3z"/></svg>
                        <span>WhatsApp</span>
                    </button>
                </div>
            </div>`;
    }

    const bHtml = `
        <div class="msg-row bot">
            <div class="bubble bot-bubble">
                <div class="bubble-meta-header">
                    <span class="meta-sparkle">🌾</span>
                    <span>Agri Mitra AI</span>
                </div>
                ${innerHtml}
                <div class="bubble-meta">
                    <span>${time}</span>
                </div>
                ${actionsHtml}
            </div>
        </div>`;
    document.getElementById('plantLoader').insertAdjacentHTML('beforebegin', bHtml);
    if (isLatest) {
        currentActiveActionBar = document.getElementById('activeActionBar');
    }
    toBottom();
}

async function submitMessage(customTxt) {
    const text = (customTxt || document.getElementById('msgField').value).trim();
    if (!text && !selectedAttachments.length) return;
    if (!currentUser) { alert('कृपया पहले Google से लॉगिन करें।'); return; }

    if (currentActiveActionBar && currentActiveActionBar.parentNode) {
        currentActiveActionBar.remove();
        currentActiveActionBar = null;
    }

    const time = nowTime();
    
    let displayMsg = text;
    if (selectedAttachments.length > 0) {
        const fileList = selectedAttachments.map(f => f.name).join(', ');
        displayMsg = (text ? text + '<br>' : '') + `<small style="color:#065f46; font-weight:600;">📎 ${selectedAttachments.length} संलग्न फाइलें: ${fileList}</small>`;
    }

    const safeUserText = displayMsg.replace(/\n/g, '<br>');
    const rowId = renderUserBubbleDirect(safeUserText, time, false);
    queueSaveLocalMessage('user', safeUserText, time);
    
    const attachCount = selectedAttachments.length;
    const field = document.getElementById('msgField');
    field.value = '';
    field.style.height = '24px';
    field.style.overflowY = 'hidden';
    removeAttachment();
    
    document.getElementById('plantLoader').style.display = 'flex';
    toBottom();

    try {
        const res = await apiRequest('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                query: text, 
                user_id: currentUser.id,
                attachment_count: attachCount,
                language: currentLanguage,
                web_search_enabled: isWebSearchActive
            })
        });
        const data = await res.json();
        document.getElementById('plantLoader').style.display = 'none';

        const r = document.getElementById(rowId);
        if (r) {
            const tick = r.querySelector('.tick-svg');
            if (tick) tick.classList.add('blue');
        }

        if (!res.ok) {
            renderBotBubbleDirect(data.detail || 'तकनीकी समस्या आई। आपका क्रेडिट नहीं काटा गया है।', nowTime(), false);
            return;
        }

        fetchStats();

        let rawText = data.answer.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        rawText = rawText.replace(/\n/g, '<br>');
        let finalContent = '<div>' + rawText + '</div>';

        if (data.sources && data.sources.length > 0) {
            finalContent += '<div class="sources-wrapper"><div class="sources-title">📺 संदर्भ वीडियो क्लिप (सटीक भाग):</div>';
            data.sources.forEach(s => {
                finalContent += `
                    <a href="${s.video_url}" target="_blank" class="clip-card">
                        <div class="clip-header">▶️ [${s.duration}] ${s.title}</div>
                        <div class="clip-summary">${s.summary}</div>
                    </a>`;
            });
            finalContent += '</div>';
        }

        renderBotBubbleDirect(finalContent, nowTime(), true, data.answer);
        queueSaveLocalMessage('bot', finalContent, nowTime(), data.answer);

    } catch(e) {
        document.getElementById('plantLoader').style.display = 'none';
        renderBotBubbleDirect('सर्वर से संपर्क नहीं हो सका। आपका कोई क्रेडिट नहीं काटा गया है।', nowTime(), false);
    }
    toBottom();
}
