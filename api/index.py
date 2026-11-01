import os
import time
import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from google import genai
from google.genai import types

try:
    from api.payments import process_order, verify_and_credit
except ImportError:
    from payments import process_order, verify_and_credit

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
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if (SUPABASE_URL and SUPABASE_KEY) else None
client: genai.Client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# IST Timezone for Daily Midnight Reset
IST = ZoneInfo("Asia/Kolkata")

# In-Memory Concurrency Semaphore for Priority Queue
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
    if len(recent) >= 10:
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

class ClaimWelcomeReq(BaseModel):
    user_id: str

def get_super_control_settings():
    try:
        res = supabase.table("app_settings").select("*").limit(1).execute()
        if res.data:
            return res.data[0]
    except Exception:
        pass
    return {
        "maintenance_mode": False,
        "banner_enabled": False,
        "banner_text": "",
        "welcome_credits": 10,
        "welcome_days": 10,
        "welcome_enabled": True
    }

def sync_daily_free_credit(profile: dict, user_id: str) -> dict:
    """
    Checks if a user on 'free' plan needs today's 1 free credit.
    Resets at midnight IST without accumulating.
    """
    today_ist_str = datetime.now(IST).strftime("%Y-%m-%d")
    plan_type = profile.get("plan_type") or "free"
    last_free_date = profile.get("last_free_credit_date")
    total_credits = profile.get("total_credits", 0)

    # Only applies if user is on Free plan
    if plan_type == "free":
        if last_free_date != today_ist_str:
            # New day: grant exactly 1 free credit for today (non-accumulating)
            new_credits = 1
            supabase.table("user_profiles").update({
                "total_credits": new_credits,
                "max_pack_credits": 1,
                "last_free_credit_date": today_ist_str
            }).eq("id", user_id).execute()
            profile["total_credits"] = new_credits
            profile["max_pack_credits"] = 1
            profile["last_free_credit_date"] = today_ist_str

    return profile

