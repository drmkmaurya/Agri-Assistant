let currentLanguage = 'hi';
let selectedAttachments = [];
let isWebSearchActive = false;
let currentActiveActionBar = null;
let memoryChatHistory = [];
let storageSaveTimer = null;
const CHAT_STORAGE_KEY = 'agri_mitra_chat_history_v2';
const FONT_PREF_KEY = 'agri_font_preference';
const DRAFT_STORAGE_KEY = 'agri_mitra_draft_msg';

let speechRecognizer = null;
let isRecognizingVoice = false;
let pendingUserQuery = null;

let lastBackPressTime = 0;

/* Hardware Native Back Button Handling via Hash History & Double Back to Exit */
function openViewWithHistory(viewId) {
    document.querySelectorAll('.app-view-screen').forEach(el => el.classList.remove('active'));
    const v = document.getElementById(viewId);
    if (v) {
        v.classList.add('active');
        window.location.hash = viewId;
    }
}

window.addEventListener('popstate', (e) => {
    const hash = window.location.hash.replace('#', '');
    const activeViews = document.querySelectorAll('.app-view-screen.active');

    if (activeViews.length > 0 && !hash) {
        activeViews.forEach(el => el.classList.remove('active'));
        return;
    }

    if (hash && document.getElementById(hash)) {
        document.querySelectorAll('.app-view-screen').forEach(el => el.classList.remove('active'));
        document.getElementById(hash).classList.add('active');
    } else {
        // Double back to exit protection on root chat screen
        const now = Date.now();
        if (now - lastBackPressTime < 2000) {
            // Exit allowed
        } else {
            lastBackPressTime = now;
            showToast('बाहर निकलने के लिए एक बार फिर बैक दबाएं');
            history.pushState(null, '', window.location.pathname);
        }
    }
});

// Set initial history state for root screen
window.addEventListener('load', () => {
    history.replaceState(null, '', window.location.pathname);
});

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

/* Auto-Save Draft (24 Hours locally) */
function handleComposerInput(el) {
    autoGrowTextarea(el);
    const val = el.value;
    const hasText = val.trim().length > 0;
    const btn = document.getElementById('btnComposerAction');
    const svg = document.getElementById('svgComposerIcon');

    if (hasText) {
        svg.innerHTML = '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>';
        btn.setAttribute('title', 'संदेश भेजें');
    } else {
        svg.innerHTML = '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>';
        btn.setAttribute('title', 'बोलकर पूछें');
    }

    try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ text: val, timestamp: Date.now() }));
    } catch(e) {}
}

function restoreDraftMessage() {
    try {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!raw) return;
        const draft = JSON.parse(raw);
        if (Date.now() - draft.timestamp < 24 * 60 * 60 * 1000 && draft.text) {
            const field = document.getElementById('msgField');
            field.value = draft.text;
            handleComposerInput(field);
        }
    } catch(e) {}
}

/* Composer Action Trigger */
function handleComposerAction() {
    const text = document.getElementById('msgField').value.trim();
    if (text || selectedAttachments.length) {
        submitMessage();
    } else {
        toggleVoiceDictation();
    }
}

/* Voice Dictation (Type Only - Never Auto-Sends) */
let waveAnimationTimer = null;
function toggleVoiceDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('ब्राउज़र में वॉइस टाइपिंग उपलब्ध नहीं है।');
        return;
    }

    const btn = document.getElementById('btnComposerAction');
    const waveBar = document.getElementById('voiceWaveBar');

    if (isRecognizingVoice) {
        if (speechRecognizer) speechRecognizer.stop();
        stopVoiceWave();
        return;
    }

    try {
        speechRecognizer = new SpeechRecognition();
        speechRecognizer.lang = (currentLanguage === 'en') ? 'en-IN' : 'hi-IN';
        speechRecognizer.continuous = false;
        speechRecognizer.interimResults = false;

        speechRecognizer.onstart = () => {
            isRecognizingVoice = true;
            btn.classList.add('listening');
            if (waveBar) waveBar.classList.add('active');
            startVoiceWave();
        };

        speechRecognizer.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            const field = document.getElementById('msgField');
            field.value = (field.value ? field.value + ' ' : '') + transcript;
            handleComposerInput(field);
            // Strictly type text only — NO auto-submit!
        };

        speechRecognizer.onerror = () => {
            stopVoiceWave();
            showToast('आवाज़ स्पष्ट नहीं मिली, पुनः प्रयास करें।');
        };

        speechRecognizer.onend = () => {
            stopVoiceWave();
        };

        speechRecognizer.start();
    } catch (e) {
        stopVoiceWave();
    }
}

