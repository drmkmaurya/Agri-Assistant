const SUPABASE_URL = "https://wvptpethggrslyeqsjdn.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHRwZXRoZ2dyc2x5ZXFzamRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzODAyNzUsImV4cCI6MjEwODk1NjI3NX0.XdPonPJI0XeRzwcP9hkfYwo1zowcg-SLPNLGt6_s1Qg"; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null;
let currentUserPlan = 'free';
let isUserPaidActive = false;

function showToast(msg, duration = 2500) {
    const t = document.getElementById('toastNotice');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); }, duration);
}

function showSpinner(text = "प्रतीक्षा करें...") {
    const el = document.getElementById('loadingText');
    const ov = document.getElementById('loadingOverlay');
    if (el) el.textContent = text;
    if (ov) ov.style.display = 'flex';
}

function hideSpinner() {
    const ov = document.getElementById('loadingOverlay');
    if (ov) ov.style.display = 'none';
}

async function apiRequest(endpoint, options = {}) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = '/api' + cleanEndpoint;
    const res = await fetch(url, options);
    return res;
}

/* Format Date with Date First and Time Below (e.g. 05 Nov 2026<br><small>07:30 PM</small>) */
function formatCleanDateTime(isoStr) {
    if (!isoStr) return '30 दिन';
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '30 दिन';
        
        const day = String(d.getDate()).padStart(2, '0');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[d.getMonth()];
        const year = d.getFullYear();
        
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const strTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
        
        return `${day} ${month} ${year}<br><span style="font-size:10px; color:#64748b; font-weight:500;">${strTime}</span>`;
    } catch(e) {
        return '30 दिन';
    }
}

function formatCleanDate(isoStr) {
    if (!isoStr) return '30 दिन';
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '30 दिन';
        const day = String(d.getDate()).padStart(2, '0');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[d.getMonth()];
        const year = d.getFullYear();
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${day} ${month} ${year}, ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    } catch(e) {
        return '30 दिन';
    }
}

/* Network Status Indicator Engine */
function updateNetworkStatus(status) {
    const dot = document.getElementById('liveStatusDot');
    const txt = document.getElementById('liveStatusText');
    if (!dot || !txt) return;

    dot.classList.remove('online', 'connecting', 'offline');

    if (status === 'online') {
        dot.classList.add('online');
        txt.textContent = 'कनेक्टेड';
    } else if (status === 'offline') {
        dot.classList.add('offline');
        txt.textContent = 'ऑफलाइन';
    } else {
        dot.classList.add('connecting');
        txt.textContent = 'कनेक्ट हो रहे हैं...';
    }
}

window.addEventListener('online', () => updateNetworkStatus('online'));
window.addEventListener('offline', () => updateNetworkStatus('offline'));

async function loginWithGoogle() {
    showSpinner("Google से कनेक्ट हो रहे हैं...");
    try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
                queryParams: { prompt: 'select_account' }
            }
        });
        if (error) {
            hideSpinner();
            alert("लॉगिन त्रुटि: " + error.message);
        }
    } catch(err) {
        hideSpinner();
        alert("नेटवर्क त्रुटि: " + err.message);
    }
}

async function signOutUser() {
    showSpinner("लॉगआउट हो रहा है...");
    await supabaseClient.auth.signOut();
    showToast("आप सफलतापूर्वक लॉगआउट हो गए हैं।");
    setTimeout(() => {
        hideSpinner();
        location.reload();
    }, 600);
}

