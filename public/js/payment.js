window.currentSelectedPlan = null;
window.currentAppliedDiscountPct = 0;
window.currentValidatedCouponCode = '';

window.loadExternalScript = function(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
};

/* Step 1: Select Plan & Trigger Realtime Checks */
window.selectPricingPlan = function(planId) {
    window.currentSelectedPlan = planId;

    // UI card highlight
    const basicBox = document.getElementById('cardBasicPlan');
    const proBox = document.getElementById('cardProPlan');
    if (basicBox) basicBox.style.borderColor = (planId === 'basic') ? '#008069' : '#bbf7d0';
    if (proBox) proBox.style.borderColor = (planId === 'pro') ? '#008069' : '#fef08a';

    // Enable coupon input & apply button
    const couponBox = document.getElementById('couponSectionBox');
    const couponInput = document.getElementById('couponInput');
    const btnCoupon = document.getElementById('btnApplyCoupon');
    if (couponBox) {
        couponBox.style.opacity = '1';
        couponBox.style.pointerEvents = 'auto';
    }
    if (couponInput) couponInput.disabled = false;
    if (btnCoupon) btnCoupon.disabled = false;

    // Recalculate summary card
    window.updateCheckoutSummary();
};

window.handleCouponInputChange = function() {
    window.currentAppliedDiscountPct = 0;
    window.currentValidatedCouponCode = '';
    const msgEl = document.getElementById('couponFeedbackMsg');
    if (msgEl) msgEl.style.display = 'none';
    window.updateCheckoutSummary();
};

/* Amazon-Style Price Calculation Card Update */
window.updateCheckoutSummary = function() {
    if (!window.currentSelectedPlan) return;

    const basePrice = (window.currentSelectedPlan === 'pro') ? 99 : 49;
    const discountAmount = Math.round(basePrice * (window.currentAppliedDiscountPct / 100));
    const payableAmount = Math.max(0, basePrice - discountAmount);

    const summaryCard = document.getElementById('checkoutSummaryCard');
    const basePriceEl = document.getElementById('summaryBasePrice');
    const discountValEl = document.getElementById('summaryDiscountVal');
    const discountRow = document.getElementById('summaryDiscountRow');
    const payableEl = document.getElementById('summaryPayableAmount');
    const btnCheckout = document.getElementById('btnProceedCheckout');

    if (summaryCard) summaryCard.style.display = 'block';
    if (basePriceEl) basePriceEl.textContent = `₹${basePrice}`;

    if (discountRow && discountValEl) {
        if (window.currentAppliedDiscountPct > 0) {
            discountRow.style.display = 'flex';
            discountValEl.textContent = `-₹${discountAmount} (${window.currentAppliedDiscountPct}% छूट)`;
        } else {
            discountRow.style.display = 'none';
        }
    }

    if (payableEl) payableEl.textContent = `₹${payableAmount}`;

    if (btnCheckout) {
        btnCheckout.style.opacity = '1';
        btnCheckout.style.pointerEvents = 'auto';
        if (payableAmount === 0) {
            btnCheckout.textContent = `⚡ सक्रिय करें (मुफ़्त - ₹0)`;
            btnCheckout.style.background = '#15803d';
        } else {
            btnCheckout.textContent = `🔒 सुरक्षित भुगतान करें ₹${payableAmount}`;
            btnCheckout.style.background = '#008069';
        }
    }
};

