import os
import time
import hmac
import hashlib
from datetime import date, datetime, timedelta
from fastapi import FastAPI, HTTPException, Request
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
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if (SUPABASE_URL and SUPABASE_KEY) else None
client: genai.Client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
rz_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) else None

PLANS = {
    "basic": {"amount": 4900, "daily_limit": 15, "name": "Basic Plan (15 Sawal/Din)"},
    "pro": {"amount": 9900, "daily_limit": 50, "name": "Pro Plan (50 Sawal/Din)"}
}

rate_limit_records = {}

def apply_rate_limit(client_ip: str):
    now = time.time()
    if client_ip not in rate_limit_records:
        rate_limit_records[client_ip] = []
    minute_window = now - 60
    recent = [t for t in rate_limit_records[client_ip] if t > minute_window]
    rate_limit_records[client_ip] = recent
    if len(recent) >= 7:
        raise HTTPException(status_code=429, detail="आपने 1 मिनट में सीमा (7 सवाल) पार कर दी है। कृपया 1 मिनट प्रतीक्षा करें।")
    rate_limit_records[client_ip].append(now)

class QueryReq(BaseModel):
    query: str
    user_id: str

class ApprovalReq(BaseModel):
    user_id: str
    name: str
    email: str
    phone: str
    concern: str = ""

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

# 1. Chat API (Dual Routing for Vercel)
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

    today = date.today().isoformat()
    daily_used = profile.get("daily_credits_used", 0)
    daily_limit = profile.get("daily_credits_limit", 15)

    if profile.get("last_reset_date") != today:
        daily_used = 0
        supabase.table("user_profiles").update({"daily_credits_used": 0, "last_reset_date": today}).eq("id", req.user_id).execute()

    if daily_used >= daily_limit:
        raise HTTPException(status_code=402, detail=f"आज का दैनिक कोटा ({daily_limit} सवाल) समाप्त हो गया है।")

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

        system_prompt = f"""
        Aap ek Krishi Sahayak hain. Kisan ke sawal ka saral, vyavharik aur bullet points me Devnagari Hindi me uttar dein.
        Sandarbh:\n{context_text}\nSawal:\n{user_query}
        """

        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=system_prompt,
            config=types.GenerateContentConfig(temperature=0.2)
        )
        answer_text = response.text

    except Exception as e:
        raise HTTPException(status_code=500, detail="उत्तर तैयार करने में समस्या आई। कोई क्रेडिट नहीं काटा गया।")

    supabase.table("user_profiles").update({"daily_credits_used": daily_used + 1}).eq("id", req.user_id).execute()

    return {
        "answer": answer_text,
        "sources": sources,
        "daily_limit": daily_limit,
        "daily_used": daily_used + 1
    }

# 2. Payment APIs (Dual Routing)
@app.post("/api/create-order")
@app.post("/create-order")
async def create_order_endpoint(req: OrderReq):
    if req.plan_id not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan selected.")
        
    base_amount = PLANS[req.plan_id]["amount"]
    discount_pct = 0
    valid_code = None

    if req.coupon_code:
        code = req.coupon_code.strip().upper()
        c_res = supabase.table("coupons").select("*").eq("code", code).eq("is_active", True).execute()
        if c_res.data:
            c = c_res.data[0]
            if c["used_count"] < c["max_uses"] and req.plan_id in c.get("allowed_plans", []):
                discount_pct = c["discount_percent"]
                valid_code = code

    final_amount = int(base_amount * (1 - (discount_pct / 100)))

    if final_amount == 0:
        return {
            "order_id": f"free_{req.user_id[:8]}_{int(time.time())}",
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
        "receipt": f"rcpt_{req.user_id[:8]}",
        "notes": {"user_id": req.user_id, "plan_id": req.plan_id, "coupon": valid_code or ""}
    })

    return {
        "order_id": order["id"],
        "amount": final_amount,
        "is_free": False,
        "key_id": RAZORPAY_KEY_ID,
        "applied_coupon": valid_code
    }

@app.post("/api/verify-payment")
@app.post("/verify-payment")
async def verify_payment_endpoint(req: VerifyPaymentReq):
    plan = PLANS.get(req.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid plan.")

    new_daily_limit = plan["daily_limit"]

    if not req.order_id.startswith("free_"):
        msg = f"{req.order_id}|{req.payment_id}"
        expected_sig = hmac.new(
            RAZORPAY_KEY_SECRET.encode(),
            msg.encode(),
            hashlib.sha256
        ).hexdigest()
        if expected_sig != req.signature:
            raise HTTPException(status_code=400, detail="भुगतान सत्यापन विफल रहा।")

    new_expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
    supabase.table("user_profiles").update({
        "plan_type": req.plan_id,
        "daily_credits_limit": new_daily_limit,
        "plan_expires_at": new_expiry
    }).eq("id", req.user_id).execute()

    supabase.table("credit_transactions").insert({
        "user_id": req.user_id,
        "order_id": req.order_id,
        "payment_id": req.payment_id or "VIP_COUPON",
        "amount_paid": 0 if req.order_id.startswith("free_") else plan["amount"] / 100,
        "credits_added": new_daily_limit,
        "status": "success"
    }).execute()

    return {"status": "success", "daily_limit": new_daily_limit}

# 3. User Stats & Approval
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
        "plan_type": data.get("plan_type", "basic"),
        "daily_limit": data.get("daily_credits_limit", 15),
        "daily_used": data.get("daily_credits_used", 0),
        "is_trial_claimed": data.get("is_trial_claimed", False),
        "eligible_for_trial": eligible_for_trial
    }

@app.post("/api/request-approval")
@app.post("/request-approval")
async def request_approval(req: ApprovalReq):
    supabase.table("approval_requests").insert({
        "user_id": req.user_id,
        "name": req.name,
        "email": req.email,
        "phone": req.phone,
        "concern": req.concern
    }).execute()
    return {"status": "success"}

@app.post("/api/claim-trial")
@app.post("/claim-trial")
async def claim_trial(req: ClaimTrialReq):
    now = datetime.utcnow()
    trial_expiry = (now + timedelta(days=7)).isoformat()
    supabase.table("user_profiles").update({
        "is_trial_claimed": True,
        "trial_claimed_at": now.isoformat(),
        "plan_type": "basic",
        "daily_credits_limit": 15,
        "plan_expires_at": trial_expiry
    }).eq("id", req.user_id).execute()
    return {"status": "success", "daily_limit": 15}
