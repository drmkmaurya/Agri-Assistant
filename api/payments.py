import os
import hmac
import hashlib
from fastapi import HTTPException
import razorpay

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")

rz_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) else None

PLANS = {
    "p5": {"amount": 500, "credits": 5, "name": "₹5 (5 Credits)"},
    "p30": {"amount": 3000, "credits": 50, "name": "₹30 (50 Credits)"},
    "p50": {"amount": 5000, "credits": 100, "name": "₹50 (100 Credits)"},
    "p150": {"amount": 15000, "credits": 500, "name": "₹150 (500 Credits)"}
}

def validate_and_apply_coupon(coupon_code: str, plan_id: str, supabase):
    if not coupon_code:
        return 0, None
        
    code = coupon_code.strip().upper()
    res = supabase.table("coupons").select("*").eq("code", code).eq("is_active", True).execute()
    
    if not res.data:
        raise HTTPException(status_code=400, detail="Amanavanya (Invalid) Coupon Code.")
        
    c = res.data[0]
    if c["used_count"] >= c["max_uses"]:
        raise HTTPException(status_code=400, detail="Yeh coupon expire ho chuka hai.")
        
    if plan_id not in c["allowed_plans"]:
        raise HTTPException(status_code=400, detail="Yeh coupon is plan par laagu nahi hai.")
        
    return c["discount_percent"], code

def process_order(user_id: str, plan_id: str, coupon_code: str, supabase):
    if plan_id not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan selected.")
        
    base_amount = PLANS[plan_id]["amount"]
    discount_pct, valid_code = validate_and_apply_coupon(coupon_code, plan_id, supabase)
    
    final_amount = int(base_amount * (1 - (discount_pct / 100)))

    # Agar 100% discount hai (VIP coupon) toh Razorpay ki zarurat nahi
    if final_amount == 0:
        return {
            "order_id": f"free_{user_id[:8]}_{int(os.times()[4])}",
            "amount": 0,
            "is_free": True,
            "key_id": RAZORPAY_KEY_ID,
            "applied_coupon": valid_code
        }

    if not rz_client:
        raise HTTPException(status_code=500, detail="Razorpay credentials missing on server.")

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
    plan = PLANS[plan_id]
    credits_to_add = plan["credits"]
    
    # 1. Free plan verification
    if order_id.startswith("free_"):
        discount_pct, valid_code = validate_and_apply_coupon(coupon_code, plan_id, supabase)
        if discount_pct != 100:
            raise HTTPException(status_code=400, detail="Fraudulent free transaction attempt.")
    else:
        # 2. Razorpay Signature Verification
        msg = f"{order_id}|{payment_id}"
        expected_sig = hmac.new(
            RAZORPAY_KEY_SECRET.encode(),
            msg.encode(),
            hashlib.sha256
        ).hexdigest()
        if expected_sig != signature:
            raise HTTPException(status_code=400, detail="Signature verification failed.")

    # 3. Add Credits
    user_res = supabase.table("user_profiles").select("extra_purchased_credits").eq("id", user_id).single().execute()
    curr = user_res.data.get("extra_purchased_credits", 0) if user_res.data else 0

    supabase.table("user_profiles").update({
        "extra_purchased_credits": curr + credits_to_add
    }).eq("id", user_id).execute()

    # 4. Update Coupon Counter & Log
    if coupon_code:
        supabase.rpc("increment_coupon_use", {"coupon_code": coupon_code.upper()}).execute()

    supabase.table("credit_transactions").insert({
        "user_id": user_id,
        "order_id": order_id,
        "payment_id": payment_id or "FREE_COUPON",
        "amount_paid": 0 if order_id.startswith("free_") else plan["amount"] / 100,
        "credits_added": credits_to_add,
        "status": "success"
    }).execute()

    return {"status": "success", "credits_added": credits_to_add}