/* Backend-Verified Coupon Validation */
window.applyCouponFeedback = async function() {
    if (!window.currentSelectedPlan) {
        alert('कृपया पहले कोई प्लान चुनें।');
        return;
    }

    const val = (document.getElementById('couponInput').value || '').trim().toUpperCase();
    const msgEl = document.getElementById('couponFeedbackMsg');
    if (!msgEl) return;

    if (!val) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#dc2626';
        msgEl.textContent = 'कृपया कूपन कोड दर्ज करें।';
        return;
    }

    if (!currentUser) {
        msgEl.style.display = 'block';
        msgEl.style.color = '#dc2626';
        msgEl.textContent = 'कृपया पहले साइन इन करें।';
        return;
    }

    // 1. Client-Side Check: Per-User 1-Time Usage Verification
    try {
        const { data: usedTxs } = await supabaseClient
            .from('credit_transactions')
            .select('id')
            .eq('user_id', currentUser.id)
            .eq('coupon_code', val)
            .limit(1);

        if (usedTxs && usedTxs.length > 0) {
            msgEl.style.display = 'block';
            msgEl.style.color = '#dc2626';
            msgEl.textContent = '❌ यह कूपन कोड आप पहले ही उपयोग कर चुके हैं (Only 1 time use)।';
            window.currentAppliedDiscountPct = 0;
            window.currentValidatedCouponCode = '';
            window.updateCheckoutSummary();
            return;
        }
    } catch(e) {}

    // 2. VIP100 Instant Shortcut
    if (val === 'VIP100') {
        window.currentAppliedDiscountPct = 100;
        window.currentValidatedCouponCode = 'VIP100';
        msgEl.style.display = 'block';
        msgEl.style.color = '#15803d';
        msgEl.textContent = '✓ VIP100 लागू: 100% निःशुल्क सक्रियण!';
        window.updateCheckoutSummary();
        return;
    }

    // 3. Backend Verification via /api/validate-coupon
    showSpinner("कूपन जांचा जा रहा है...");
    try {
        const res = await fetch('/api/validate-coupon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coupon_code: val,
                plan_id: window.currentSelectedPlan,
                user_id: currentUser ? currentUser.id : ''
            })
        });
        hideSpinner();

        const data = await res.json();
        if (res.ok && data.valid) {
            window.currentAppliedDiscountPct = data.discount_percent || 0;
            window.currentValidatedCouponCode = data.code || val;
            msgEl.style.display = 'block';
            msgEl.style.color = '#15803d';
            msgEl.textContent = `✓ कूपन लागू: ${window.currentAppliedDiscountPct}% छूट प्राप्त हुई!`;
        } else {
            msgEl.style.display = 'block';
            msgEl.style.color = '#dc2626';
            msgEl.textContent = data.detail || 'अमान्य या इस प्लान पर अनुपलब्ध कूपन कोड।';
            window.currentAppliedDiscountPct = 0;
            window.currentValidatedCouponCode = '';
        }
    } catch(e) {
        hideSpinner();
        msgEl.style.display = 'block';
        msgEl.style.color = '#dc2626';
        msgEl.textContent = 'सत्यापन में समस्या आई। पुनः प्रयास करें।';
        window.currentAppliedDiscountPct = 0;
        window.currentValidatedCouponCode = '';
    }
    window.updateCheckoutSummary();
};

window.proceedSelectedCheckout = function() {
    if (!window.currentSelectedPlan) {
        alert('कृपया पहले कोई प्लान चुनें।');
        return;
    }

    // Pro downgrade check on purchase attempt
    if (window.currentSelectedPlan === 'basic' && typeof currentUserPlan !== 'undefined' && currentUserPlan === 'pro' && typeof isUserPaidActive !== 'undefined' && isUserPaidActive) {
        alert('आपका Pro प्लान अभी सक्रिय है! बेसिक प्लान केवल प्रो समाप्त होने के बाद ही लिया जा सकता है।');
        return;
    }

    // Immediate 1,000 credit cap check
    const existingCredits = (typeof window.cachedTotalCredits === 'number') ? window.cachedTotalCredits : 0;
    const creditsToAdd = (window.currentSelectedPlan === 'pro') ? 300 : 100;
    if ((existingCredits + creditsToAdd) > 1000) {
        alert(`अधिकतम संचय सीमा 1,000 क्रेडिट है। आपके पास अभी ${existingCredits} क्रेडिट उपलब्ध हैं। कृपया पहले इनका उपयोग करें।`);
        return;
    }

    window.initiatePayment(window.currentSelectedPlan);
};

window.openPaymentHistoryModal = function() {
    const modal = document.getElementById('historyModal');
    if (modal) {
        modal.style.display = 'flex';
        window.loadPaymentHistory();
    }
};

window.closeHistoryModal = function() { 
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = 'none'; 
};

window.closeSuccessModal = function() { 
    const modal = document.getElementById('successModal');
    if (modal) modal.style.display = 'none'; 
    
    const payView = document.getElementById('paymentView');
    if (payView) payView.classList.remove('active');
    
    if (window.location.pathname !== '/') {
        history.pushState({ path: '/' }, '', '/');
        if (typeof renderRoute === 'function') renderRoute('/');
    }
};

window.closeZeroCreditModal = function() {
    const modal = document.getElementById('zeroCreditModal');
    if (modal) modal.style.display = 'none';
};

window.closeLowCreditNudge = function() {
    const modal = document.getElementById('lowCreditNudgeModal');
    if (modal) modal.style.display = 'none';
};

window.proceedPendingQuery = function() {
    window.closeLowCreditNudge();
    if (typeof pendingUserQuery !== 'undefined' && pendingUserQuery) {
        const q = pendingUserQuery;
        pendingUserQuery = null;
        if (typeof executeSubmit === 'function') {
            executeSubmit(q.text, q.attachCount);
        }
    }
};

