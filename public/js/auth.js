const SUPABASE_URL = "https://wvptpethggrslyeqsjdn.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2cHRwZXRoZ2dyc2x5ZXFzamRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzODAyNzUsImV4cCI6MjEwODk1NjI3NX0.XdPonPJI0XeRzwcP9hkfYwo1zowcg-SLPNLGt6_s1Qg"; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null;
let currentUserPlan = 'free';
let isUserPaidActive = false;

function showToast(msg, duration = 2500) {
    const t = document.getElementById('toastNotice');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); }, duration);
}

function showSpinner(text = "प्रतीक्षा करें...") {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideSpinner() {
    document.getElementById('loadingOverlay').style.display = 'none';
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

        const sc = data.super_control;
        if (sc && sc.banner_enabled && sc.banner_text) {
            document.getElementById('promoBanner').style.display = 'block';
            document.getElementById('promoBannerText').textContent = sc.banner_text;
        } else {
            document.getElementById('promoBanner').style.display = 'none';
        }

        const total = data.total_credits || 0;
        const maxPack = data.max_pack_credits || (total > 0 ? total : 1);
        const plan = data.plan_type || 'free';
        currentUserPlan = plan;
        isUserPaidActive = data.is_paid_active || false;

        if (data.is_welcome_eligible) {
            document.getElementById('welcomeBanner').style.display = 'flex';
            if (!sessionStorage.getItem('welcome_onboarding_shown')) {
                openWelcomeModal();
                sessionStorage.setItem('welcome_onboarding_shown', '1');
            }
        } else {
            document.getElementById('welcomeBanner').style.display = 'none';
            closeWelcomeModal();
        }

        document.getElementById('ringBadge').textContent = total;
        document.getElementById('userPlanName').textContent = 'प्लान: ' + (isUserPaidActive ? plan.toUpperCase() : 'Free');
        
        if (isUserPaidActive) {
            document.getElementById('quotaSummary').textContent = `उपलब्ध क्रेडिट: ${total} / ${maxPack}`;
        } else {
            document.getElementById('quotaSummary').textContent = `दैनिक फ्री क्रेडिट: ${total} (रात तक मान्य)`;
        }
        
        if (data.plan_expires_at && isUserPaidActive) {
            document.getElementById('planExpiryText').textContent = 'वैधता: ' + formatPreciseIST(data.plan_expires_at);
        } else {
            document.getElementById('planExpiryText').textContent = 'वैधता: सक्रिय (दैनिक रीसेट)';
        }

        document.getElementById('lowCreditBanner').style.display = (total <= 1 && isUserPaidActive) ? 'flex' : 'none';

        const circle = document.getElementById('creditRing');
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

        const webBtn = document.getElementById('btnWebToggle');
        if (plan === 'pro' && isUserPaidActive) {
            webBtn.classList.remove('locked');
        } else {
            webBtn.classList.add('locked');
            if (typeof isWebSearchActive !== 'undefined') isWebSearchActive = false;
            webBtn.classList.remove('active');
        }

    } catch(e) {}
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
        currentUser = session.user;
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('userAvatar').src = currentUser.user_metadata.avatar_url || document.getElementById('userAvatar').src;
        document.getElementById('userName').textContent = currentUser.user_metadata.full_name || 'किसान साथी';
        
        document.getElementById('contactName').value = currentUser.user_metadata.full_name || '';
        document.getElementById('contactEmail').value = currentUser.email || '';

        fetchStats();
    } else {
        currentUser = null;
        document.getElementById('authScreen').style.display = 'flex';
    }
});
