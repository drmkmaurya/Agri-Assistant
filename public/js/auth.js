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
    // 1. Session check
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
        let maxPack = 1;
        let plan = 'free';
        let planExpiresAt = null;
        let dataLoaded = false;

        // 2. Direct Supabase Query with user access
        try {
            const { data: dbUser, error: dbErr } = await supabaseClient
                .table('user_profiles')
                .select('*')
                .eq('id', currentUser.id)
                .maybeSingle();

            if (!dbErr && dbUser) {
                total = Number(dbUser.total_credits) || 0;
                maxPack = Number(dbUser.max_pack_credits) || (total > 0 ? total : 1);
                plan = (dbUser.plan_type || 'free').toLowerCase();
                planExpiresAt = dbUser.plan_expires_at;
                dataLoaded = true;
            }
        } catch (e) {
            console.warn("Direct Supabase read error:", e);
        }

        // 3. Fallback to API if DB query did not load
        if (!dataLoaded) {
            try {
                const queryParams = new URLSearchParams({
                    user_id: currentUser.id,
                    email: currentUser.email || '',
                    name: currentUser.user_metadata?.full_name || '',
                    avatar: currentUser.user_metadata?.avatar_url || ''
                });
                const res = await apiRequest('/user-stats?' + queryParams.toString());
                if (res.ok) {
                    const data = await res.json();
                    total = Number(data.total_credits) || 0;
                    maxPack = Number(data.max_pack_credits) || (total > 0 ? total : 1);
                    plan = (data.plan_type || 'free').toLowerCase();
                    planExpiresAt = data.plan_expires_at;
                    dataLoaded = true;
                }
            } catch (e) {
                console.warn("API fallback error:", e);
            }
        }

        currentUserPlan = plan;
        isUserPaidActive = (plan === 'basic' || plan === 'pro');
        window.cachedTotalCredits = total;

        // Update Ring Badge (Homescreen number)
        const ringBadge = document.getElementById('ringBadge');
        if (ringBadge) {
            ringBadge.textContent = String(total);
        }

        // Update Menu Plan Name
        const planNameEl = document.getElementById('userPlanName');
        if (planNameEl) {
            const planDisplay = isUserPaidActive ? plan.toUpperCase() : 'FREE';
            planNameEl.textContent = 'Plan : ' + planDisplay;
        }
        
        // Update Menu Available Credit
        const quotaSummaryEl = document.getElementById('quotaSummary');
        if (quotaSummaryEl) {
            quotaSummaryEl.textContent = isUserPaidActive 
                ? `Available Credit : ${total} / ${maxPack}`
                : `Available Credit : ${total} (Daily Free)`;
        }
        
        // Update Menu Validity
        const planExpiryEl = document.getElementById('planExpiryText');
        if (planExpiryEl) {
            if (planExpiresAt && isUserPaidActive) {
                planExpiryEl.textContent = 'Valid till : ' + formatCleanDate(planExpiresAt);
            } else {
                planExpiryEl.textContent = 'Valid till : Daily Midnight';
            }
        }

        // Circular Progress Ring Fill & Color Animation
        const circle = document.getElementById('creditRing');
        if (circle) {
            const ratio = maxPack > 0 ? Math.max(0, Math.min(1, total / maxPack)) : 0;
            circle.style.strokeDashoffset = String(119.38 * (1 - ratio));

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

        // Pro Composer Web Search Button
        const compWebBtn = document.getElementById('btnComposerWebSearch');
        if (compWebBtn) {
            if (plan === 'pro' && isUserPaidActive) {
                compWebBtn.classList.add('show');
            } else {
                compWebBtn.classList.remove('show');
            }
        }

    } catch (err) {
        console.error("fetchStats critical error:", err);
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