/* Route Disambiguation & Instant Policies Loading */
window.switchTab = async function(t) {
    document.querySelectorAll('#policyView .pill-choice-btn').forEach(b => b.classList.remove('active'));
    
    const targetTabKey = (t === 'pricing-policy' || t === 'pricing') ? 'pricing' : t;
    const btn = document.getElementById('btn-' + targetTabKey);
    if (btn) btn.classList.add('active');
    
    const urlPath = (targetTabKey === 'pricing') ? '/pricing-policy' : '/' + targetTabKey;
    if (window.location.pathname !== urlPath) {
        history.replaceState({ path: urlPath }, '', urlPath);
    }

    if (typeof window.policyDocs === 'undefined') {
        try {
            await window.loadExternalScript('/policies.js');
        } catch(e) {}
    }

    const container = document.getElementById('policyContent');
    if (container) {
        if (window.policyDocs && window.policyDocs[targetTabKey]) {
            container.innerHTML = window.policyDocs[targetTabKey];
        } else {
            container.innerHTML = '<div style="padding:16px; color:#1e293b;">नियम व नीतियां लोड हो रही हैं... कृपया प्रतीक्षा करें।</div>';
        }
    }
};

window.loadPaymentHistory = async function() {
    if (!currentUser) return;
    const container = document.getElementById('historyListContainer');
    if (!container) return;
    container.innerHTML = '<p style="color:#64748b; font-size:12px; padding:10px 0;">विगत 3 माह के लेनदेन लोड हो रहे हैं...</p>';

    try {
        const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data: txs, error: txErr } = await supabaseClient
            .from('credit_transactions')
            .select('*')
            .eq('user_id', currentUser.id)
            .gte('created_at', threeMonthsAgo)
            .order('created_at', { ascending: false });

        if (txErr || !txs || txs.length === 0) {
            container.innerHTML = '<p style="color:#64748b; font-size:12px; text-align:center; padding:20px 0;">विगत 3 माह में कोई लेनदेन रिकॉर्ड नहीं मिला।</p>';
            return;
        }

        let html = '';
        txs.forEach(t => {
            const buyDate = typeof formatCleanDate === 'function' ? formatCleanDate(t.created_at) : t.created_at;
            const expDate = typeof formatCleanDate === 'function' ? formatCleanDate(t.expires_at) : (t.expires_at || '30 Days');
            const amt = t.amount_paid == 0 ? 'मुफ़्त (Bonus / VIP)' : '₹' + t.amount_paid;
            const planTitle = t.plan_name ? t.plan_name.split('(')[0].trim() : `${t.credits_added} Credits`;
            
            html += `
                <div class="history-card-item" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:10px;">
                    <div class="history-top-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span class="history-title" style="font-weight:700; color:#1e293b; font-size:13px;">${planTitle} (+${t.credits_added} Credits)</span>
                        <span class="history-amount" style="font-weight:700; color:#008069; font-size:13px;">${amt}</span>
                    </div>
                    <div class="history-details-grid" style="font-size:11px; color:#64748b; line-height:1.6;">
                        <div>📅 <b>दिनांक:</b> ${buyDate}</div>
                        <div>⏳ <b>वैधता:</b> ${expDate}</div>
                        <div style="font-size:10px; color:#94a3b8; margin-top:2px;">🆔 ${t.payment_id ? t.payment_id.substring(0, 24) : (t.transaction_type || 'FREE')}</div>
                    </div>
                </div>`;
        });
        container.innerHTML = html;
    } catch(e) {
        console.error("Payment history error:", e);
        container.innerHTML = '<p style="color:#ef4444; font-size:12px;">इतिहास लोड करने में त्रुटि आई।</p>';
    }
};

