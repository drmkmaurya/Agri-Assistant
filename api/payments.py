import os
import time
import hmac
import hashlib
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
import razorpay

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()

CASHFREE_APP_ID = os.environ.get("CASHFREE_APP_ID", "").strip()
CASHFREE_SECRET_KEY = os.environ.get("CASHFREE_SECRET_KEY", "").strip()

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

def get_active_gateway(supabase) -> str:
    try:
        res = supabase.table("app_settings").select("active_payment_gateway").limit(1).execute()
        if res.data and res.data[0].get("active_payment_gateway"):
            return str(res.data[0]["active_payment_gateway"]).lower()
    except Exception:
        pass
    return "razorpay"

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

    user_res = supabase.table("user_profiles").select("total_credits, plan_type, plan_expires_at, email, full_name").eq("id", user_id).single().execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="उपयोगकर्ता खाता नहीं मिला।")
        
    user_data = user_res.data
    current_credits = user_data.get("total_credits", 0)
    current_plan = user_data.get("plan_type", "free")
    plan_expires_at = user_data.get("plan_expires_at")

    now_utc = datetime.now(timezone.utc)
    is_pro_active = False
    if current_plan == "pro" and current_credits > 0:
        if plan_expires_at:
            try:
                exp_dt = datetime.fromisoformat(plan_expires_at.replace("Z", "+00:00"))
                if now_utc <= exp_dt:
                    is_pro_active = True
            except Exception:
                pass

    if is_pro_active and plan_id == "basic":
        raise HTTPException(
            status_code=400,
            detail="आपका Pro प्लान अभी सक्रिय है। बेसिक प्लान केवल प्रो प्लान समाप्त (क्रेडिट 0) होने के बाद ही लिया जा सकता है।"
        )

    if (current_credits + credits_to_add) > MAX_CREDIT_CAP:
        raise HTTPException(
            status_code=400,
            detail=f"कृपया पहले अपने मौजूदा क्रेडिट का उपयोग करें। आपके पास अभी {current_credits} क्रेडिट उपलब्ध हैं।"
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
            "gateway": "vip_free",
            "key_id": "",
            "applied_coupon": valid_code
        }

    gateway = get_active_gateway(supabase)

    if gateway == "cashfree":
        # Cashfree Gateway Architecture Payload
        unique_order_id = f"cf_{user_id[:6]}_{int(time.time()*1000)}"[:40]
        return {
            "order_id": unique_order_id,
            "amount": final_amount / 100,
            "is_free": False,
            "gateway": "cashfree",
            "app_id": CASHFREE_APP_ID,
            "applied_coupon": valid_code
        }
    else:
        # Default Razorpay Architecture
        if not rz_client or not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
            raise HTTPException(status_code=500, detail="Razorpay credentials Vercel Environment Variables में अनुपलब्ध हैं।")

        try:
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
            raise HTTPException(status_code=400, detail=f"Order Error: {str(rz_err)}")

        return {
            "order_id": order["id"],
            "amount": final_amount,
            "is_free": False,
            "gateway": "razorpay",
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
        gateway = get_active_gateway(supabase)
        if gateway == "razorpay":
            msg = f"{order_id}|{payment_id}"
            expected_sig = hmac.new(
                RAZORPAY_KEY_SECRET.encode(),
                msg.encode(),
                hashlib.sha256
            ).hexdigest()
            if expected_sig != signature:
                raise HTTPException(status_code=400, detail="भुगतान सत्यापन (Signature) विफल रहा।")
        elif gateway == "cashfree":
            # Cashfree verification
            if not payment_id:
                raise HTTPException(status_code=400, detail="Cashfree payment ID आवश्यक है।")

    now = datetime.now(timezone.utc)
    user_res = supabase.table("user_profiles").select("total_credits, max_pack_credits, plan_type, plan_expires_at").eq("id", user_id).single().execute()
    user_data = user_res.data or {}
    current_credits = user_data.get("total_credits", 0)
    current_plan = user_data.get("plan_type", "free")
    current_expires_at = user_data.get("plan_expires_at")

    new_balance = min(MAX_CREDIT_CAP, current_credits + credits_to_add)

    base_time = now
    if current_expires_at and current_plan in ["basic", "pro"]:
        try:
            curr_exp = datetime.fromisoformat(current_expires_at.replace("Z", "+00:00"))
            if curr_exp > now:
                base_time = curr_exp
        except Exception:
            pass
            
    new_expiry = (base_time + timedelta(days=30)).isoformat()
    resulting_plan = "pro" if (plan_id == "pro" or current_plan == "pro") else "basic"

    supabase.table("user_profiles").update({
        "plan_type": resulting_plan,
        "total_credits": new_balance,
        "max_pack_credits": new_balance,
        "plan_expires_at": new_expiry
    }).eq("id", user_id).execute()

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
