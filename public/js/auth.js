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
    let res = await fetch('/api' + endpoint, options);
    if (res.status === 404) {
        res = await fetch(endpoint, options);
    }
    return res;
}

function formatPreciseIST(isoStr) {
    if (!isoStr) return 'उपलब्ध नहीं';
    const d = new Date(isoStr);
    return d.toLocaleDateString('hi-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) + ' IST';
}

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
    if (!currentUser) return;
    try {
        const queryParams = new URLSearchParams({
            user_id: currentUser.id,
            email: currentUser.email || '',
            name: currentUser.user_metadata.full_name || '',
            avatar: currentUser.user_metadata.avatar_url || ''
        });
        const res = await apiRequest('/user-stats?' + queryParams.toString());
        const data = await res.json();

        const total = data.total_credits || 0;
        const maxPack = data.max_pack_credits || (total > 0 ? total : 1);
        const plan = data.plan_type || 'free';
        currentUserPlan = plan;
        isUserPaidActive = data.is_paid_active || false;

        const ringBadge = document.getElementById('ringBadge');
        if (ringBadge) ringBadge.textContent = total;

        const planNameEl = document.getElementById('userPlanName');
        if (planNameEl) planNameEl.textContent = 'प्लान: ' + (isUserPaidActive ? plan.toUpperCase() : 'Free');
        
        const quotaSummaryEl = document.getElementById('quotaSummary');
        if (quotaSummaryEl) {
            if (isUserPaidActive) {
                quotaSummaryEl.textContent = `उपलब्ध क्रेडिट: ${total} / ${maxPack}`;
            } else {
                quotaSummaryEl.textContent = `दैनिक फ्री क्रेडिट: ${total} (रात तक मान्य)`;
            }
        }
        
        const planExpiryEl = document.getElementById('planExpiryText');
        if (planExpiryEl) {
            if (data.plan_expires_at && isUserPaidActive) {
                planExpiryEl.textContent = 'वैधता: ' + formatPreciseIST(data.plan_expires_at);
            } else {
                planExpiryEl.textContent = 'वैधता: सक्रिय (दैनिक रीसेट)';
            }
        }

        const circle = document.getElementById('creditRing');
        if (circle) {
            const ratio = maxPack > 0 ? Math.max(0, Math.min(1, total / maxPack)) : 0;
            circle.style.strokeDashoffset = 119.38 * (1 - ratio);

            if (plan === 'pro' && isUserPaidActive) {
                circle.style.stroke = "url(#rainbowGrad)";
                circle.setAttribute('stroke-width', '3.5');
            } else if (plan === 'basic' && isUserPaidActive) {
                circle.style.stroke = '#25d366';
                circle.setAttribute('stroke-width', '3');
            } else {
                circle.style.stroke = '#94a3b8';
                circle.setAttribute('stroke-width', '2');
            }
        }

        const webBtn = document.getElementById('btnWebToggle');
        if (webBtn) {
            if (plan === 'pro' && isUserPaidActive) {
                webBtn.style.opacity = '1';
                webBtn.style.cursor = 'pointer';
            } else {
                webBtn.style.opacity = '0.4';
                if (typeof isWebSearchActive !== 'undefined') isWebSearchActive = false;
                webBtn.classList.remove('active');
            }
        }

    } catch(e) {}
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
        currentUser = session.user;
        const authScreen = document.getElementById('authScreen');
        if (authScreen) authScreen.style.display = 'none';

        const avatar = document.getElementById('userAvatar');
        if (avatar) avatar.src = currentUser.user_metadata.avatar_url || avatar.src;

        const userName = document.getElementById('userName');
        if (userName) userName.textContent = currentUser.user_metadata.full_name || 'किसान साथी';

        fetchStats();
    } else {
        currentUser = null;
        const authScreen = document.getElementById('authScreen');
        if (authScreen) authScreen.style.display = 'flex';
    }
});
