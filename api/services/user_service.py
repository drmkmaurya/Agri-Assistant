import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wvptpethggrslyeqsjdn.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if (SUPABASE_URL and SUPABASE_KEY) else None

IST = ZoneInfo("Asia/Kolkata")

def get_super_control_settings() -> dict:
    try:
        res = supabase.table("app_settings").select("*").limit(1).execute()
        if res.data:
            return res.data[0]
    except Exception:
        pass
    return {
        "maintenance_mode": False,
        "banner_enabled": False,
        "banner_text": "",
        "welcome_credits": 10,
        "welcome_days": 10,
        "welcome_enabled": True
    }

def get_or_create_user_profile(user_id: str, email: str = "", name: str = "", avatar: str = "") -> dict:
    try:
        res = supabase.table("user_profiles").select("*").eq("id", user_id).limit(1).execute()
        if res.data:
            return res.data[0]
        
        today_ist_str = datetime.now(IST).strftime("%Y-%m-%d")
        new_row = {
            "id": user_id,
            "email": email or "",
            "full_name": name or "किसान साथी",
            "avatar_url": avatar or "https://lh3.googleusercontent.com/a/default-user=s96-c",
            "plan_type": "free",
            "total_credits": 1,
            "max_pack_credits": 1,
            "status": "approved",
            "is_trial_claimed": False,
            "last_free_credit_date": today_ist_str
        }
        ins = supabase.table("user_profiles").insert(new_row).execute()
        if ins.data:
            return ins.data[0]
    except Exception as e:
        print(f"get_or_create_user_profile fallback: {e}")
    
    return {
        "id": user_id,
        "email": email,
        "full_name": name or "किसान साथी",
        "plan_type": "free",
        "total_credits": 1,
        "max_pack_credits": 1,
        "status": "approved",
        "is_trial_claimed": False
    }

def sync_daily_free_credit(profile: dict, user_id: str) -> dict:
    today_ist_str = datetime.now(IST).strftime("%Y-%m-%d")
    plan_type = profile.get("plan_type") or "free"
    last_free_date = str(profile.get("last_free_credit_date") or "")

    if plan_type == "free" and last_free_date != today_ist_str:
        new_credits = 1
        try:
            supabase.table("user_profiles").update({
                "total_credits": new_credits,
                "max_pack_credits": 1,
                "last_free_credit_date": today_ist_str
            }).eq("id", user_id).execute()
        except Exception:
            pass
        profile["total_credits"] = new_credits
        profile["max_pack_credits"] = 1
        profile["last_free_credit_date"] = today_ist_str

    return profile

def update_user_credits(user_id: str, new_balance: int, updated_plan_type: str):
    try:
        supabase.table("user_profiles").update({
            "total_credits": new_balance,
            "plan_type": updated_plan_type
        }).eq("id", user_id).execute()
    except Exception as e:
        print(f"Error updating user credits: {e}")
