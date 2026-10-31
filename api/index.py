import os
import time
from datetime import date, datetime, timedelta
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from google import genai
from google.genai import types

from api.payments import process_order, verify_and_credit

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

# Pydantic Models
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

# 1. Submit Fast Approval Contact Request
@app.post("/api/request-approval")
@app.post("/request-approval")
async def request_approval(req: ApprovalReq):
    res = supabase.table("approval_requests").insert({
        "user_id": req.user_id,
        "name": req.name,
        "email": req.email,
        "phone": req.phone,
        "concern": req.concern
    }).execute()
    return {"status": "success", "message": "Approval request received"}

# 2. Claim 7 Days Free Basic Trial
@app.post("/api/claim-trial")
@app.post("/claim-trial")
async def claim_trial(req: ClaimTrialReq):
    user_res = supabase.table("user_profiles").select("*").eq("id", req.user_id).single().execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    
    user = user_res.data
    if user.get("is_trial_claimed"):
        raise HTTPException(status_code=400, detail="आप पहले ही 7 दिन का फ्री ट्रायल ले चुके हैं।")

    # Set 7 Days Expiry
    now = datetime.utcnow()
    trial_expiry = (now + timedelta(days=7)).isoformat()

    supabase.table("user_profiles").update({
        "is_trial_claimed": True,
        "trial_claimed_at": now.isoformat(),
        "plan_type": "basic",
        "daily_credits_limit": 15,
        "plan_expires_at": trial_expiry
    }).eq("id", req.user_id).execute()

    return {"status": "success", "daily_limit": 15, "plan_expires_at": trial_expiry}

# 3. User Stats & Eligibility Check
@app.get("/api/user-stats")
@app.get("/user-stats")
async def user_stats(user_id: str):
    res = supabase.table("user_profiles").select("*").eq("id", user_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    data = res.data

    # Eligible for trial if created within last 10 days and not claimed yet
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

# 4. Chat Assistant
@app.post("/api/ask")
@app.post("/ask")
async def ask_endpoint(req: QueryReq, request: Request):
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
        raise HTTPException(status_code=402, detail=f"आज का दैनिक कोटा ({daily_limit} सवाल) समाप्त हो गया है। कल पुनः प्रयास करें या Pro प्लान में अपग्रेड करें।")

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
        raise HTTPException(status_code=500, detail="उत्तर तैयार करने में समस्या आई। कोई क्रेडिट नहीं काटा गया।")

    supabase.table("user_profiles").update({"daily_credits_used": daily_used + 1}).eq("id", req.user_id).execute()

    return {
        "answer": answer_text,
        "sources": sources,
        "daily_limit": daily_limit,
        "daily_used": daily_used + 1
    }

# 5. Payment APIs
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
