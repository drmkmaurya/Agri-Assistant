import os
import time
from datetime import date, datetime, timedelta
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

rate_limit_records = {}

def apply_rate_limit(client_ip: str):
    now = time.time()
    if client_ip not in rate_limit_records:
        rate_limit_records[client_ip] = []
    minute_window = now - 60
    recent = [t for t in rate_limit_records[client_ip] if t > minute_window]
    rate_limit_records[client_ip] = recent
    if len(recent) >= 7:
        raise HTTPException(status_code=429, detail="आपने 1 मिनट में सीमा पार कर दी है। कृपया 1 मिनट प्रतीक्षा करें।")
    rate_limit_records[client_ip].append(now)

class QueryReq(BaseModel):
    query: str
    user_id: str

class SupportReq(BaseModel):
    user_id: str
    name: str
    email: str
    phone: str
    concern: str = ""
    category: str = "general"
    priority: str = "normal"
    user_plan: str = "none"

class ClaimTrialReq(BaseModel):
    user_id: str

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

# 1. Chat API (Meta AI Adaptive Intent Handling)
@app.post("/api/ask")
@app.post("/ask")
async def ask_endpoint(req: QueryReq, request: Request):
    client_ip = request.headers.get("x-forwarded-for", request.client.host or "127.0.0.1").split(",")[0].strip()
    apply_rate_limit(client_ip)

    if not req.user_id:
        raise HTTPException(status_code=401, detail="कृपया पहले Google से साइन इन करें।")

    user_res = supabase.table("user_profiles").select("*").eq("id", req.user_id).limit(1).execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="खाता नहीं मिला।")
    
    profile = user_res.data[0]
    if profile.get("status") == "pending":
        raise HTTPException(status_code=403, detail="आपका खाता अभी समीक्षा (Pending) में है।")
    if profile.get("status") == "banned":
        raise HTTPException(status_code=403, detail="आपका खाता ब्लॉक कर दिया गया है।")

    # Expiry Check
    if profile.get("plan_expires_at"):
        exp = datetime.fromisoformat(profile["plan_expires_at"].replace("Z", "+00:00"))
        if datetime.now(exp.tzinfo) > exp:
            raise HTTPException(status_code=402, detail="आपका प्लान समाप्त हो चुका है। कृपया प्लान अपग्रेड करें।")

    daily_limit = profile.get("daily_credits_limit") or 0
    if daily_limit <= 0:
        raise HTTPException(status_code=402, detail="कोई सक्रिय प्लान नहीं है। कृपया 7-दिन का फ्री ट्रायल क्लेम करें।")

    # IST Date calculation
    today_ist = (datetime.utcnow() + timedelta(hours=5, minutes=30)).date().isoformat()
    daily_used = profile.get("daily_credits_used", 0)

    if profile.get("last_reset_date") != today_ist:
        daily_used = 0
        supabase.table("user_profiles").update({"daily_credits_used": 0, "last_reset_date": today_ist}).eq("id", req.user_id).execute()

    if daily_used >= daily_limit:
        raise HTTPException(status_code=402, detail=f"आज का दैनिक कोटा ({daily_limit} सवाल) समाप्त हो गया है।")

    user_query = req.query.strip()
    clean_q = user_query.lower()

    # Meta AI Simple Greeting Intent Handler
    greetings = ["hello", "hi", "namaste", "pranam", "hey", "नमस्ते", "प्रणाम", "राम राम"]
    if clean_q in greetings:
        return {
            "answer": "नमस्ते किसान भाई! 🙏 बताइए, आज फसल या प्राकृतिक खेती से संबंधित क्या जानकारी चाहिए?",
            "sources": [],
            "daily_limit": daily_limit,
            "daily_used": daily_used # Greeting par quota nahi katega
        }

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
            context_text += f"- Title: {m.get('title')}\n  Vishay: {m.get('topic')}\n  Summary: {m.get('summary')}\n\n"
            sources.append({
                "title": m.get("topic") or m.get("title"),
                "duration": m.get("duration_label"),
                "summary": m.get("summary", ""),
                "video_url": f"https://www.youtube.com/watch?v={m['video_id']}&t={m['start_seconds']}s"
            })

        system_prompt = f"""
        Aap ek Krishi Sahayak hain. Kisan ke sawal ka vyavharik, point-to-point aur spasht Devnagari Hindi me uttar dein.
        Bina puche atirikt bhashan na dein. Jitna pucha gaya hai, utna hi 3-4 kramik points me batayein.
        
        Sandarbh:
        {context_text}
        
        Sawal:
        {user_query}
        """

        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=system_prompt,
            config=types.GenerateContentConfig(temperature=0.2)
        )
        answer_text = response.text

    except Exception as e:
        print(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail="उत्तर तैयार करने में समस्या आई। कोई क्रेडिट नहीं काटा गया।")

    # Deduct credit only on successful response delivery
    supabase.table("user_profiles").update({"daily_credits_used": daily_used + 1}).eq("id", req.user_id).execute()

    return {
        "answer": answer_text,
        "sources": sources,
        "daily_limit": daily_limit,
        "daily_used": daily_used + 1
    }

# 2. Universal Support API -> public.user_queries
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

# 3. Claim 7 Days Free Trial (Strict IST Midnight Cutoff on 7th Day)
@app.post("/api/claim-trial")
@app.post("/claim-trial")
async def claim_trial(req: ClaimTrialReq):
    user_res = supabase.table("user_profiles").select("*").eq("id", req.user_id).single().execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="खाता नहीं मिला।")
    
    user = user_res.data
    if user.get("is_trial_claimed"):
        raise HTTPException(status_code=400, detail="आप पहले ही 7 दिन का फ्री ट्रायल ले चुके हैं।")

    # Activation day counts as Day 1. Expires exactly at 11:59:59 PM IST on Day 7 (18:29:59 UTC).
    now_utc = datetime.utcnow()
    trial_expiry = (now_utc + timedelta(days=6)).replace(hour=18, minute=29, second=59).isoformat() + "Z"

    supabase.table("user_profiles").update({
        "is_trial_claimed": True,
        "trial_claimed_at": now_utc.isoformat(),
        "plan_type": "basic",
        "daily_credits_limit": 15,
        "plan_expires_at": trial_expiry
    }).eq("id", req.user_id).execute()

    return {"status": "success", "daily_limit": 15, "plan_expires_at": trial_expiry}

# 4. User Stats API
@app.get("/api/user-stats")
@app.get("/user-stats")
async def user_stats(user_id: str):
    res = supabase.table("user_profiles").select("*").eq("id", user_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    data = res.data

    created_at_str = data.get("created_at")
    eligible_for_trial = False
    if created_at_str:
        created_time = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        if (datetime.now(created_time.tzinfo) - created_time).days <= 10:
            eligible_for_trial = True

    return {
        "status": data.get("status", "pending"),
        "plan_type": data.get("plan_type") or "none",
        "daily_limit": data.get("daily_credits_limit", 0),
        "daily_used": data.get("daily_credits_used", 0),
        "plan_expires_at": data.get("plan_expires_at"),
        "is_trial_claimed": data.get("is_trial_claimed", False),
        "eligible_for_trial": eligible_for_trial
    }

# 5. Payment Order & Verify
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