function startVoiceWave() {
    const bars = document.querySelectorAll('.voice-waveform-container .wave-bar');
    if (!bars.length) return;
    clearInterval(waveAnimationTimer);
    waveAnimationTimer = setInterval(() => {
        bars.forEach(b => {
            const h = Math.floor(Math.random() * 16) + 6;
            b.style.height = h + 'px';
        });
    }, 110);
}

function stopVoiceWave() {
    isRecognizingVoice = false;
    clearInterval(waveAnimationTimer);
    const btn = document.getElementById('btnComposerAction');
    const waveBar = document.getElementById('voiceWaveBar');
    if (btn) btn.classList.remove('listening');
    if (waveBar) waveBar.classList.remove('active');
}

/* Clean Speech Synthesis */
function speakText(btn, textToRead) {
    if (!('speechSynthesis' in window)) {
        showToast('स्पीच सिंथेसिस समर्थित नहीं है।');
        return;
    }

    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        btn.classList.remove('playing');
        return;
    }

    const clean = decodeURIComponent(textToRead)
        .replace(/[*#_`]/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .trim();

    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = (currentLanguage === 'en') ? 'en-IN' : 'hi-IN';
    utter.rate = 0.90;
    utter.pitch = 1.0;

    btn.classList.add('playing');
    utter.onend = () => { btn.classList.remove('playing'); };
    utter.onerror = () => { btn.classList.remove('playing'); };

    window.speechSynthesis.speak(utter);
}

/* Copy Only Core Advice Text (Excludes Clips and Questions) */
function handleCopyClick(btn) {
    const bubble = btn.closest('.bot-bubble');
    if (!bubble) return;
    const clone = bubble.cloneNode(true);
    const act = clone.querySelector('.meta-action-bar'); if (act) act.remove();
    const crsT = clone.querySelector('.sources-carousel-title'); if (crsT) crsT.remove();
    const crs = clone.querySelector('.sources-carousel'); if (crs) crs.remove();
    const sq = clone.querySelector('.suggested-questions-box'); if (sq) sq.remove();
    const head = clone.querySelector('.bubble-meta-header'); if (head) head.remove();
    const meta = clone.querySelector('.bubble-meta'); if (meta) meta.remove();

    const raw = clone.innerText.trim();
    navigator.clipboard.writeText(raw).then(() => showToast('सलाह कॉपी हो गई!'));
}

/* Share Only Core Advice Text on WhatsApp */
function handleWhatsAppClick(btn) {
    const bubble = btn.closest('.bot-bubble');
    if (!bubble) return;
    const clone = bubble.cloneNode(true);
    const act = clone.querySelector('.meta-action-bar'); if (act) act.remove();
    const crsT = clone.querySelector('.sources-carousel-title'); if (crsT) crsT.remove();
    const crs = clone.querySelector('.sources-carousel'); if (crs) crs.remove();
    const sq = clone.querySelector('.suggested-questions-box'); if (sq) sq.remove();
    const head = clone.querySelector('.bubble-meta-header'); if (head) head.remove();
    const meta = clone.querySelector('.bubble-meta'); if (meta) meta.remove();

    let raw = clone.innerText.trim();
    raw = raw.replace(/\*\*(.*?)\*\*/g, '*$1*');

    const shareMessage = `🌾 *Agri Mitra (कृषि मित्र) सलाह*\n\n${raw}\n\n━━━━━━━━━━━━━━━━━━━━\n📲 *कृषि मित्र AI से अपनी फसल के सवाल पूछें:* https://agri-assistant-two.vercel.app`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessage)}`, '_blank');
}

function keyMonitor(e) { 
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); 
        submitMessage(); 
    } 
}

function setLanguageChoice(lang) {
    currentLanguage = lang;
    document.querySelectorAll('#settingsView .pill-choice-btn').forEach(b => {
        if (b.id && b.id.startsWith('btnLang')) b.classList.remove('active');
    });
    if (lang === 'hi') {
        document.getElementById('btnLangHi').classList.add('active');
        showToast('भाषा: हिन्दी सेट की गई');
    } else {
        document.getElementById('btnLangEn').classList.add('active');
        showToast('Language: English Set');
    }
}

function handleWebSearchToggle(checkbox) {
    if (!isUserPaidActive || currentUserPlan !== 'pro') {
        checkbox.checked = false;
        showToast('🌐 इंटरनेट सर्च केवल Pro प्लान में उपलब्ध है।');
        openViewWithHistory('paymentView');
        return;
    }
    isWebSearchActive = checkbox.checked;
    showToast(isWebSearchActive ? 'इंटरनेट सर्च सक्रिय' : 'इंटरनेट सर्च बंद');
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
    document.querySelectorAll('#settingsView .pill-choice-btn').forEach(b => {
        if (b.id && b.id.startsWith('btnFont')) b.classList.remove('active');
    });

    if (size === 'small') {
        root.style.setProperty('--chat-font-size', '13.5px');
        root.style.setProperty('--app-font-scale', '0.92');
        document.getElementById('btnFontSmall').classList.add('active');
    } else if (size === 'large') {
        root.style.setProperty('--chat-font-size', '17px');
        root.style.setProperty('--app-font-scale', '1.10');
        document.getElementById('btnFontLarge').classList.add('active');
    } else {
        root.style.setProperty('--chat-font-size', '15px');
        root.style.setProperty('--app-font-scale', '1');
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

function cleanUrlParameters() {
    if (window.location.search || window.location.hash.includes('error=')) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

function triggerAttachmentPicker() {
    if (!isUserPaidActive) {
        showToast('🔒 फोटो जांच केवल Basic/Pro प्लान में उपलब्ध है।');
        openViewWithHistory('paymentView');
        return;
    }
    document.getElementById('fileInput').click();
}

function handleFileSelected(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    if (files.length > 2) {
        showToast('अधिकतम 2 फाइलें ही संलग्न कर सकते हैं।');
        event.target.value = '';
        return;
    }
    selectedAttachments = files;
    const chip = document.getElementById('attachmentChip');
    document.getElementById('attachedFileName').textContent = `📎 ${files.length} फोटो संलग्न`;
    chip.style.display = 'flex';
}

function removeAttachment() {
    selectedAttachments = [];
    document.getElementById('fileInput').value = '';
    document.getElementById('attachmentChip').style.display = 'none';
}

function askQuickChip(questionText) {
    document.getElementById('msgField').value = questionText;
    handleComposerInput(document.getElementById('msgField'));
    submitMessage(questionText);
}

function queueSaveLocalMessage(type, html, time, rawText = '') {
    memoryChatHistory.push({ type, html, time, rawText, timestamp: Date.now() });
    if (memoryChatHistory.length > 20) memoryChatHistory.shift();
    clearTimeout(storageSaveTimer);
    storageSaveTimer = setTimeout(() => {
        try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(memoryChatHistory)); } catch(e) {}
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
                renderUserBubbleDirect(m.html, m.time);
            } else {
                renderBotBubbleDirect(m.html, m.time, isLast, m.rawText);
            }
        });
    } catch(e) {}
}

/* Clean Date Divider (Only "आज" or "कल") */
function updateDateDivider() {
    document.getElementById('todayDateDivider').textContent = 'आज';
}

/* Clean User Bubble (No ticks) */
function renderUserBubbleDirect(textHtml, time) {
    const rowId = 'usr-' + Date.now();
    const uHtml = `
        <div class="msg-row user" id="${rowId}">
            <div class="bubble user-bubble">
                ${textHtml}
                <div class="bubble-meta">
                    <span>${time}</span>
                </div>
            </div>
        </div>`;
    document.getElementById('plantLoader').insertAdjacentHTML('beforebegin', uHtml);
    toBottom();
    return rowId;
}

/* Bot Bubble with Copy, WhatsApp & Speak Action Buttons */
function renderBotBubbleDirect(innerHtml, time, isLatest = false, rawForSpeech = '') {
    if (currentActiveActionBar && currentActiveActionBar.parentNode) {
        currentActiveActionBar.remove();
        currentActiveActionBar = null;
    }

    let actionsHtml = '';
    if (isLatest) {
        actionsHtml = `
            <div class="meta-action-bar" id="activeActionBar">
                <button class="action-btn-pill" onclick="speakText(this, '${encodeURIComponent(rawForSpeech)}')" title="बोलकर सुनें">
                    <svg class="action-svg" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                    <span>सुनें</span>
                </button>
                <button class="action-btn-pill" onclick="handleCopyClick(this)" title="सलाह कॉपी करें">
                    <svg class="action-svg" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    <span>कॉपी</span>
                </button>
                <button class="action-btn-pill whatsapp-btn" onclick="handleWhatsAppClick(this)" title="WhatsApp पर साझा करें">
                    <svg class="action-svg" viewBox="0 0 24 24"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.91-9.91-9.91zm0 18.16c-1.49 0-2.95-.4-4.22-1.16l-.3-.18-3.13.82.84-3.05-.2-.31c-.83-1.32-1.27-2.85-1.27-4.47 0-4.55 3.7-8.25 8.25-8.25 4.55 0 8.25 3.7 8.25 8.25 0 4.55-3.7 8.25-8.22 8.25z"/></svg>
                    <span>शेयर</span>
                </button>
            </div>`;
    }

    const bHtml = `
        <div class="msg-row bot">
            <div class="bubble bot-bubble">
                <div class="bubble-meta-header">
                    <span class="bot-name-label">🌾 Agri Mitra AI</span>
                    <span class="credit-used-pill">1 Credit Used</span>
                </div>
                ${innerHtml}
                <div class="bubble-meta">
                    <span>${time}</span>
                </div>
                ${actionsHtml}
            </div>
        </div>`;
    document.getElementById('plantLoader').insertAdjacentHTML('beforebegin', bHtml);
    if (isLatest) currentActiveActionBar = document.getElementById('activeActionBar');
    toBottom();
}

function closeZeroCreditModal() {
    document.getElementById('zeroCreditModal').style.display = 'none';
}

function closeLowCreditNudge() {
    document.getElementById('lowCreditNudgeModal').style.display = 'none';
}

function proceedPendingQuery() {
    closeLowCreditNudge();
    if (pendingUserQuery) {
        const q = pendingUserQuery;
        pendingUserQuery = null;
        executeSubmit(q.text, q.attachCount);
    }
}

async function submitMessage(customTxt) {
    const field = document.getElementById('msgField');
    const text = (customTxt || field.value).trim();
    if (!text && !selectedAttachments.length) return;
    if (!currentUser) { showToast('कृपया पहले साइन इन करें।'); return; }

    const attachCount = selectedAttachments.length;
    const creditsNeeded = 1 + Math.min(2, attachCount);

    if (!isUserPaidActive && window.cachedTotalCredits < creditsNeeded) {
        document.getElementById('zeroCreditModal').style.display = 'flex';
        return;
    }

    if (isUserPaidActive && window.cachedTotalCredits <= 3) {
        pendingUserQuery = { text, attachCount };
        document.getElementById('lowCreditNudgeText').textContent = 
            `आपके पास केवल ${window.cachedTotalCredits} क्रेडिट शेष हैं। बिना रुकावट परामर्श जारी रखने के लिए क्रेडिट्स जोड़ें।`;
        document.getElementById('lowCreditNudgeModal').style.display = 'flex';
        return;
    }

    executeSubmit(text, attachCount);
}

async function executeSubmit(text, attachCount) {
    const time = nowTime();
    let displayMsg = text;
    if (attachCount > 0) {
        displayMsg = (text ? text + '<br>' : '') + `<small style="color:#065f46; font-weight:600;">📎 ${attachCount} फोटो संलग्न</small>`;
    }

    const safeUserText = displayMsg.replace(/\n/g, '<br>');
    renderUserBubbleDirect(safeUserText, time);
    queueSaveLocalMessage('user', safeUserText, time);

    const field = document.getElementById('msgField');
    field.value = '';
    handleComposerInput(field);
    removeAttachment();
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch(e) {}

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

        if (!res.ok) {
            renderBotBubbleDirect(data.detail || 'तकनीकी समस्या आई। कोई क्रेडिट नहीं कटा।', nowTime(), false);
            return;
        }

        fetchStats();

        let rawText = data.answer.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
        let finalContent = '<div>' + rawText + '</div>';

        // Strictly Horizontal Swipeable Video Clips Carousel
        if (data.sources && data.sources.length > 0) {
            finalContent += `
                <div class="sources-carousel-title">
                    <span>📺 संदर्भ वीडियो क्लिप्स (सटीक भाग)</span>
                    <span class="carousel-hint">स्वाइप करें →</span>
                </div>
                <div class="sources-carousel">`;
            data.sources.forEach(s => {
                finalContent += `
                    <a href="${s.video_url}" target="_blank" class="clip-carousel-card">
                        <div>
                            <div class="clip-c-header">
                                <span>▶️ ${s.duration || '00:00'}</span>
                                <span class="clip-hd-tag">HD</span>
                            </div>
                            <div class="clip-c-title">${s.title}</div>
                            <div class="clip-c-summary">${s.summary || s.title}</div>
                        </div>
                        <div class="clip-c-link">क्लिप देखें →</div>
                    </a>`;
            });
            finalContent += '</div>';
        }

        // Suggested Follow-up Question Chips
        const followups = [
            "इसका छिड़काव किस समय करना सही रहेगा?",
            "प्रति एकड़ कितनी मात्रा में उपयोग करें?",
            "क्या इसे अन्य जैविक घोल के साथ मिला सकते हैं?"
        ];
        finalContent += '<div class="suggested-questions-box">';
        followups.forEach(q => {
            finalContent += `<div class="suggested-q-chip" onclick="askQuickChip('${q}')">👉 ${q}</div>`;
        });
        finalContent += '</div>';

        renderBotBubbleDirect(finalContent, nowTime(), true, data.answer);
        queueSaveLocalMessage('bot', finalContent, nowTime(), data.answer);

    } catch(e) {
        document.getElementById('plantLoader').style.display = 'none';
        renderBotBubbleDirect('सर्वर से संपर्क नहीं हो सका। कोई क्रेडिट नहीं कटा।', nowTime(), false);
    }
    toBottom();
}

/* Load Daily Stories from Supabase */
async function loadDailyStories() {
    const container = document.getElementById('storiesListContainer');
    container.innerHTML = '<p style="color:#64748b; font-size:12.5px;">प्रेरणादायक कृषि कथाएं लोड हो रही हैं...</p>';

    try {
        const { data, error } = await supabaseClient
            .table('daily_stories')
            .select('*')
            .order('published_date', { ascending: false })
            .limit(10);

        if (error || !data || data.length === 0) {
            container.innerHTML = '<p style="color:#64748b; font-size:12.5px; text-align:center; padding:20px;">आज की सफलता की कहानी जल्द प्रकाशित होगी।</p>';
            return;
        }

        let html = '';
        data.forEach(st => {
            html += `
                <div class="story-card-item">
                    <div>
                        <span class="story-badge">सफलता की मिसाल</span>
                        <span class="story-date">${st.published_date || 'आज'}</span>
                    </div>
                    <div class="story-title">${st.title}</div>
                    <div class="story-meta">👨‍🌾 <b>${st.farmer_name}</b> • 📍 ${st.village_district}</div>
                    <div class="story-impact">💰 प्रभाव: ${st.earnings_impact}</div>
                    <div class="story-content">${st.content}</div>
                </div>`;
        });
        container.innerHTML = html;

        const dot = document.getElementById('storyUnreadDot');
        if (dot) dot.classList.remove('show');
    } catch (e) {
        container.innerHTML = '<p style="color:#ef4444; font-size:12.5px;">कथाएं लोड करने में समस्या आई।</p>';
    }
}
