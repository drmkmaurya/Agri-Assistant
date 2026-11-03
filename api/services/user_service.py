import os
from datetime import datetime, timedelta, timezone
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
        "welcome_days": 30,
        "welcome_enabled": True
    }

def get_or_create_user_profile(user_id: str, email: str = "", name: str = "", avatar: str = "") -> dict:
    try:
        # Check by user_id
        res = supabase.table("user_profiles").select("*").eq("id", user_id).limit(1).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
        
        # Fallback check by email to prevent duplicate accounts
        if email:
            email_res = supabase.table("user_profiles").select("*").eq("email", email).limit(1).execute()
            if email_res.data and len(email_res.data) > 0:
                return email_res.data[0]
        
        now = datetime.now(timezone.utc)
        expiry_30_days = (now + timedelta(days=30)).isoformat()
        new_row = {
            "id": user_id,
            "email": email or "",
            "full_name": name or "किसान साथी",
            "avatar_url": avatar or "https://lh3.googleusercontent.com/a/default-user=s96-c",
            "plan_type": "free",
            "total_credits": 10,
            "status": "approved",
            "plan_expires_at": expiry_30_days
        }
        ins = supabase.table("user_profiles").insert(new_row).execute()
        if ins.data and len(ins.data) > 0:
            return ins.data[0]
    except Exception as e:
        print(f"get_or_create_user_profile error: {e}")
    
    return {
        "id": user_id,
        "email": email,
        "full_name": name or "किसान साथी",
        "plan_type": "free",
        "total_credits": 10,
        "status": "approved"
    }

def update_user_credits(user_id: str, new_balance: int, updated_plan_type: str):
    try:
        supabase.table("user_profiles").update({
            "total_credits": new_balance,
            "plan_type": updated_plan_type
        }).eq("id", user_id).execute()
    except Exception as e:
        print(f"Error updating user credits: {e}")
