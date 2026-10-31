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

def get_system_prompt():
    """Manual prompt control from external file or fallback"""
    paths_to_check = [
        os.path.join(os.path.dirname(__file__), "system_prompt.txt"),
        os.path.join(os.path.dirname(__file__), "..", "system_prompt.txt"),
        "system_prompt.txt"
    ]
    for p in paths_to_check:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read().strip()
                
    return """
    Aap ek Krishi Sahayak (Agri Assistant) hain.
    Sawal ka saral, vyavharik aur bullet points me sankshipt Devnagari Hindi me uttar dein.
    Keval diye gaye sandarbh (context) ke aadhar par hi uttar dein. Hinglish ya English ka upyog na karein.
    """

class QueryRequest(BaseModel):
    query: str

@app.post("/api/ask")
@app.post("/ask")
async def ask_assistant(req: QueryRequest, request: Request):
    if not supabase or not client:
        raise HTTPException(status_code=500, detail="Server keys missing. Vercel Environment Variables check karein.")

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
            "answer": "नमस्ते किसान भाई! आपके इस सवाल से संबंधित उपयुक्त जानकारी अभी डेटाबेस में उपलब्ध नहीं है। कृपया फसल या समस्या का नाम बदलकर पुनः पूछें।",
            "sources": [],
            "suggestions": ["3G कटिंग कैसे करें?", "जीवामृत बनाने की विधि", "प्राकृतिक कीट नियंत्रण"]
        }

    # 3. Context compilation & Rich Card Source Data
    context_text = ""
    sources = []
    for m in matches:
        context_text += f"- Video Chunks: ({m['duration_label']})\n  Vishay: {m['topic']}\n  Varanan: {m['summary']}\n\n"
        sources.append({
            "title": m.get("topic") or m.get("title"),
            "duration": m["duration_label"],
            "summary": m.get("summary", ""),
            "start_seconds": m["start_seconds"],
            "end_seconds": m["end_seconds"],
            "video_url": f"https://www.youtube.com/watch?v={m['video_id']}&t={m['start_seconds']}s"
        })

    # 4. Read Prompt & Call Gemini 3.1 Flash Lite
    base_prompt = get_system_prompt()
    full_prompt = f"""
    {base_prompt}
    
    Sandarbh (Context):
    {context_text}
    
    Kisan Ka Sawal:
    {user_query}
    
    Uttar (Strictly Devnagari Hindi me, sankshipt aur point-wise):
    """
    
    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=full_prompt,
        config=types.GenerateContentConfig(
            temperature=0.2
        )
    )

    return {
        "answer": response.text,
        "sources": sources,
        "suggestions": ["3G कटिंग का सही समय क्या है?", "जीवामृत प्रयोग की विधि क्या है?"]
    }