async function fetchStats() {
    if (!currentUser) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.user) {
            currentUser = session.user;
        } else {
            return;
        }
    }

    try {
        let total = 0;
        let plan = 'free';
        let planExpiresAt = null;
        let dataLoaded = false;
        let superControl = null;

        const userEmail = currentUser.email || '';
        const userId = currentUser.id || '';

        // 1. Direct Supabase Query
        try {
            let dbUser = null;
            if (userId) {
                const { data, error } = await supabaseClient
                    .from('user_profiles')
                    .select('total_credits, plan_type, plan_expires_at')
                    .eq('id', userId)
                    .limit(1);

                if (!error && data && data.length > 0) {
                    dbUser = data[0];
                }
            }

            if (!dbUser && userEmail) {
                const { data, error } = await supabaseClient
                    .from('user_profiles')
                    .select('total_credits, plan_type, plan_expires_at')
                    .eq('email', userEmail)
                    .limit(1);

                if (!error && data && data.length > 0) {
                    dbUser = data[0];
                }
            }

            if (dbUser) {
                total = Number(dbUser.total_credits) || 0;
                plan = (dbUser.plan_type || 'free').toLowerCase();
                planExpiresAt = dbUser.plan_expires_at;
                dataLoaded = true;
            }
        } catch (e) {
            console.warn("Direct DB fetch warning:", e);
        }

        // 2. Fallback to /user-stats
        if (!dataLoaded || !superControl) {
            try {
                const queryParams = new URLSearchParams({
                    user_id: userId,
                    email: userEmail,
                    name: currentUser.user_metadata?.full_name || '',
                    avatar: currentUser.user_metadata?.avatar_url || ''
                });
                const res = await apiRequest('/user-stats?' + queryParams.toString());
                if (res.ok) {
                    const data = await res.json();
                    total = Number(data.total_credits) || 0;
                    plan = (data.plan_type || 'free').toLowerCase();
                    planExpiresAt = data.plan_expires_at;
                    superControl = data.super_control || null;
                    dataLoaded = true;
                }
            } catch (e) {
                console.warn("API fallback warning:", e);
            }
        }

        currentUserPlan = plan;
        isUserPaidActive = (plan === 'basic' || plan === 'pro');
        window.cachedTotalCredits = total;

        // Header Live Credit Badge
        const ringBadge = document.getElementById('ringBadge');
        if (ringBadge) ringBadge.textContent = String(total);

        // Header Dynamic PRO/BASIC Badge
        const headerBadge = document.getElementById('headerPlanBadge');
        if (headerBadge) {
            headerBadge.className = 'plan-header-badge';
            if (plan === 'pro') {
                headerBadge.classList.add('pro');
                headerBadge.textContent = 'PRO';
            } else if (plan === 'basic') {
                headerBadge.classList.add('basic');
                headerBadge.textContent = 'BASIC';
            } else {
                headerBadge.textContent = '';
            }
        }

        // Dropdown Menu Email & 2-Column Card Sync
        const userEmailEl = document.getElementById('userEmailText');
        if (userEmailEl) userEmailEl.textContent = userEmail || 'kisan@agrimitra.in';

        const menuCreditsEl = document.getElementById('menuAvailableCredits');
        if (menuCreditsEl) menuCreditsEl.textContent = String(total);

        const menuPlanPill = document.getElementById('menuPlanPill');
        if (menuPlanPill) menuPlanPill.textContent = plan.toUpperCase();

        const menuValidityEl = document.getElementById('menuDaysRemaining');
        if (menuValidityEl) {
            menuValidityEl.innerHTML = formatCleanDateTime(planExpiresAt);
        }

        // Pro Web Search Toggle
        const compWebBtn = document.getElementById('btnComposerWebSearch');
        if (compWebBtn) {
            if (plan === 'pro' && isUserPaidActive) {
                compWebBtn.classList.add('show');
            } else {
                compWebBtn.classList.remove('show');
            }
        }

        // Chat Maintenance Safeguard
        if (superControl && (superControl.maintenance_mode || superControl.chat_maintenance)) {
            const msgField = document.getElementById('msgField');
            const btnAction = document.getElementById('btnComposerAction');
            const btnCam = document.getElementById('btnCameraAttach');
            if (msgField) {
                msgField.disabled = true;
                msgField.placeholder = "कृषि चैट सेवा अभी रखरखाव (Maintenance) में है...";
            }
            if (btnAction) btnAction.disabled = true;
            if (btnCam) btnCam.disabled = true;
        }

        // Mark network status as fully connected
        if (window.navigator.onLine) {
            updateNetworkStatus('online');
        } else {
            updateNetworkStatus('offline');
        }

    } catch (err) {
        console.error("fetchStats error:", err);
        updateNetworkStatus('offline');
    }
}

