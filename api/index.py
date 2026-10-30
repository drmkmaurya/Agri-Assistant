import os
import time
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from google import genai
from google.genai import types

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

supabase: Client = None
client: genai.Client = None

if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
if GEMINI_API_KEY:
    client = genai.Client(api_key=GEMINI_API_KEY)

# Rate Limiter: Per Minute Max 7, Daily Max 100
rate_limit_records = {}

def check_rate_limit(client_ip: str):
    now = time.time()
    if client_ip not in rate_limit_records:
        rate_limit_records[client_ip] = []
    
    day_window = now - 86400
    minute_window = now - 60
    
    recent = [t for t in rate_limit_records[client_ip] if t > day_window]
    rate_limit_records[client_ip] = recent
    
    minute_requests = [t for t in recent if t > minute_window]
    
    if len(minute_requests) >= 7:
        raise HTTPException(status_code=429, detail="Aapne ek minute me query limit (7) cross kar di hai. Kripya 1 minute wait karein.")
    if len(recent) >= 100:
        raise HTTPException(status_code=429, detail="Aapki daily query limit (100) poori ho gayi hai. Kal dobara koshish karein.")
    
    rate_limit_records[client_ip].append(now)

class QueryRequest(BaseModel):
    query: str

# Dono routes bind kiye gaye hain taaki Vercel path issue na kare
@app.post("/api/ask")
@app.post("/ask")
async def ask_assistant(req: QueryRequest, request: Request):
    if not supabase or not client:
        raise HTTPException(status_code=500, detail="Server keys missing. Kripya Vercel Environment Variables check karein.")

    client_ip = request.headers.get("x-forwarded-for", request.client.host or "127.0.0.1").split(",")[0].strip()
    check_rate_limit(client_ip)
    
    user_query = req.query.strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="Query empty nahi honi chahiye.")

    # 1. 768-Dimension Query Vector
    emb_res = client.models.embed_content(
        model="models/gemini-embedding-001",
        contents=user_query,
        config=types.EmbedContentConfig(output_dimensionality=768)
    )
    q_vec = emb_res.embeddings[0].values

    # 2. Supabase Match
    matches_res = supabase.rpc("match_tcbt_chunks", {
        "query_embedding": q_vec,
        "match_threshold": 0.45,
        "match_count": 3
    }).execute()
    
    matches = matches_res.data or []
    if not matches:
        return {
            "answer": "नमस्ते! आपके इस सवाल से संबंधित स्पष्ट जानकारी अभी TCBT वीडियो लाइब्रेरी में नहीं मिली। क्या आप फसल या विषय का नाम बदल कर पूछना चाहेंगे?",
            "sources": [],
            "suggestions": ["पंच महाभूत कृषि क्या है?", "3G कटिंग कैसे करें?", "जीवामृत बनाने की विधि"]
        }

    # 3. Context compilation
    context_text = ""
    sources = []
    for m in matches:
        context_text += f"- Video: {m['title']} ({m['duration_label']})\n  Vishay: {m['topic']}\n  Detail: {m['summary']}\n\n"
        sources.append({
            "title": m["title"],
            "duration": m["duration_label"],
            "start_seconds": m["start_seconds"],
            "end_seconds": m["end_seconds"],
            "video_url": f"https://www.youtube.com/watch?v={m['video_id']}&t={m['start_seconds']}s"
        })

    # 4. Gemini 3.1 Flash Lite Response Polish
    system_prompt = f"""
    Aap Tarachand Belji ji ke TCBT (Panch Mahabhut Krishi) ke kisan sahayak hain.
    Neeche diye gaye video context ke aadhar par kisan ke sawal ka vyavharik, aadarpoorvak aur point-by-point Hindi me uttar dein.
    
    Context:
    {context_text}
    
    Sawal: {user_query}
    
    Niyam:
    - Bhasha bilkul saral aur kisan bhaiyon ke samajh aane yogya ho.
    - Important points ko bold (**) karein.
    - Ant me 1 ya 2 chote follow-up sawal sujhayen jo kisan puch sakte hain.
    """
    
    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=system_prompt
    )

    return {
        "answer": response.text,
        "sources": sources,
        "suggestions": ["3G कटिंग का सही समय क्या है?", "पंच महाभूत से मिट्टी कैसे सुधरेगी?"]
    }
