function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

function openPricing() { 
    closeMenu();
    const cardBasic = document.getElementById('cardBasicPlan');
    const badgeBasic = document.getElementById('badgeBasic');
    if (currentUserPlan === 'pro' && isUserPaidActive) {
        cardBasic.classList.add('disabled-plan');
        badgeBasic.textContent = '🔒 प्रो सक्रिय';
    } else {
        cardBasic.classList.remove('disabled-plan');
        badgeBasic.textContent = 'Basic Plan';
    }
    document.getElementById('pricingModal').style.display = 'flex'; 
}

function closePricing() { 
    document.getElementById('pricingModal').style.display = 'none'; 
}

function handleSelectPlan(planId) {
    if (planId === 'basic' && currentUserPlan === 'pro' && isUserPaidActive) {
        alert('आपका Pro प्लान अभी सक्रिय है! बेसिक प्लान केवल प्रो प्लान समाप्त (क्रेडिट 0) होने के बाद ही लिया जा सकता है। आप प्रो प्लान का टॉप-अप कर सकते हैं।');
        return;
    }
    initiatePayment(planId);
}

function openSettingsModal() {
    closeMenu();
    document.getElementById('settingsModal').style.display = 'flex';
}
function closeSettingsModal() { 
    document.getElementById('settingsModal').style.display = 'none'; 
}

function openWelcomeModal() { 
    document.getElementById('welcomeClaimModal').style.display = 'flex'; 
}
function closeWelcomeModal() { 
    document.getElementById('welcomeClaimModal').style.display = 'none'; 
}

function openContactModal(category = 'general') { 
    closeMenu();
    document.getElementById('contactCategory').value = category;
    document.getElementById('contactModal').style.display = 'flex'; 
}
function closeContactModal() { 
    document.getElementById('contactModal').style.display = 'none'; 
}

function openPaymentHistoryModal() {
    closeMenu();
    document.getElementById('historyModal').style.display = 'flex';
    loadPaymentHistory();
}
function closeHistoryModal() { 
    document.getElementById('historyModal').style.display = 'none'; 
}

function openPolicyModal(tab) { 
    closeMenu();
    document.getElementById('policyModal').style.display = 'flex'; 
    switchTab(tab || 'terms'); 
}
function closePolicyModal() { 
    document.getElementById('policyModal').style.display = 'none'; 
}
function closeSuccessModal() { 
    document.getElementById('successModal').style.display = 'none'; 
}

function switchTab(t) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('btn-' + t);
    if (btn) btn.classList.add('active');
    document.getElementById('policyContent').innerHTML = (typeof policyDocs !== 'undefined' && policyDocs[t]) ? policyDocs[t] : '<p>विवरण लोड हो रहा है...</p>';
}

function applyCouponFeedback() {
    const val = (document.getElementById('couponInput').value || '').trim().toUpperCase();
    const msgEl = document.getElementById('couponFeedbackMsg');
    if (!val) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#dc2626';
        msgEl.textContent = 'कृपया कूपन कोड दर्ज करें।';
        return;
    }
    if (val === 'VIP100') {
        msgEl.style.display = 'block';
        msgEl.style.color = '#15803d';
        msgEl.textContent = '✓ VIP100 लागू: 100% निःशुल्क सक्रियण!';
    } else {
        msgEl.style.display = 'block';
        msgEl.style.color = '#008069';
        msgEl.textContent = `कोड "${val}" सेट हुआ। प्लान चुनने पर सत्यापित होगा।`;
    }
}

async function claimWelcomeCredits() {
    if (!currentUser) return;
    showSpinner("स्वागत क्रेडिट्स सक्रिय हो रहे हैं...");
    try {
        const res = await apiRequest('/claim-welcome', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ user_id: currentUser.id })
        });
        const data = await res.json();
        hideSpinner();
        closeWelcomeModal();

        if (res.ok) {
            loadExternalScript('https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js').then(() => {
                confetti({ particleCount: 140, spread: 85, origin: { y: 0.6 } });
            }).catch(() => {});
            triggerPaymentSuccess(data.credits || 10, data.plan_expires_at);
            fetchStats();
        } else {
            alert(data.detail || 'क्रेडिट्स क्लेम करने में त्रुटि आई।');
        }
    } catch(e) {
        hideSpinner();
        alert('नेटवर्क त्रुटि आई।');
    }
}

async function submitUniversalSupportRequest() {
    if (!currentUser) return;
    const phone = document.getElementById('contactPhone').value.trim();
    const concern = document.getElementById('contactConcern').value.trim();
    const category = document.getElementById('contactCategory').value;

    if (!phone) {
        alert('कृपया अपना मोबाइल नंबर दर्ज करें।');
        return;
    }

    let priority = (category === 'payment' || currentUserPlan === 'pro') ? 'high' : (currentUserPlan === 'basic' ? 'medium' : 'normal');

    showSpinner("अनुरोध भेजा जा रहा है...");
    try {
        const res = await apiRequest('/request-approval', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: currentUser.id,
                name: currentUser.user_metadata.full_name || '',
                email: currentUser.email || '',
                phone: phone,
                concern: concern,
                category: category,
                priority: priority,
                user_plan: currentUserPlan
            })
        });
        hideSpinner();

        if (res.ok) {
            showToast('अनुरोध प्राप्त हुआ! प्राथमिकता: ' + priority.toUpperCase());
            closeContactModal();
        } else {
            alert('अनुरोध भेजने में समस्या आई।');
        }
    } catch(e) {
        hideSpinner();
        alert('सर्वर त्रुटि। पुनः प्रयास करें।');
    }
}

