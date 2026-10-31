import os
import time
import hmac
import hashlib
from datetime import date
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from google import genai
from google.genai import types
import razorpay

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

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "rzp_test_your_key_id")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "your_key_secret")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if (SUPABASE_URL and SUPABASE_KEY) else None
client: genai.Client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
rz_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

# In-memory IP Rate Limiter
rate_limit_records = {}

def apply_rate_limit(client_ip: str):
    now = time.time()
    if client_ip not in rate_limit_records:
        rate_limit_records[client_ip] = []
    
    day_window = now - 86400
    minute_window = now - 60
    
    recent = [t for t in rate_limit_records[client_ip] if t > day_window]
    rate_limit_records[client_ip] = recent
    minute_requests = [t for t in recent if t > minute_window]
    
    if len(minute_requests) >= 7:
        raise HTTPException(status_code=429, detail="Aapne 1 minute me query limit (7) cross kar di hai. Kripya 1 minute intzaar karein.")
    if len(recent) >= 100:
        raise HTTPException(status_code=429, detail="Daily rate limit cross ho chuki hai.")
    
    rate_limit_records[client_ip].append(now)

def get_system_prompt():
    p = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            return f.read().strip()
    return "Aap ek Krishi Sahayak hain. Devnagari Hindi me sankshipt aur satik uttar dein."

# Pydantic Schemas
class QueryReq(BaseModel):
    query: str
    user_id: str

class OrderReq(BaseModel):
    user_id: str
    plan_id: str # 'p5', 'p30', 'p50', 'p150'

class VerifyPaymentReq(BaseModel):
    user_id: str
    order_id: str
    payment_id: str
    signature: str
    plan_id: str

# 1. Chat API with Safe-Deduction Architecture
@app.post("/api/ask")
@app.post("/ask")
async def ask_endpoint(req: QueryReq, request: Request):
    client_ip = request.headers.get("x-forwarded-for", request.client.host or "127.0.0.1").split(",")[0].strip()
    apply_rate_limit(client_ip)

    if not req.user_id:
        raise HTTPException(status_code=401, detail="Kripya pehle Google se sign in karein.")

    # User Profile & Credit Validation
    user_res = supabase.table("user_profiles").select("*").eq("id", req.user_id).limit(1).execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="User account nahi mila.")
    
    profile = user_res.data[0]
    
    # Status Check
    if profile["status"] == "pending":
        raise HTTPException(status_code=403, detail="Aapka account abhi Admin Review (Pending) me hai. Approval milne ke baad aap chat kar payenge.")
    if profile["status"] == "banned":
        raise HTTPException(status_code=403, detail="Aapka account block kar diya gaya hai.")

    # Check / Reset Daily Quota
    today = date.today().isoformat()
    daily_used = profile["daily_credits_used"]
    if profile.get("last_reset_date") != today:
        daily_used = 0
        supabase.table("user_profiles").update({"daily_credits_used": 0, "last_reset_date": today}).eq("id", req.user_id).execute()

    # Available credits balance calculation
    daily_rem = max(0, profile["daily_credits_limit"] - daily_used)
    extra_rem = profile.get("extra_purchased_credits", 0)
    total_avail = daily_rem + extra_rem

    if total_avail <= 0:
        raise HTTPException(status_code=402, detail="Aapka aaj ka credit quota samapt ho gaya hai. Kripya naya pack buy karein ya kal ka intzaar karein.")

    # Vector Embedding & Matching
    user_query = req.query.strip()
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

        base_prompt = get_system_prompt()
        full_prompt = f"{base_prompt}\n\nSandarbh:\n{context_text}\n\nSawal: {user_query}\n\nUttar:"

        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=full_prompt,
            config=types.GenerateContentConfig(temperature=0.2)
        )
        answer_text = response.text

    except Exception as e:
        # Error aane par koi credit nahi katega
        print(f"Error occurred: {e}")
        raise HTTPException(status_code=500, detail="Uttar generate karne me dikkat aayi. Aapka koi credit nahi kata hai.")

    # Agar success hua, sirf tabhi credit deduct hoga
    if daily_rem > 0:
        supabase.table("user_profiles").update({"daily_credits_used": daily_used + 1}).eq("id", req.user_id).execute()
        new_avail = total_avail - 1
    else:
        supabase.table("user_profiles").update({"extra_purchased_credits": extra_rem - 1}).eq("id", req.user_id).execute()
        new_avail = total_avail - 1

    return {
        "answer": answer_text,
        "sources": sources,
        "remaining_credits": new_avail,
        "daily_limit": profile["daily_credits_limit"],
        "suggestions": ["प्राकृतिक खाद कैसे तैयार करें?", "3G कटिंग का क्या लाभ है?", "लागत शून्य करने का गणित"]
    }

# 2. Razorpay Order Creation
PLANS = {
    "p5": {"amount": 500, "credits": 5},     # 5 Rs -> 500 paise
    "p30": {"amount": 3000, "credits": 50},   # 30 Rs
    "p50": {"amount": 5000, "credits": 100},  # 50 Rs
    "p150": {"amount": 15000, "credits": 500} # 150 Rs
}

@app.post("/api/create-order")
async def create_order(req: OrderReq):
    if req.plan_id not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    plan = PLANS[req.plan_id]
    order_data = {
        "amount": plan["amount"],
        "currency": "INR",
        "receipt": f"rcpt_{req.user_id[:8]}_{int(time.time())}",
        "notes": {"user_id": req.user_id, "plan_id": req.plan_id}
    }
    order = rz_client.order.create(data=order_data)
    return {"order_id": order["id"], "amount": plan["amount"], "key_id": RAZORPAY_KEY_ID}

# 3. Razorpay Signature Verification & Credit Addition
@app.post("/api/verify-payment")
async def verify_payment(req: VerifyPaymentReq):
    msg = f"{req.order_id}|{req.payment_id}"
    generated_sig = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        msg.encode(),
        hashlib.sha256
    ).hexdigest()

    if generated_sig != req.signature:
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    plan = PLANS.get(req.plan_id, {"credits": 5, "amount": 500})
    credits_to_add = plan["credits"]

    # Add extra credits to user profile
    user_res = supabase.table("user_profiles").select("extra_purchased_credits").eq("id", req.user_id).single().execute()
    curr_credits = user_res.data.get("extra_purchased_credits", 0) if user_res.data else 0

    supabase.table("user_profiles").update({
        "extra_purchased_credits": curr_credits + credits_to_add
    }).eq("id", req.user_id).execute()

    # Log Transaction
    supabase.table("credit_transactions").insert({
        "user_id": req.user_id,
        "order_id": req.order_id,
        "payment_id": req.payment_id,
        "amount_paid": plan["amount"] / 100,
        "credits_added": credits_to_add,
        "status": "success"
    }).execute()

    return {"status": "success", "credits_added": credits_to_add, "new_total": curr_credits + credits_to_add}

@app.get("/api/user-stats")
async def user_stats(user_id: str):
    res = supabase.table("user_profiles").select("*").eq("id", user_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    data = res.data
    daily_rem = max(0, data["daily_credits_limit"] - data.get("daily_credits_used", 0))
    extra = data.get("extra_purchased_credits", 0)
    return {
        "status": data["status"],
        "daily_limit": data["daily_credits_limit"],
        "daily_used": data.get("daily_credits_used", 0),
        "extra_credits": extra,
        "total_available": daily_rem + extra
    }
