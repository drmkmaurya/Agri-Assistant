import os
import time
import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client

try:
    from api.payments import process_order, verify_and_credit, validate_coupon_for_user
    from api.services.user_service import (
        get_super_control_settings,
        get_or_create_user_profile,
        update_user_credits
    )
    from api.services.rag_service import generate_rag_answer
except ImportError:
    from payments import process_order, verify_and_credit, validate_coupon_for_user
    from services.user_service import (
        get_super_control_settings,
        get_or_create_user_profile,
        update_user_credits
    )
    from services.rag_service import generate_rag_answer

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wvptpethggrslyeqsjdn.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if (SUPABASE_URL and SUPABASE_KEY) else None

IST = ZoneInfo("Asia/Kolkata")
concurrency_counter = 0
concurrency_lock = asyncio.Lock()
rate_limit_records = {}

def apply_rate_limit(client_ip: str):
    now = time.time()
    if client_ip not in rate_limit_records:
        rate_limit_records[client_ip] = []
    minute_window = now - 60
    recent = [t for t in rate_limit_records[client_ip] if t > minute_window]
    rate_limit_records[client_ip] = recent
    if len(recent) >= 20:
        raise HTTPException(status_code=429, detail="आपने 1 मिनट में अधिक अनुरोध किए हैं। कृपया 1 मिनट प्रतीक्षा करें।")
    rate_limit_records[client_ip].append(now)

class QueryReq(BaseModel):
    query: str
    user_id: str
    attachment_count: int = 0
    language: str = "hi"
    web_search_enabled: bool = False

class SupportReq(BaseModel):
    user_id: str
    name: str
    email: str
    phone: str
    concern: str = ""
    category: str = "general"
    priority: str = "normal"
    user_plan: str = "none"

class OrderReq(BaseModel):
    user_id: str
    plan_id: str
    coupon_code: str = ""

class VerifyPaymentReq(BaseModel):
    user_id: str
    order_id: str
    payment_id: str = ""
    signature: str = ""
    plan_id: str
    coupon_code: str = ""

class ValidateCouponReq(BaseModel):
    coupon_code: str
    plan_id: str
    user_id: str = ""

@app.post("/api/ask")
@app.post("/ask")
async def ask_endpoint(req: QueryReq, request: Request):
    global concurrency_counter
    client_ip = request.headers.get("x-forwarded-for", request.client.host or "127.0.0.1").split(",")[0].strip()
    apply_rate_limit(client_ip)

    if not req.user_id:
        raise HTTPException(status_code=401, detail="कृपया पहले Google से साइन इन करें।")

    settings = get_super_control_settings()
    if settings.get("maintenance_mode") or settings.get("chat_maintenance"):
        raise HTTPException(status_code=503, detail="कृषि चैट सेवा अभी रखरखाव (Maintenance) में है। कृपया कुछ समय बाद प्रयास करें।")

    profile = get_or_create_user_profile(req.user_id)
    if profile.get("status") == "banned":
        raise HTTPException(status_code=403, detail="खाता अवरुद्ध कर दिया गया है।")

    plan_type = (profile.get("plan_type") or "free").lower()
    plan_expires_at = profile.get("plan_expires_at")
    total_credits = profile.get("total_credits", 0)

    is_paid_active = False
    now_utc = datetime.now(timezone.utc)
    if plan_type in ["basic", "pro"]:
        if plan_expires_at:
            try:
                exp_time = datetime.fromisoformat(str(plan_expires_at).replace("Z", "+00:00"))
                if now_utc <= exp_time and total_credits > 0:
                    is_paid_active = True
                else:
                    plan_type = "free"
                    supabase.table("user_profiles").update({"plan_type": "free"}).eq("id", req.user_id).execute()
                    profile["plan_type"] = "free"
            except Exception:
                plan_type = "free"
        else:
            plan_type = "free"

    if not is_paid_active and req.attachment_count > 0:
        raise HTTPException(status_code=403, detail="फोटो / दस्तावेज़ जांच केवल Basic और Pro प्लान में उपलब्ध है।")

    credits_needed = 1 + min(2, req.attachment_count)

    if total_credits < credits_needed:
        if is_paid_active:
            raise HTTPException(status_code=402, detail=f"इस सवाल के लिए {credits_needed} क्रेडिट चाहिए। शेष बैलेंस: {total_credits}")
        else:
            raise HTTPException(status_code=402, detail="आपके निःशुल्क क्रेडिट समाप्त हो चुके हैं। सवाल पूछने के लिए नया प्लान चुनें।")

    async with concurrency_lock:
        concurrency_counter += 1
    
    try:
        if plan_type == "free" and concurrency_counter > 5:
            await asyncio.sleep(0.5)
    finally:
        async with concurrency_lock:
            concurrency_counter = max(0, concurrency_counter - 1)

    user_query = req.query.strip()
    clean_q = user_query.lower()

    greetings = ["hello", "hi", "namaste", "pranam", "hey", "नमस्ते", "प्रणाम", "राम राम"]
    if clean_q in greetings:
        greeting_text = "नमस्ते किसान भाई! 🙏 बताइए, आज फसल, मिट्टी या प्राकृतिक कृषि से संबंधित क्या सहायता चाहिए?" if req.language == "hi" else "Hello Farmer Friend! 🙏 How can I assist you with your farming, soil, or organic agriculture today?"
        return {
            "answer": greeting_text,
            "sources": [],
            "total_credits": total_credits,
            "plan_type": plan_type
        }

    try:
        allow_web_search = bool(req.web_search_enabled and is_paid_active and plan_type == "pro")
        context_summary = profile.get("chat_context_summary") or ""
        answer_text, sources = generate_rag_answer(user_query, req.language, allow_web_search, context_summary)
    except Exception as e:
        print(f"Chat execution error: {e}")
        raise HTTPException(status_code=500, detail="तकनीकी समस्या आई। आपका कोई क्रेडिट नहीं काटा गया है।")

    new_balance = max(0, total_credits - credits_needed)
    updated_plan_type = plan_type
    if is_paid_active and new_balance == 0:
        updated_plan_type = "free"

    update_user_credits(req.user_id, new_balance, updated_plan_type)

    try:
        supabase.table("user_chat_history").insert({
            "user_id": req.user_id,
            "query_text": user_query,
            "response_text": answer_text,
            "credits_deducted": credits_needed,
            "attachments_count": req.attachment_count
        }).execute()
    except Exception as he:
        print(f"History log error: {he}")

    try:
        new_summary = f"{context_summary}\n- Q: {user_query[:60]}"[-350:]
        supabase.table("user_profiles").update({"chat_context_summary": new_summary}).eq("id", req.user_id).execute()
    except Exception:
        pass

    return {
        "answer": answer_text,
        "sources": sources,
        "total_credits": new_balance,
        "plan_type": updated_plan_type
    }

