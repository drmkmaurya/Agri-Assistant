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
        raise HTTPException(status_code=429, detail="Aapne 1 minute me limit cross kar di hai. Kripya 1 minute intzaar karein.")
    if len(recent) >= 100:
        raise HTTPException(status_code=429, detail="Aapki daily query limit poori ho gayi hai. Kal dobara koshish karein.")
    
    rate_limit_records[client_ip].append(now)

class QueryRequest(BaseModel):
    query: str

@app.post("/api/ask")
@app.post("/ask")
async def ask_assistant(req: QueryRequest, request: Request):
    if not supabase or not client:
        raise HTTPException(status_code=500, detail="Server keys missing. Vercel environment variables check karein.")

    client_ip = request.headers.get("x-forwarded-for", request.client.host or "127.0.0.1").split(",")[0].strip()
    check_rate_limit(client_ip)
    
    user_query = req.query.strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="Query khali nahi honi chahiye.")

    # 1. Vector Embedding (768 Dimensions)
    emb_res = client.models.embed_content(
        model="models/gemini-embedding-001",
        contents=user_query,
        config=types.EmbedContentConfig(output_dimensionality=768)
    )
    q_vec = emb_res.embeddings[0].values

    # 2. Supabase Search
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

    # 3. Direct, Fast & Crisp Prompt
    system_prompt = f"""
    Aap ek pramadit Krishi Sahayak hain. Kisan ke sawal ka uttar shuddh Devnagari Hindi me, saral, aur 3 se 4 chote bullet points me dein.
    Agar kisan labh ya munafey ke bare me puche, toh spasht batayein:
    - Lagat me bachat: Desi go-krupa rasayan se rasayanik khad-keetnashak ka kharcha lagbhag shunya hota hai.
    - Mitti ki gunwatta: 1-2 saal me mitti ki urvara shakti badhne se utpadan sthir hota hai.
    
    Sandarbh:
    {context_text}
    
    Kisan Ka Sawal:
    {user_query}
    
    Niyam:
    - Uttar jaldi, sankshep aur sidha ho (adhik lambi baatein na karein).
    - Bhasha 100% Hindi ho.
    """

    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=system_prompt,
        config=types.GenerateContentConfig(
            temperature=0.2
        )
    )

    return {
        "answer": response.text,
        "sources": sources,
        "suggestions": ["प्राकृतिक खाद कैसे तैयार करें?", "3G कटिंग का क्या लाभ है?", "लागत शून्य करने का गणित"]
    }