window.initiatePayment = async function(planId) {
    if (!currentUser) return;
    const couponVal = window.currentValidatedCouponCode || (document.getElementById('couponInput').value || '').trim();

    showSpinner("सुरक्षित भुगतान मॉड्यूल तैयार हो रहा है...");
    try {
        const ordRes = await fetch('/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                user_id: currentUser.id, 
                plan_id: planId, 
                coupon_code: couponVal 
            })
        });

        hideSpinner();
        if (!ordRes.ok) {
            let errText = `त्रुटि (${ordRes.status}): ऑर्डर तैयार करने में समस्या आई।`;
            try {
                const errData = await ordRes.json();
                errText = errData.detail || errData.message || JSON.stringify(errData);
            } catch(e) {}
            alert(errText);
            return;
        }

        const ordData = await ordRes.json();

        // 1. Free VIP Bypass (Coupon 100% off)
        if (ordData.is_free) {
            showSpinner("VIP कूपन सक्रिय हो रहा है...");
            const vRes = await fetch('/api/verify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    order_id: ordData.order_id,
                    payment_id: "VIP_COUPON",
                    signature: "",
                    plan_id: planId,
                    coupon_code: couponVal || "VIP100"
                })
            });
            hideSpinner();

            if (!vRes.ok) {
                let errDetail = `सत्यापन विफल (${vRes.status})`;
                try {
                    const errData = await vRes.json();
                    errDetail = errData.detail || errDetail;
                } catch(e) {
                    const txt = await vRes.text();
                    errDetail = txt || errDetail;
                }
                alert(errDetail);
                return;
            }

            const vData = await vRes.json();
            if (vData.status === 'success') {
                window.triggerPaymentSuccess(vData.credits_added, vData.new_balance, vData.plan_expires_at, planId);
                if (typeof fetchStats === 'function') await fetchStats();
            }
            return;
        }

        // 2. Razorpay Gateway Pipeline
        if (ordData.gateway === 'razorpay') {
            await window.loadExternalScript('https://checkout.razorpay.com/v1/checkout.js');
            const options = {
                key: ordData.key_id,
                amount: ordData.amount,
                currency: "INR",
                name: "Agri Mitra",
                description: planId.toUpperCase() + " Credit Plan",
                order_id: ordData.order_id,
                handler: async function (response) {
                    showSpinner("भुगतान सत्यापित हो रहा है...");
                    const vRes = await fetch('/api/verify-payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
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

                    if (!vRes.ok) {
                        alert("भुगतान सफल रहा पर खाते में क्रेडिट जोड़ने में समस्या आई। सहायता टीम से संपर्क करें।");
                        return;
                    }

                    const vData = await vRes.json();
                    if (vData.status === 'success') {
                        window.triggerPaymentSuccess(vData.credits_added, vData.new_balance, vData.plan_expires_at, planId);
                        if (typeof fetchStats === 'function') await fetchStats();
                    }
                },
                prefill: {
                    name: currentUser.user_metadata?.full_name || '',
                    email: currentUser.email || ''
                },
                theme: { color: "#008069" }
            };
            const rzp = new Razorpay(options);
            rzp.on('payment.failed', function (resp) {
                alert("भुगतान विफल रहा: " + (resp.error.description || "त्रुटि"));
            });
            rzp.open();
        } 
        else if (ordData.gateway === 'cashfree') {
            alert('Cashfree Gateway इंटीग्रेशन सक्रिय हो रहा है...');
        }

    } catch(e) {
        hideSpinner();
        alert('भुगतान आरंभ करने में त्रुटि आई: ' + e.message);
    }
};

/* Premium Success Celebration with Confetti & Rolling Counter */
window.triggerPaymentSuccess = function(creditsAdded, newBalance, planExpiry, planId) {
    window.loadExternalScript('https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js').then(() => {
        confetti({ particleCount: 140, spread: 85, origin: { y: 0.6 } });
    }).catch(() => {});

    const successModal = document.getElementById('successModal');
    if (!successModal) return;

    successModal.style.display = 'flex';

    const balEl = document.getElementById('successNewBalance');
    if (balEl) balEl.textContent = `${newBalance} क्रेडिट्स`;

    const expEl = document.getElementById('successExpiryDate');
    if (expEl) {
        expEl.innerHTML = typeof formatCleanDateTime === 'function' ? formatCleanDateTime(planExpiry) : (planExpiry || '30 दिन');
    }

    const featEl = document.getElementById('successFeaturesList');
    if (featEl) {
        if (planId === 'pro') {
            featEl.innerHTML = `
                ✓ 300 संपूर्ण कृषि प्रश्न परामर्श<br>
                ✓ <b>इंटरनेट लाइव सर्च</b> (नवीनतम शोध व डेटा)<br>
                ✓ मल्टी-फोटो व पत्ती रोग रिपोर्ट जांच<br>
                ✓ प्राथमिकता से त्वरित उत्तर
            `;
        } else {
            featEl.innerHTML = `
                ✓ 100 कृषि सलाह प्रश्न परामर्श<br>
                ✓ प्रामाणिक वीडियो संदर्भ लाइब्रेरी एक्सेस<br>
                ✓ फसल फोटो / पत्ती रोग प्राथमिक जांच<br>
                ✓ 24x7 डिजिटल कृषि सहायता
            `;
        }
    }

    // Smooth Rolling Counter (0 -> creditsAdded)
    const rollCountEl = document.getElementById('creditRollCount');
    if (rollCountEl) {
        rollCountEl.textContent = '+0';
        let current = 0;
        const target = Number(creditsAdded) || 100;
        const duration = 1200;
        const stepTime = 25; 
        const totalSteps = duration / stepTime;
        const increment = Math.max(1, Math.ceil(target / totalSteps));

        const counterTimer = setInterval(() => {
            current += increment;
            if (current >= target) {
                current = target;
                clearInterval(counterTimer);
            }
            rollCountEl.textContent = `+${current}`;
        }, stepTime);
    }
};
