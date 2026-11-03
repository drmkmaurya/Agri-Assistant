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

function handleSelectPlan(planId) {
    if (planId === 'basic' && currentUserPlan === 'pro' && isUserPaidActive) {
        alert('आपका Pro प्लान अभी सक्रिय है! बेसिक प्लान केवल प्रो समाप्त होने पर ही लिया जा सकता है।');
        return;
    }
    initiatePayment(planId);
}

function openPaymentHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (modal) {
        modal.style.display = 'flex';
        loadPaymentHistory();
    }
}

function closeHistoryModal() { 
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = 'none'; 
}

function closeSuccessModal() { 
    const modal = document.getElementById('successModal');
    if (modal) modal.style.display = 'none'; 
}

function closeZeroCreditModal() {
    const modal = document.getElementById('zeroCreditModal');
    if (modal) modal.style.display = 'none';
}

function closeLowCreditNudge() {
    const modal = document.getElementById('lowCreditNudgeModal');
    if (modal) modal.style.display = 'none';
}

function proceedPendingQuery() {
    closeLowCreditNudge();
    if (typeof pendingUserQuery !== 'undefined' && pendingUserQuery) {
        const q = pendingUserQuery;
        pendingUserQuery = null;
        if (typeof executeSubmit === 'function') {
            executeSubmit(q.text, q.attachCount);
        }
    }
}

function switchTab(t) {
    document.querySelectorAll('#policyView .pill-choice-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('btn-' + t);
    if (btn) btn.classList.add('active');
    
    if (window.location.pathname !== '/' + t) {
        history.replaceState({ path: '/' + t }, '', '/' + t);
    }

    const container = document.getElementById('policyContent');
    if (container) {
        container.innerHTML = (typeof policyDocs !== 'undefined' && policyDocs[t]) 
            ? policyDocs[t] 
            : '<p>नीतियां लोड हो रही हैं...</p>';
    }
}

function applyCouponFeedback() {
    const val = (document.getElementById('couponInput').value || '').trim().toUpperCase();
    const msgEl = document.getElementById('couponFeedbackMsg');
    if (!msgEl) return;

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
        msgEl.textContent = `कोड "${val}" दर्ज हुआ। प्लान चुनने पर मान्य होगा।`;
    }
}

async function loadPaymentHistory() {
    if (!currentUser) return;
    const container = document.getElementById('historyListContainer');
    if (!container) return;
    container.innerHTML = '<p style="color:#64748b; font-size:12px;">विगत 3 माह के लेनदेन लोड हो रहे हैं...</p>';

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
            const expDate = typeof formatCleanDate === 'function' ? formatCleanDate(t.expires_at) : t.expires_at;
            const amt = t.amount_paid == 0 ? 'मुफ़्त (VIP / Bonus)' : '₹' + t.amount_paid;
            const planTitle = t.plan_name ? t.plan_name.split('(')[0].trim() : `${t.credits_added} Credits`;
            
            html += `
                <div class="history-card-item" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:10px;">
                    <div class="history-top-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span class="history-title" style="font-weight:700; color:#1e293b; font-size:13px;">${planTitle} (+${t.credits_added} Credits)</span>
                        <span class="history-amount" style="font-weight:700; color:#008069; font-size:13px;">${amt}</span>
                    </div>
                    <div class="history-details-grid" style="font-size:11px; color:#64748b; line-height:1.6;">
                        <div>📅 <b>दिनांक:</b> ${buyDate}</div>
                        <div>⏳ <b>वैधता:</b> ${expDate || '30 Days'}</div>
                        <div style="font-size:10px; color:#94a3b8; margin-top:2px;">🆔 ${t.payment_id ? t.payment_id.substring(0, 24) : (t.transaction_type || 'FREE')}</div>
                    </div>
                </div>`;
        });
        container.innerHTML = html;
    } catch(e) {
        console.error("Payment history error:", e);
        container.innerHTML = '<p style="color:#ef4444; font-size:12px;">इतिहास लोड करने में त्रुटि आई।</p>';
    }
}

async function initiatePayment(planId) {
    if (!currentUser) return;
    const couponVal = (document.getElementById('couponInput').value || '').trim();

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
        
        const payView = document.getElementById('paymentView');
        if (payView) payView.classList.remove('active');

        // Free VIP coupon bypass
        if (ordData.is_free) {
            showSpinner("VIP कूपन सक्रिय हो रहा है...");
            const vRes = await fetch('/api/verify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                triggerPaymentSuccess(vData.credits_added);
                fetchStats();
            }
            return;
        }

        // Razorpay Gateway Pipeline
        if (ordData.gateway === 'razorpay') {
            await loadExternalScript('https://checkout.razorpay.com/v1/checkout.js');
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
                    const vData = await vRes.json();
                    if (vData.status === 'success') {
                        triggerPaymentSuccess(vData.credits_added);
                        fetchStats();
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
        alert('भुगतान आरंभ करने में त्रुटि आई। कृपया पुनः प्रयास करें।');
    }
}

function triggerPaymentSuccess(creditsAdded) {
    loadExternalScript('https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js').then(() => {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    }).catch(() => {});

    const successModal = document.getElementById('successModal');
    if (successModal) {
        successModal.style.display = 'flex';
        const rollCount = document.getElementById('creditRollCount');
        if (rollCount) rollCount.textContent = `+${creditsAdded} Credits`;
    }
}