@app.post("/api/ask")
@app.post("/ask")
async def ask_endpoint(req: QueryReq, request: Request):
    global concurrency_counter
    client_ip = request.headers.get("x-forwarded-for", request.client.host or "127.0.0.1").split(",")[0].strip()
    apply_rate_limit(client_ip)

    if not req.user_id:
        raise HTTPException(status_code=401, detail="कृपया पहले Google से साइन इन करें।")

    settings = get_super_control_settings()
    if settings.get("maintenance_mode"):
        raise HTTPException(status_code=503, detail="सिस्टम अभी रखरखाव (Maintenance) मोड में है। कृपया कुछ समय बाद प्रयास करें।")

    user_res = supabase.table("user_profiles").select("*").eq("id", req.user_id).limit(1).execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="खाता नहीं मिला।")
    
    profile = user_res.data[0]
    if profile.get("status") == "pending":
        raise HTTPException(status_code=403, detail="आपका खाता अभी समीक्षा (Pending) में है।")
    if profile.get("status") == "banned":
        raise HTTPException(status_code=403, detail="आपका खाता ब्लॉक कर दिया गया है।")

    plan_type = profile.get("plan_type") or "free"
    plan_expires_at = profile.get("plan_expires_at")
    total_credits = profile.get("total_credits", 0)

    # Validate Plan Expiration & Auto-Downgrade to Free
    is_paid_active = False
    now_utc = datetime.now(timezone.utc)
    if plan_type in ["basic", "pro"]:
        if plan_expires_at:
            try:
                exp_time = datetime.fromisoformat(plan_expires_at.replace("Z", "+00:00"))
                if now_utc <= exp_time and total_credits > 0:
                    is_paid_active = True
                else:
                    # Downgrade to Free plan immediately
                    plan_type = "free"
                    supabase.table("user_profiles").update({"plan_type": "free"}).eq("id", req.user_id).execute()
                    profile["plan_type"] = "free"
            except Exception:
                plan_type = "free"
        else:
            plan_type = "free"

    # Sync daily free credit if user is now on free plan
    profile = sync_daily_free_credit(profile, req.user_id)
    total_credits = profile.get("total_credits", 0)

    # Free plan lock for attachments
    if not is_paid_active and req.attachment_count > 0:
        raise HTTPException(status_code=403, detail="फोटो / दस्तावेज़ जांच केवल Basic और Pro प्लान में उपलब्ध है। कृपया प्लान अपग्रेड करें।")

    # Credits needed calculation
    credits_needed = 1 + min(2, req.attachment_count)

    if total_credits < credits_needed:
        if is_paid_active:
            raise HTTPException(status_code=402, detail=f"इस सवाल के लिए {credits_needed} क्रेडिट चाहिए, जबकि आपके पास केवल {total_credits} क्रेडिट शेष हैं। कृपया नया पैक खरीदें।")
        else:
            raise HTTPException(status_code=402, detail="आपके पास आज का फ्री क्रेडिट समाप्त हो गया है। कल मध्यरात्रि 12 बजे 1 नया क्रेडिट स्वतः मिलेगा, या तुरंत पूछने के लिए Basic/Pro प्लान लें।")

    # Priority Queue Management: Pro > Basic > Free
    async with concurrency_lock:
        concurrency_counter += 1
    
    try:
        if plan_type == "free" and concurrency_counter > 5:
            # Yield momentarily to prioritize Pro & Basic users under heavy load
            await asyncio.sleep(1.2)
        elif plan_type == "basic" and concurrency_counter > 15:
            await asyncio.sleep(0.4)
        # Pro users bypass all sleep and execute immediately
    finally:
        async with concurrency_lock:
            concurrency_counter = max(0, concurrency_counter - 1)

    user_query = req.query.strip()
    clean_q = user_query.lower()

    # Fast Greeting Intent (Zero LLM / Zero Credit Loss)
    greetings = ["hello", "hi", "namaste", "pranam", "hey", "नमस्ते", "प्रणाम", "राम राम"]
    if clean_q in greetings:
        greeting_text = "नमस्ते किसान भाई! 🙏 बताइए, आज फसल या प्राकृतिक कृषि से संबंधित क्या सहायता चाहिए?" if req.language == "hi" else "Hello Farmer Friend! 🙏 How can I assist you with your farming, soil, or organic agriculture today?"
        return {
            "answer": greeting_text,
            "sources": [],
            "total_credits": total_credits,
            "max_pack_credits": profile.get("max_pack_credits", 1),
            "plan_type": plan_type
        }

    # Generate Embeddings & Retrieve Context from Supabase
    try:
        emb_res = client.models.embed_content(
            model="models/gemini-embedding-001",
            contents=user_query,
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        q_vec = emb_res.embeddings[0].values

        matches_res = supabase.rpc("match_tcbt_chunks", {
            "query_embedding": q_vec,
            "match_threshold": 0.40,
            "match_count": 3
        }).execute()
        matches = matches_res.data or []

        context_text = ""
        sources = []
        for m in matches:
            context_text += f"- Title: {m.get('title')}
  Vishay: {m.get('topic')}
  Summary: {m.get('summary')}

"
            sources.append({
                "title": m.get("topic") or m.get("title"),
                "duration": m.get("duration_label"),
                "summary": m.get("summary", ""),
                "video_url": f"https://www.youtube.com/watch?v={m['video_id']}&t={m['start_seconds']}s"
            })

        # Strict Language Instruction
        if req.language == "en":
            lang_instruction = "CRITICAL: The user has selected English. You MUST respond 100% in pure English only. Do NOT use any Hindi or Hinglish words."
        else:
            lang_instruction = "CRITICAL: The user has selected Hindi. You MUST respond 100% in pure, authentic Devnagari Hindi only. Do NOT use Roman English (Hinglish)."

        system_prompt = f"""You are Agri Mitra (कृषि मित्र), an authentic and expert agricultural advisor.
{lang_instruction}
Deliver practical, grounded, point-by-point advice in 3 to 4 clear bullet points matching the user's intent. Do not pad with unnecessary introductions.

Context from video transcript library:
{context_text}

User Query:
{user_query}
"""

        # Pro Internet Grounding Verification
        allow_web_search = (req.web_search_enabled and is_paid_active and plan_type == "pro")
        
        gen_config = types.GenerateContentConfig(temperature=0.2)
        if allow_web_search:
            # Enable Google Search grounding tool for Pro users
            gen_config.tools = [{"google_search": {}}]

        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=system_prompt,
            config=gen_config
        )
        answer_text = response.text

    except Exception as e:
        print(f"Chat execution error: {e}")
        # Zero credit loss on failure
        raise HTTPException(status_code=500, detail="उत्तर तैयार करने में तकनीकी समस्या आई। आपका कोई क्रेडिट नहीं काटा गया है।")

    # POST-SUCCESS CREDIT DEDUCTION ONLY
    new_balance = max(0, total_credits - credits_needed)
    
    # If user used up their last paid credit, auto-downgrade to free for next time
    updated_plan_type = plan_type
    if is_paid_active and new_balance == 0:
        updated_plan_type = "free"

    supabase.table("user_profiles").update({
        "total_credits": new_balance,
        "plan_type": updated_plan_type
    }).eq("id", req.user_id).execute()

    return {
        "answer": answer_text,
        "sources": sources,
        "total_credits": new_balance,
        "max_pack_credits": profile.get("max_pack_credits", 1),
        "plan_type": updated_plan_type
    }

