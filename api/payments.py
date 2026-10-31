import os
import hmac
import hashlib
from datetime import datetime, timedelta
from fastapi import HTTPException
import razorpay

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")

rz_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) else None

PLANS = {
    "basic": {
        "amount": 4900,         # ₹49 in paise
        "daily_limit": 15,
        "name": "Basic Plan (15 Sawal/Din)"
    },
    "pro": {
        "amount": 9900,         # ₹99 in paise
        "daily_limit": 50,
        "name": "Pro Plan (50 Sawal/Din)"
    }
}

def validate_coupon(coupon_code: str, plan_id: str, supabase):
    if not coupon_code:
        return 0, None
        
    code = coupon_code.strip().upper()
    res = supabase.table("coupons").select("*").eq("code", code).eq("is_active", True).execute()
    
    if not res.data:
        raise HTTPException(status_code=400, detail="अमान्य (Invalid) कूपन कोड।")
        
    c = res.data[0]
    if c.get("used_count", 0) >= c.get("max_uses", 9999):
        raise HTTPException(status_code=400, detail="यह कूपन समाप्त (Expired) हो चुका है।")
        
    allowed = c.get("allowed_plans") or ['basic', 'pro']
    if plan_id not in allowed:
        raise HTTPException(status_code=400, detail="यह कूपन इस प्लान पर मान्य नहीं है।")
        
    return c["discount_percent"], code

def process_order(user_id: str, plan_id: str, coupon_code: str, supabase):
    if plan_id not in PLANS:
        raise HTTPException(status_code=400, detail="अमान्य प्लान चुना गया है।")
        
    base_amount = PLANS[plan_id]["amount"]
    discount_pct, valid_code = validate_coupon(coupon_code, plan_id, supabase)
    final_amount = int(base_amount * (1 - (discount_pct / 100)))

    # 100% Free VIP Coupon bypass
    if final_amount == 0:
        return {
            "order_id": f"free_{user_id[:8]}_{int(datetime.utcnow().timestamp())}",
            "amount": 0,
            "is_free": True,
            "key_id": RAZORPAY_KEY_ID,
            "applied_coupon": valid_code
        }

    if not rz_client:
        raise HTTPException(status_code=500, detail="Razorpay credentials Vercel me missing hain.")

    order = rz_client.order.create({
        "amount": final_amount,
        "currency": "INR",
        "receipt": f"rcpt_{user_id[:8]}",
        "notes": {"user_id": user_id, "plan_id": plan_id, "coupon": valid_code or ""}
    })

    return {
        "order_id": order["id"],
        "amount": final_amount,
        "is_free": False,
        "key_id": RAZORPAY_KEY_ID,
        "applied_coupon": valid_code
    }

def verify_and_credit(user_id: str, order_id: str, payment_id: str, signature: str, plan_id: str, coupon_code: str, supabase):
    if plan_id not in PLANS:
        raise HTTPException(status_code=400, detail="अमान्य प्लान।")

    plan = PLANS[plan_id]
    new_daily_limit = plan["daily_limit"]

    # Free coupon validation
    if order_id.startswith("free_"):
        discount_pct, _ = validate_coupon(coupon_code, plan_id, supabase)
        if discount_pct != 100:
            raise HTTPException(status_code=400, detail="निःशुल्क सक्रियण अमान्य है।")
    else:
        # Razorpay HMAC SHA256 Signature verification
        msg = f"{order_id}|{payment_id}"
        expected_sig = hmac.new(
            RAZORPAY_KEY_SECRET.encode(),
            msg.encode(),
            hashlib.sha256
        ).hexdigest()
        if expected_sig != signature:
            raise HTTPException(status_code=400, detail="भुगतान सत्यापन (Signature) विफल रहा।")

    # Update User Plan for 30 Days
    new_expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
    supabase.table("user_profiles").update({
        "plan_type": plan_id,
        "daily_credits_limit": new_daily_limit,
        "plan_expires_at": new_expiry
    }).eq("id", user_id).execute()

    # Log Payment Transaction
    supabase.table("credit_transactions").insert({
        "user_id": user_id,
        "order_id": order_id,
        "payment_id": payment_id or "VIP_COUPON",
        "amount_paid": 0 if order_id.startswith("free_") else plan["amount"] / 100,
        "credits_added": new_daily_limit,
        "status": "success"
    }).execute()

    return {"status": "success", "daily_limit": new_daily_limit}
