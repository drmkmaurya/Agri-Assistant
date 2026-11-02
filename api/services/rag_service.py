import os
from google import genai
from google.genai import types
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wvptpethggrslyeqsjdn.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if (SUPABASE_URL and SUPABASE_KEY) else None
client: genai.Client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

def generate_rag_answer(user_query: str, language: str = "hi", allow_web_search: bool = False) -> tuple[str, list]:
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

    if language == "en":
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

    gen_config = types.GenerateContentConfig(temperature=0.2)
    if allow_web_search:
        gen_config.tools = [{"google_search": {}}]

    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=system_prompt,
        config=gen_config
    )
    return response.text, sources