async function loadPaymentHistory() {
    if (!currentUser) return;
    const container = document.getElementById('historyListContainer');
    container.innerHTML = '<p style="color:#64748b; font-size:12px;">विगत 3 माह के लेनदेन लोड हो रहे हैं...</p>';

    try {
        const res = await apiRequest('/payment-history?user_id=' + currentUser.id);
        const data = await res.json();
        const txs = data.transactions || [];

        if (txs.length === 0) {
            container.innerHTML = '<p style="color:#64748b; font-size:12px; text-align:center; padding:20px 0;">विगत 3 माह में कोई लेनदेन रिकॉर्ड नहीं मिला।</p>';
            return;
        }

        let html = '';
        txs.forEach(t => {
            const buyDate = formatPreciseIST(t.created_at);
            const expDate = formatPreciseIST(t.expires_at);
            const amt = t.amount_paid == 0 ? 'मुफ़्त (VIP)' : '₹' + t.amount_paid;
            const planTitle = t.plan_name ? t.plan_name.split('(')[0].trim() : `${t.credits_added} क्रेडिट्स`;
            
            html += `
                <div class="history-card-item">
                    <div class="history-top-row">
                        <span class="history-title">${planTitle} (+${t.credits_added} क्रेडिट्स)</span>
                        <span class="history-amount">${amt}</span>
                    </div>
                    <div class="history-details-grid">
                        <span>📅 <b>खरीद:</b> ${buyDate}</span>
                        <span>⏳ <b>वैधता:</b> ${expDate}</span>
                        <span style="font-size:10px; color:#94a3b8;">🆔 ${t.payment_id ? t.payment_id.substring(0, 20) : 'FREE'}</span>
                    </div>
                </div>`;
        });
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = '<p style="color:#ef4444; font-size:12px;">इतिहास लोड करने में त्रुटि आई।</p>';
    }
}

async function initiatePayment(planId) {
    if (!currentUser) return;
    const couponVal = (document.getElementById('couponInput').value || '').trim();

    showSpinner("भुगतान मॉड्यूल तैयार हो रहा है...");
    try {
        await loadExternalScript('https://checkout.razorpay.com/v1/checkout.js');

        const ordRes = await apiRequest('/create-order', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                user_id: currentUser.id, 
                plan_id: planId, 
                coupon_code: couponVal 
            })
        });

        hideSpinner();
        if (!ordRes.ok) {
            let errText = "ऑर्डर तैयार करने में समस्या आई।";
            try {
                const errData = await ordRes.json();
                errText = errData.detail || errText;
            } catch(e) {}
            alert(errText);
            return;
        }

        const ordData = await ordRes.json();
        closePricing();

        if (ordData.is_free) {
            showSpinner("VIP कूपन सक्रिय हो रहा है...");
            const vRes = await apiRequest('/verify-payment', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: currentUser.id,
                    order_id: ordData.order_id,
                    plan_id: planId,
                    coupon_code: couponVal
                })
            });
            hideSpinner();
            const vData = await vRes.json();
            if (vData.status === 'success') {
                triggerPaymentSuccess(vData.credits_added, vData.plan_expires_at);
                fetchStats();
            }
            return;
        }

        const options = {
            key: ordData.key_id,
            amount: ordData.amount,
            currency: "INR",
            name: "Agri Mitra",
            description: planId.toUpperCase() + " Credit Pack",
            order_id: ordData.order_id,
            handler: async function (response) {
                showSpinner("भुगतान सत्यापित हो रहा है...");
                const vRes = await apiRequest('/verify-payment', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        user_id: currentUser.id,
                        order_id: response.razorpay_order_id,
                        payment_id: response.razorpay_payment_id,
                        signature: response.razorpay_signature,
                        plan_id: planId,
                        coupon_code: couponVal
                    })
                });
                hideSpinner();
                const vData = await vRes.json();
                if (vData.status === 'success') {
                    triggerPaymentSuccess(vData.credits_added, vData.plan_expires_at);
                    fetchStats();
                }
            },
            prefill: {
                name: currentUser.user_metadata.full_name || '',
                email: currentUser.email || ''
            },
            theme: { color: "#008069" }
        };
        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (resp) {
            alert("भुगतान विफल रहा: " + (resp.error.description || "त्रुटि"));
        });
        rzp.open();
    } catch(e) {
        hideSpinner();
        alert('भुगतान आरंभ करने में त्रुटि आई। कृपया पुनः प्रयास करें।');
    }
}

function triggerPaymentSuccess(creditsAdded, expiryIso) {
    loadExternalScript('https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js').then(() => {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    }).catch(() => {});

    document.getElementById('successModal').style.display = 'flex';
    document.getElementById('successModalTitle').textContent = '🎉 बधाई किसान भाई!';
    document.getElementById('creditRollCount').textContent = `+${creditsAdded} क्रेडिट्स`;
    document.getElementById('successMsg').textContent = `आपके खाते में ${creditsAdded} क्रेडिट्स सफलतापूर्वक जोड़ दिए गए हैं।`;
    if (expiryIso) {
        document.getElementById('trialDatesLabel').textContent = `वैधता: ${formatPreciseIST(expiryIso)} तक`;
    }
}
