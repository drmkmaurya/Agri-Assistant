import os
import re
from google import genai
from google.genai import types
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wvptpethggrslyeqsjdn.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if (SUPABASE_URL and SUPABASE_KEY) else None

def get_gemini_client():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return None
    try:
        return genai.Client(api_key=key)
    except Exception as e:
        print(f"Gemini client init error: {e}")
        return None

# Comprehensive Hindi and Hinglish agricultural dictionary to prevent false refusals
AGRI_KEYWORDS = [
    # Crops & Plants
    "kheti", "fasal", "mitti", "keet", "khad", "jeevamrut", "beej", "rog", "spray", "dhan", "gehun", 
    "chana", "sarson", "kisan", "krishi", "khet", "urja", "paudh", "organic", "neemastra", "brahmastra", 
    "fungus", "blight", "pashupalan", "gay", "goban", "gomutra", "sinchai", "crop", "pest", "soil",
    "fertilizer", "seed", "farming", "agriculture", "plant", "disease", "dairy", "cow", "harvest",
    "tamatar", "aloo", "mirch", "pyaj", "lahsun", "adrak", "gobhi", "baingan", "bhindi", "matar",
    "ganna", "kapas", "soyabean", "makka", "bajra", "dawa", "dawai", "keeda", "illi", "sundi",
    # Hindi Devnagari Terms
    "खेती", "फसल", "मिट्टी", "कीट", "खाद", "जीवामृत", "बीज", "रोग", "छिड़काव", "धान", "गेहूं", "चना",
    "सरसों", "किसान", "कृषि", "खेत", "ऊर्जा जल", "पौध", "जैविक", "नीमास्त्र", "ब्रह्मास्त्र", "फंगस",
    "झुलसा", "पशुपालन", "गाय", "गोबर", "गोमूत्र", "सिंचाई", "इल्ली", "सुंडी", "दीमक", "फल", "सब्जी",
    "टमाटर", "आलू", "मिर्च", "प्याज", "लहसुन", "अदरक", "गोभी", "बैंगन", "भिंडी", "मटर", "गन्ना",
    "कपास", "सोयाबीन", "मक्का", "बाजरा", "दवा", "दवाई", "कीड़ा", "पत्ती", "पत्ते", "पीला", "सूखा",
    "यूरिया", "डीएपी", "दशपर्णी", "अग्निहोत्र", "घनजीवामृत", "कटाई", "बुवाई", "खरपतवार", "जड़"
]

def is_agricultural_intent(query: str) -> bool:
    q = query.strip().lower()
    greetings = ["hello", "hi", "namaste", "pranam", "hey", "नमस्ते", "प्रणाम", "राम राम", "shukriya", "dhanyawad", "thank you", "thanks"]
    if q in greetings or len(q) < 3:
        return False
    return True

def is_within_agricultural_domain(query: str) -> bool:
    q = query.strip().lower()
    for kw in AGRI_KEYWORDS:
        if kw in q:
            return True
    return False

def generate_rag_answer(user_query: str, language: str = "hi", allow_web_search: bool = False, context_summary: str = "") -> tuple[str, list]:
    sources = []
    context_text = ""
    client = get_gemini_client()
    
    if not client:
        return "तकनीकी समस्या: AI सेवा अभी उपलब्ध नहीं है। कृपया कुछ समय बाद प्रयास करें।", []

    # 1. Strict Out-of-Domain Guardrail Check
    if is_agricultural_intent(user_query) and not is_within_agricultural_domain(user_query):
        # Allow short follow-ups only if context mentions agricultural topic
        if not context_summary or len(user_query) > 20:
            if language == "en":
                out_of_domain_reply = "I apologize, farmer friend. I am specifically designed to assist only with organic/natural agriculture, crop protection, soil health, and livestock questions. Please ask a farming-related query."
            else:
                out_of_domain_reply = "क्षमा करें किसान भाई, मैं केवल प्राकृतिक व जैविक कृषि, फसल सुरक्षा, मिट्टी की सेहत और पशुपालन संबंधी प्रश्नों में ही सहायता कर सकता हूँ। कृपया खेती-किसानी से जुड़ा कोई प्रश्न पूछें।"
            return out_of_domain_reply, []

    # 2. Vector RAG Embedding Search on Authentic TCBT Video Library
    if is_agricultural_intent(user_query) and supabase:
        try:
            emb_res = client.models.embed_content(
                model="models/gemini-embedding-001",
                contents=user_query,
                config=types.EmbedContentConfig(output_dimensionality=768)
            )
            if emb_res and emb_res.embeddings and len(emb_res.embeddings) > 0:
                q_vec = emb_res.embeddings[0].values

                matches_res = supabase.rpc("match_tcbt_chunks", {
                    "query_embedding": q_vec,
                    "match_threshold": 0.42,
                    "match_count": 3
                }).execute()
                matches = matches_res.data or []

                for m in matches:
                    context_text += f"- Title: {m.get('title')}\n  Vishay: {m.get('topic')}\n  Summary: {m.get('summary')}\n\n"
                    sources.append({
                        "title": m.get("topic") or m.get("title"),
                        "duration": m.get("duration_label"),
                        "summary": m.get("summary", ""),
                        "video_url": f"https://www.youtube.com/watch?v={m['video_id']}&t={m['start_seconds']}s"
                    })
        except Exception as e:
            print(f"RAG search warning: {e}")

    if language == "en":
        lang_instruction = "CRITICAL: The user has selected English. You MUST respond 100% in pure English only. Do NOT use any Hindi or Hinglish words."
    else:
        lang_instruction = "CRITICAL: The user has selected Hindi. You MUST respond 100% in pure, authentic Devnagari Hindi only. Do NOT use Roman English (Hinglish)."

    memory_prompt_part = f"\nUser Previous Context / Crop History:\n{context_summary}\n" if context_summary else ""

    system_prompt = f"""You are Agri Mitra (कृषि मित्र), an authentic and expert agricultural advisor specializing in organic, natural (Subhash Palekar Natural Farming/TCBT), and sustainable agriculture.
{lang_instruction}

STRICT DOMAIN POLICY:
If the user's question is completely unrelated to farming, agriculture, plants, soil, crops, livestock, organic solutions, or weather impact on farming, politely refuse by saying:
"क्षमा करें किसान भाई, मैं केवल प्राकृतिक व जैविक कृषि, फसल सुरक्षा और पशुपालन संबंधी प्रश्नों में ही सहायता कर सकता हूँ।"
Do not answer questions about politics, cinema, cricket, competitive exams, coding, or general gossip.

CONTENT DELIVERY:
- Deliver practical, grounded, point-by-point advice in 3 to 4 clear bullet points matching the user's agricultural intent.
- Do not pad with unnecessary introductions.
- Mention specific preparation dosages (e.g., in a 15L spray pump or per acre) and the right application time (e.g., evening hours).
{memory_prompt_part}
Context from video transcript library:
{context_text if context_text else 'No direct library context available. Give standard organic/natural agriculture principles.'}

User Query:
{user_query}
"""

    gen_config = types.GenerateContentConfig(temperature=0.2)
    if allow_web_search:
        gen_config.tools = [{"google_search": {}}]

    try:
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=system_prompt,
            config=gen_config
        )
        answer_text = response.text or "क्षमा करें, उत्तर प्राप्त नहीं हो सका। कृपया पुनः प्रयास करें।"
        return answer_text, sources
    except Exception as ge:
        print(f"Gemini generation error: {ge}")
        raise ge
