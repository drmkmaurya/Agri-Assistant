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

/* Format Date without "IST" (e.g. 01 Dec 2026, 01:29 AM) */
function formatCleanDate(isoStr) {
    if (!isoStr) return 'Active';
    const d = new Date(isoStr);
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
    return `${day} ${month} ${year}, ${strTime}`;
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

        window.cachedTotalCredits = total;

        const ringBadge = document.getElementById('ringBadge');
        if (ringBadge) ringBadge.textContent = total;

        const planNameEl = document.getElementById('userPlanName');
        if (planNameEl) {
            const displayPlan = (plan && plan !== 'free') ? (plan.charAt(0).toUpperCase() + plan.slice(1)) : (isUserPaidActive ? 'Pro' : 'Free');
            planNameEl.textContent = 'Plan : ' + displayPlan;
        }
        
        const quotaSummaryEl = document.getElementById('quotaSummary');
        if (quotaSummaryEl) {
            quotaSummaryEl.textContent = `Available Credit : ${total} / ${maxPack}`;
        }
        
        const planExpiryEl = document.getElementById('planExpiryText');
        if (planExpiryEl) {
            if (data.plan_expires_at) {
                planExpiryEl.textContent = 'Valid till : ' + formatCleanDate(data.plan_expires_at);
            } else {
                planExpiryEl.textContent = 'Valid till : Daily Midnight';
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

        const compWebBtn = document.getElementById('btnComposerWebSearch');
        if (compWebBtn) {
            if (plan === 'pro' && isUserPaidActive) {
                compWebBtn.classList.add('show');
            } else {
                compWebBtn.classList.remove('show');
            }
        }
    } catch(e) {
        console.error("fetchStats error:", e);
    }
}

async function initAuthSession() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.user) {
            currentUser = session.user;
            const authScreen = document.getElementById('authScreen');
            if (authScreen) authScreen.style.display = 'none';

            const avatar = document.getElementById('userAvatar');
            if (avatar) avatar.src = currentUser.user_metadata.avatar_url || avatar.src;

            const userName = document.getElementById('userName');
            if (userName) userName.textContent = currentUser.user_metadata.full_name || 'किसान साथी';

            await fetchStats();
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

// Direct Session bootstrap on file load
initAuthSession();