/* 7-Day Usage History Modal Logic */
function openUsageHistoryModal() {
    const modal = document.getElementById('usageModal');
    if (modal) {
        modal.style.display = 'flex';
        load7DayUsageHistory();
    }
}

function closeUsageModal() {
    const modal = document.getElementById('usageModal');
    if (modal) modal.style.display = 'none';
}

async function load7DayUsageHistory() {
    if (!currentUser) return;
    const container = document.getElementById('usageListContainer');
    if (!container) return;
    container.innerHTML = '<p style="color:#64748b; font-size:12px;">उपयोग डेटा लोड हो रहा है...</p>';

    try {
        const { data, error } = await supabaseClient
            .from('user_chat_history')
            .select('created_at, credits_deducted')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error || !data || data.length === 0) {
            container.innerHTML = '<p style="color:#64748b; font-size:12px; text-align:center; padding:20px 0;">विगत 7 दिनों में कोई उपयोग रिकॉर्ड नहीं मिला।</p>';
            return;
        }

        const grouped = {};
        data.forEach(row => {
            const d = new Date(row.created_at).toLocaleDateString('hi-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            if (!grouped[d]) {
                grouped[d] = { queries: 0, credits: 0 };
            }
            grouped[d].queries += 1;
            grouped[d].credits += (row.credits_deducted || 1);
        });

        let html = '';
        for (const [dateStr, val] of Object.entries(grouped)) {
            html += `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:13px; font-weight:700; color:#1e293b;">📅 ${dateStr}</div>
                        <div style="font-size:11.5px; color:#64748b; margin-top:2px;">पूछे गए प्रश्न: ${val.queries}</div>
                    </div>
                    <div style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; font-size:11.5px; font-weight:700; padding:4px 8px; border-radius:6px;">
                        -${val.credits} Credits
                    </div>
                </div>`;
        }
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = '<p style="color:#ef4444; font-size:12px;">उपयोग इतिहास लोड करने में समस्या आई।</p>';
    }
}

// Session Bootstrap with Real-Time Connected Status
async function bootstrapSession() {
    updateNetworkStatus('connecting');

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
        currentUser = session.user;
        const authScreen = document.getElementById('authScreen');
        if (authScreen) authScreen.style.display = 'none';

        const avatar = document.getElementById('userAvatar');
        if (avatar) avatar.src = currentUser.user_metadata?.avatar_url || avatar.src;

        const userName = document.getElementById('userName');
        if (userName) userName.textContent = currentUser.user_metadata?.full_name || 'किसान साथी';

        await fetchStats();
        return;
    }

    setTimeout(async () => {
        const { data: { session: retrySession } } = await supabaseClient.auth.getSession();
        if (retrySession && retrySession.user) {
            currentUser = retrySession.user;
            const authScreen = document.getElementById('authScreen');
            if (authScreen) authScreen.style.display = 'none';

            const avatar = document.getElementById('userAvatar');
            if (avatar) avatar.src = currentUser.user_metadata?.avatar_url || avatar.src;

            const userName = document.getElementById('userName');
            if (userName) userName.textContent = currentUser.user_metadata?.full_name || 'किसान साथी';

            await fetchStats();
        } else {
            updateNetworkStatus(window.navigator.onLine ? 'online' : 'offline');
        }
    }, 350);
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
        currentUser = session.user;
        const authScreen = document.getElementById('authScreen');
        if (authScreen) authScreen.style.display = 'none';

        const avatar = document.getElementById('userAvatar');
        if (avatar) avatar.src = currentUser.user_metadata?.avatar_url || avatar.src;

        const userName = document.getElementById('userName');
        if (userName) userName.textContent = currentUser.user_metadata?.full_name || 'किसान साथी';

        fetchStats();
    } else {
        currentUser = null;
        const authScreen = document.getElementById('authScreen');
        if (authScreen) authScreen.style.display = 'flex';
        updateNetworkStatus(window.navigator.onLine ? 'online' : 'offline');
    }
});

window.addEventListener('DOMContentLoaded', () => {
    bootstrapSession();
});

bootstrapSession();