# Universal Coupon Validation Route
@app.post("/api/validate-coupon")
@app.post("/validate-coupon")
async def validate_coupon_endpoint(req: ValidateCouponReq):
    discount_pct, code = validate_coupon_for_user(req.coupon_code, req.plan_id, req.user_id, supabase)
    return {
        "valid": True,
        "code": code,
        "discount_percent": discount_pct
    }

# Universal Order Creation Routes
@app.post("/api/create-order")
@app.post("/create-order")
@app.post("/api/create-order/")
@app.post("/create-order/")
async def create_order_endpoint(req: OrderReq):
    settings = get_super_control_settings()
    if settings.get("maintenance_mode") or settings.get("payment_maintenance"):
        raise HTTPException(status_code=503, detail="भुगतान सेवा अभी रखरखाव (Maintenance) में है। कृपया कुछ समय बाद पुनः प्रयास करें।")
    return process_order(req.user_id, req.plan_id, req.coupon_code, supabase)

# Universal Payment Verification Routes
@app.post("/api/verify-payment")
@app.post("/verify-payment")
@app.post("/api/verify-payment/")
@app.post("/verify-payment/")
async def verify_payment_endpoint(req: VerifyPaymentReq):
    return verify_and_credit(
        req.user_id, req.order_id, req.payment_id, req.signature, req.plan_id, req.coupon_code, supabase
    )

@app.get("/api/user-stats")
@app.get("/user-stats")
async def user_stats(user_id: str, email: str = "", name: str = "", avatar: str = ""):
    data = get_or_create_user_profile(user_id, email, name, avatar)
    settings = get_super_control_settings()

    plan_type = (data.get("plan_type") or "free").lower()
    plan_expires_at = data.get("plan_expires_at")
    total_credits = data.get("total_credits", 0)

    is_paid_active = False
    now_utc = datetime.now(timezone.utc)
    if plan_type in ["basic", "pro"]:
        if plan_expires_at:
            try:
                exp_time = datetime.fromisoformat(str(plan_expires_at).replace("Z", "+00:00"))
                if now_utc <= exp_time and total_credits > 0:
                    is_paid_active = True
                else:
                    plan_type = "free"
                    supabase.table("user_profiles").update({"plan_type": "free"}).eq("id", user_id).execute()
            except Exception:
                plan_type = "free"
        else:
            plan_type = "free"

    return {
        "status": data.get("status", "approved"),
        "plan_type": plan_type,
        "total_credits": total_credits,
        "plan_expires_at": plan_expires_at,
        "is_paid_active": is_paid_active,
        "super_control": {
            "maintenance_mode": settings.get("maintenance_mode", False),
            "chat_maintenance": settings.get("chat_maintenance", False),
            "payment_maintenance": settings.get("payment_maintenance", False),
            "active_payment_gateway": settings.get("active_payment_gateway", "razorpay"),
            "welcome_credits": settings.get("welcome_credits", 10),
            "welcome_days": settings.get("welcome_days", 30)
        }
    }

@app.get("/api/payment-history")
@app.get("/payment-history")
async def payment_history_endpoint(user_id: str):
    three_months_ago = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    res = supabase.table("credit_transactions")\
        .select("*")\
        .eq("user_id", user_id)\
        .gte("created_at", three_months_ago)\
        .order("created_at", desc=True)\
        .execute()
    return {"transactions": res.data or []}