# 2. Claim Welcome Offer (10 Credits / 10 Days)
@app.post("/api/claim-welcome")
@app.post("/claim-welcome")
async def claim_welcome_endpoint(req: ClaimWelcomeReq):
    user_res = supabase.table("user_profiles").select("*").eq("id", req.user_id).single().execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="खाता नहीं मिला।")
    
    user = user_res.data
    if user.get("is_trial_claimed") or user.get("plan_type") in ["basic", "pro"]:
        raise HTTPException(status_code=400, detail="आप पहले ही स्वागत क्रेडिट्स क्लेम कर चुके हैं।")

    settings = get_super_control_settings()
    credits_amt = settings.get("welcome_credits", 10)
    days_amt = settings.get("welcome_days", 10)

    now_utc = datetime.now(timezone.utc)
    expiry = (now_utc + timedelta(days=days_amt)).isoformat()

    supabase.table("user_profiles").update({
        "is_trial_claimed": True,
        "plan_type": "free",
        "total_credits": credits_amt,
        "max_pack_credits": credits_amt,
        "plan_expires_at": expiry
    }).eq("id", req.user_id).execute()

    return {"status": "success", "credits": credits_amt, "plan_expires_at": expiry}

# 3. Last 3 Months Payment History API
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

# 4. Universal Support API -> user_queries
@app.post("/api/request-approval")
@app.post("/request-approval")
async def support_endpoint(req: SupportReq):
    assigned_priority = req.priority
    if req.category == "payment" or req.user_plan == "pro":
        assigned_priority = "high"
    elif req.user_plan == "basic":
        assigned_priority = "medium"

    supabase.table("user_queries").insert({
        "user_id": req.user_id,
        "name": req.name,
        "email": req.email,
        "phone": req.phone,
        "concern": req.concern,
        "category": req.category,
        "priority": assigned_priority,
        "user_plan": req.user_plan
    }).execute()
    
    return {"status": "success", "priority": assigned_priority}

# 5. User Stats API with Auto-Sync for Daily 1 Free Credit
@app.get("/api/user-stats")
@app.get("/user-stats")
async def user_stats(user_id: str):
    res = supabase.table("user_profiles").select("*").eq("id", user_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    data = res.data

    # Daily 1 Free credit check & sync
    data = sync_daily_free_credit(data, user_id)

    settings = get_super_control_settings()

    plan_type = data.get("plan_type") or "free"
    plan_expires_at = data.get("plan_expires_at")
    total_credits = data.get("total_credits", 0)
    max_pack = data.get("max_pack_credits", 1)
    is_claimed = data.get("is_trial_claimed", False)

    is_paid_active = False
    now_utc = datetime.now(timezone.utc)
    if plan_type in ["basic", "pro"]:
        if plan_expires_at:
            try:
                exp_time = datetime.fromisoformat(plan_expires_at.replace("Z", "+00:00"))
                if now_utc <= exp_time and total_credits > 0:
                    is_paid_active = True
                else:
                    # Auto downgrade if expired
                    plan_type = "free"
                    supabase.table("user_profiles").update({"plan_type": "free"}).eq("id", user_id).execute()
            except Exception:
                plan_type = "free"
        else:
            plan_type = "free"

    return {
        "status": data.get("status", "pending"),
        "plan_type": plan_type,
        "total_credits": total_credits,
        "max_pack_credits": max_pack,
        "plan_expires_at": plan_expires_at,
        "is_paid_active": is_paid_active,
        "is_trial_claimed": is_claimed,
        "super_control": {
            "maintenance_mode": settings.get("maintenance_mode", False),
            "banner_enabled": settings.get("banner_enabled", False),
            "banner_text": settings.get("banner_text", ""),
            "welcome_credits": settings.get("welcome_credits", 10),
            "welcome_days": settings.get("welcome_days", 10),
            "welcome_enabled": settings.get("welcome_enabled", True)
        }
    }

# 6. Payment Order & Verify
@app.post("/api/create-order")
@app.post("/create-order")
async def create_order_endpoint(req: OrderReq):
    return process_order(req.user_id, req.plan_id, req.coupon_code, supabase)

@app.post("/api/verify-payment")
@app.post("/verify-payment")
async def verify_payment_endpoint(req: VerifyPaymentReq):
    return verify_and_credit(
        req.user_id, req.order_id, req.payment_id, req.signature, req.plan_id, req.coupon_code, supabase
    )
