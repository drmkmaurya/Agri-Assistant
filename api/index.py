import os
import time
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Local development me .env load karega, Vercel me automatically system env use karega
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Environment Variables se keys uthayenge
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY or not GEMINI_API_KEY:
    raise RuntimeError("Missing Environment Variables: Check SUPABASE_URL, SUPABASE_KEY, GEMINI_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
client = genai.Client(api_key=GEMINI_API_KEY)

# Rate Limiter: Per Minute Max 7, Daily Max 100
rate_limit_records = {}

def check_rate_limit(client_ip: str):
    now = time.time()
    if client_ip not in rate_limit_records:
        rate_limit_records[client_ip] = []
    
    day_window = now - 86400
    minute_window = now - 60
    
    recent_requests = [t for t in rate_limit_records[client_ip] if t > day_window]
    rate_limit_records[client_ip] = recent_requests
    
    minute_requests = [t for t in recent_requests if t > minute_window]
    
    if len(minute_requests) >= 7:
        raise HTTPException(
            status_code=429, 
            detail="Aapne ek minute me request limit cross kar di hai. Kripya 1 minute intzaar karein."
        )
    if len(recent_requests) >= 100:
        raise HTTPException(
            status_code=429, 
            detail="Aapki daily query limit (100) poori ho gayi hai. Kal dobara koshish karein."
        )
    
    rate_limit_records[client_ip].append(now)

class QueryRequest(BaseModel):
    query: str

@app.post("/api/ask")
async def ask_assistant(req: QueryRequest, request: Request):
    client_ip = request.client.host or "127.0.0.1"
    check_rate_limit(client_ip)
    
    user_query = req.query.strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="Query empty nahi honi chahiye.")

    # 1. 768-Dimension Query Vector Embedding
    emb_res = client.models.embed_content(
        model="models/gemini-embedding-001",
        contents=user_query,
        config=types.EmbedContentConfig(output_dimensionality=768)
    )
    q_vec = emb_res.embeddings[0].values

    # 2. Supabase Match Query
    matches_res = supabase.rpc("match_tcbt_chunks", {
        "query_embedding": q_vec,
        "match_threshold": 0.50,
        "match_count": 3
    }).execute()
    
    matches = matches_res.data or []
    if not matches:
        return {
            "answer": "Maaf kijiye, is vishay par TCBT channel se match karta hua koi video chunk nahi mila. Kripya thoda alag shabdon me sawal puchhein.",
            "sources": []
        }

    # 3. Context compilation
    context_text = ""
    sources = []
    for m in matches:
        context_text += f"- Video: {m['title']} (Time: {m['duration_label']})\n  Vishay: {m['topic']}\n  Detail: {m['summary']}\n\n"
        sources.append({
            "title": m["title"],
            "duration": m["duration_label"],
            "start_seconds": m["start_seconds"],
            "end_seconds": m["end_seconds"],
            "video_url": f"https://www.youtube.com/watch?v={m['video_id']}&t={m['start_seconds']}s"
        })

    # 4. Gemini 3.1 Flash Lite Final Response Generation
    system_prompt = f"""
    Aap Tarachand Belji ji ke TCBT (Panch Mahabhut Krishi) ke kisan sahayak hain.
    Neeche diye gaye video context ke aadhar par kisan ke sawal ka saral, aadarpoorvak aur spasht Hindi me uttar dein:
    
    Context:
    {context_text}
    
    Sawal: {user_query}
    
    Niyam:
    - Jawaab sidha aur vyavharik ho.
    - Context se bahar ki baatein add na karein.
    """
    
    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=system_prompt
    )

    return {
        "answer": response.text,
        "sources": sources
    }
