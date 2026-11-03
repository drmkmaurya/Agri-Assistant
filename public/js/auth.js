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
        let plan = 'free';
        let planExpiresAt = null;
        let dataLoaded = false;

        const userEmail = currentUser.email || '';
        const userId = currentUser.id || '';

        // 2. Direct Supabase Query: Primary match by Email (Reliable & Case-Insensitive)
        try {
            let dbUser = null;

            if (userEmail) {
                const { data, error } = await supabaseClient
                    .table('user_profiles')
                    .select('total_credits, plan_type, plan_expires_at')
                    .eq('email', userEmail)
                    .limit(1);

                if (!error && data && data.length > 0) {
                    dbUser = data[0];
                }
            }

            // Fallback match by UUID if email check didn't return
            if (!dbUser && userId) {
                const { data, error } = await supabaseClient
                    .table('user_profiles')
                    .select('total_credits, plan_type, plan_expires_at')
                    .eq('id', userId)
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
            console.warn("Direct DB fetch error:", e);
        }

        // 3. Fallback to Server API if Direct Query did not return
        if (!dataLoaded) {
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
                    dataLoaded = true;
                }
            } catch (e) {
                console.warn("API fallback error:", e);
            }
        }

        currentUserPlan = plan;
        isUserPaidActive = (plan === 'basic' || plan === 'pro');
        window.cachedTotalCredits = total;

        // Homescreen Badge (Live Balance Render)
        const ringBadge = document.getElementById('ringBadge');
        if (ringBadge) {
            ringBadge.textContent = String(total);
        }

        // Menu Plan Name
        const planNameEl = document.getElementById('userPlanName');
        if (planNameEl) {
            const planDisplay = isUserPaidActive ? plan.toUpperCase() : 'FREE';
            planNameEl.textContent = 'Plan : ' + planDisplay;
        }
        
        // Menu Available Credit
        const quotaSummaryEl = document.getElementById('quotaSummary');
        if (quotaSummaryEl) {
            quotaSummaryEl.textContent = `Available Credits : ${total}`;
        }
        
        // Menu Validity
        const planExpiryEl = document.getElementById('planExpiryText');
        if (planExpiryEl) {
            if (planExpiresAt) {
                planExpiryEl.textContent = 'Valid till : ' + formatCleanDate(planExpiresAt);
            } else {
                planExpiryEl.textContent = 'Valid till : 30 Days';
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
        console.error("fetchStats error:", err);
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
            .table('user_chat_history')
            .select('created_at, credits_deducted')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error || !data || data.length === 0) {
            container.innerHTML = '<p style="color:#64748b; font-size:12px; text-align:center; padding:20px 0;">विगत 7 दिनों में कोई उपयोग रिकॉर्ड नहीं मिला।</p>';
            return;
        }

        // Group by Date
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

async function initAuthSession() {
    try {
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
        }
    } catch(e) {}
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
    }
});

// Direct Session bootstrap on file load
initAuthSession();
