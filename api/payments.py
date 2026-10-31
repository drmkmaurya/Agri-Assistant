import os
import time
import hmac
import hashlib
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
import razorpay

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()

rz_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) else None

PLANS = {
    "basic": {
        "amount": 4900,         # ₹49 in paise
        "credits": 100,
        "name": "Basic Plan (100 Credits / 30 Days)"
    },
    "pro": {
        "amount": 9900,         # ₹99 in paise
        "credits": 300,
        "name": "Pro Plan (300 Credits / 30 Days)"
    }
}

MAX_CREDIT_CAP = 1000

def validate_coupon(coupon_code: str, plan_id: str, supabase):
    if not coupon_code:
        return 0, None
        
    code = coupon_code.strip().upper()
    res = supabase.table("coupons").select("*").eq("code", code).eq("is_active", True).execute()
    
    if not res.data:
        raise HTTPException(status_code=400, detail="अमान्य (Invalid) कूपन कोड। कृपया सही कोड दर्ज करें।")
        
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
        
    plan = PLANS[plan_id]
    credits_to_add = plan["credits"]

    # 1,000 Credit Limit Check
    user_res = supabase.table("user_profiles").select("total_credits").eq("id", user_id).single().execute()
    current_credits = user_res.data.get("total_credits", 0) if user_res.data else 0

    if (current_credits + credits_to_add) > MAX_CREDIT_CAP:
        raise HTTPException(
            status_code=400,
            detail=f"कृपया पहले अपने मौजूदा क्रेडिट का उपयोग करें। आपके पास अभी {current_credits} क्रेडिट उपलब्ध हैं (अधिकतम सीमा: 1,000 क्रेडिट)।"
        )

    base_amount = plan["amount"]
    discount_pct = 0
    valid_code = None

    if coupon_code and coupon_code.strip():
        discount_pct, valid_code = validate_coupon(coupon_code, plan_id, supabase)

    final_amount = int(base_amount * (1 - (discount_pct / 100)))

    # Free VIP Coupon bypass
    if final_amount == 0:
        return {
            "order_id": f"free_{user_id[:8]}_{int(time.time()*1000)}",
            "amount": 0,
            "is_free": True,
            "key_id": RAZORPAY_KEY_ID,
            "applied_coupon": valid_code
        }

    if not rz_client or not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(status_code=500, detail="Razorpay credentials Vercel Environment Variables me missing ya galat hain.")

    try:
        # Unique receipt ID per attempt to prevent "order is already paid" error
        unique_receipt = f"rc_{user_id[:6]}_{int(time.time()*1000)}"[:40]
        order = rz_client.order.create({
            "amount": final_amount,
            "currency": "INR",
            "receipt": unique_receipt,
            "notes": {
                "user_id": str(user_id),
                "plan_id": str(plan_id),
                "coupon": str(valid_code or "")
            }
        })
    except Exception as rz_err:
        print(f"Razorpay Order Creation Failed: {rz_err}")
        raise HTTPException(status_code=400, detail=f"Razorpay Order Error: {str(rz_err)}")

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
    credits_to_add = plan["credits"]

    if order_id.startswith("free_"):
        discount_pct, _ = validate_coupon(coupon_code, plan_id, supabase)
        if discount_pct != 100:
            raise HTTPException(status_code=400, detail="निःशुल्क सक्रियण अमान्य है।")
    else:
        msg = f"{order_id}|{payment_id}"
        expected_sig = hmac.new(
            RAZORPAY_KEY_SECRET.encode(),
            msg.encode(),
            hashlib.sha256
        ).hexdigest()
        if expected_sig != signature:
            raise HTTPException(status_code=400, detail="भुगतान सत्यापन (Signature) विफल रहा।")

    # Precise minute/second timestamp for 30 days
    now = datetime.now(timezone.utc)
    new_expiry = (now + timedelta(days=30)).isoformat()

    user_res = supabase.table("user_profiles").select("total_credits, max_pack_credits").eq("id", user_id).single().execute()
    current_credits = user_res.data.get("total_credits", 0) if user_res.data else 0
    new_balance = min(MAX_CREDIT_CAP, current_credits + credits_to_add)

    # Update User Plan & Credits
    supabase.table("user_profiles").update({
        "plan_type": plan_id,
        "total_credits": new_balance,
        "max_pack_credits": new_balance,
        "plan_expires_at": new_expiry
    }).eq("id", user_id).execute()

    # Log Transaction with Expiry Date for 3-Month History
    supabase.table("credit_transactions").insert({
        "user_id": user_id,
        "order_id": order_id,
        "payment_id": payment_id or "VIP_COUPON",
        "amount_paid": 0 if order_id.startswith("free_") else plan["amount"] / 100,
        "credits_added": credits_to_add,
        "expires_at": new_expiry,
        "plan_name": plan["name"],
        "status": "success"
    }).execute()

    return {
        "status": "success",
        "credits_added": credits_to_add,
        "new_balance": new_balance,
        "plan_expires_at": new_expiry
    }
