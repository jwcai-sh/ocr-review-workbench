from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _load_local_env() -> None:
    env_path = os.path.join(ROOT_DIR, ".env")
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key:
                os.environ.setdefault(key, value)


_load_local_env()


def mathpix_credentials_error(app_id: str, app_key: str) -> str:
    app_id = str(app_id or "").strip()
    app_key = str(app_key or "").strip()
    if not app_id or not app_key:
        return "未配置 MATHPIX_APP_ID/MATHPIX_APP_KEY。"

    combined = "\n".join([app_id, app_key])
    lowered = combined.lower()
    placeholder_markers = ("你的", "your_", "your-", "replace", "changeme", "todo")
    if any(marker in lowered for marker in placeholder_markers):
        return "MATHPIX_APP_ID/MATHPIX_APP_KEY 仍是占位符，请替换为真实 Mathpix 凭据。"
    if not combined.isascii():
        return "MATHPIX_APP_ID/MATHPIX_APP_KEY 只能包含 ASCII 字符，请检查是否粘贴了中文或其他非英文字符。"
    return ""


@dataclass(slots=True)
class Settings:
    host: str = os.getenv("APP_HOST", "127.0.0.1")
    port: int = int(os.getenv("APP_PORT", os.getenv("PORT", "8787")))
    app_name: str = os.getenv("APP_NAME", "OCR Review Workbench")
    mineru_base_url: str = os.getenv("MINERU_BASE_URL", "https://mineryou.cpolar.top").rstrip("/")
    mineru_convert_path: str = os.getenv("MINERU_CONVERT_PATH", "/api/convert")
    request_timeout_seconds: float = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "25"))
    upload_timeout_seconds: float = float(os.getenv("UPLOAD_TIMEOUT_SECONDS", "180"))

    mathpix_api_url: str = os.getenv("MATHPIX_API_URL", "https://api.mathpix.com/v3/text").rstrip("/")
    mathpix_app_id: str = os.getenv("MATHPIX_APP_ID", "")
    mathpix_app_key: str = os.getenv("MATHPIX_APP_KEY", "")
    mathpix_model: str = os.getenv("MATHPIX_MODEL", "mathpix-text")
    mathpix_timeout_seconds: float = float(os.getenv("MATHPIX_TIMEOUT_SECONDS", "60"))

    ocr_correction_provider: str = os.getenv("OCR_CORRECTION_PROVIDER", "openai-compatible")
    ocr_correction_base_url: str = os.getenv("OCR_CORRECTION_BASE_URL", os.getenv("LLM_BASE_URL", "")).rstrip("/")
    ocr_correction_api_key: str = os.getenv("OCR_CORRECTION_API_KEY", os.getenv("LLM_API_KEY", ""))
    ocr_correction_model: str = os.getenv("OCR_CORRECTION_MODEL", os.getenv("LLM_MODEL", ""))
    ocr_correction_path: str = os.getenv("OCR_CORRECTION_PATH", "/v1/chat/completions")
    ocr_correction_timeout_seconds: float = float(os.getenv("OCR_CORRECTION_TIMEOUT_SECONDS", "90"))
    ocr_correction_max_candidates: int = int(os.getenv("OCR_CORRECTION_MAX_CANDIDATES", "12"))
    ocr_correction_max_output_tokens: int = int(os.getenv("OCR_CORRECTION_MAX_OUTPUT_TOKENS", "2048"))

    yunwu_api_base_url: str = os.getenv("YUNWU_API_BASE_URL", "").rstrip("/")
    yunwu_api_key: str = os.getenv("YUNWU_API_KEY", "")
    yunwu_gpt55_model: str = os.getenv("YUNWU_GPT55_MODEL", "gpt-5.5")
    yunwu_chat_path: str = os.getenv("YUNWU_CHAT_PATH", "/v1/chat/completions")

    oss_access_key_id: str = os.getenv("OSS_ACCESS_KEY_ID", "")
    oss_access_key_secret: str = os.getenv("OSS_ACCESS_KEY_SECRET", "")
    oss_bucket: str = os.getenv("OSS_BUCKET", "")
    oss_region: str = os.getenv("OSS_REGION", "")
    oss_endpoint: str = os.getenv("OSS_ENDPOINT", "")
    oss_prefix: str = os.getenv("OSS_PREFIX", "books")
    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(ROOT_DIR, 'data', 'ocr_workbench.db')}")
    app_users: str = os.getenv("APP_USERS", "傲,门,白,丹")
    app_admin_user_id: str = os.getenv("APP_ADMIN_USER_ID", "门")
    app_admin_user_ids: str = os.getenv("APP_ADMIN_USER_IDS", "")
    session_secret: str = os.getenv("SESSION_SECRET", "ocr-review-workbench-local-session")

    @property
    def oss_endpoint_url(self) -> str:
        endpoint = self.oss_endpoint.strip()
        if not endpoint:
            return ""
        return endpoint if endpoint.startswith(("http://", "https://")) else f"https://{endpoint}"

    @property
    def oss_configured(self) -> bool:
        return bool(self.oss_access_key_id and self.oss_access_key_secret and self.oss_bucket and self.oss_endpoint_url)

    @property
    def mathpix_config_error(self) -> str:
        return mathpix_credentials_error(self.mathpix_app_id, self.mathpix_app_key)

    @property
    def mathpix_configured(self) -> bool:
        return not self.mathpix_config_error

    def public_dict(self) -> dict[str, Any]:
        return {
            "appName": self.app_name,
            "mineruBaseUrl": self.mineru_base_url,
            "uploadTimeoutSeconds": self.upload_timeout_seconds,
            "mathpixConfigured": self.mathpix_configured,
            "mathpixConfigError": self.mathpix_config_error or None,
            "ocrCorrectionConfigured": bool(self.ocr_correction_api_key and self.ocr_correction_model),
            "ocrCorrectionProvider": self.ocr_correction_provider,
            "ossConfigured": self.oss_configured,
            "ossBucket": self.oss_bucket or None,
            "ossPrefix": self.oss_prefix or None,
            "databaseConfigured": bool(self.database_url),
        }

    @property
    def auth_users(self) -> list[dict[str, str]]:
        users = []
        for raw_item in self.app_users.split(","):
            item = raw_item.strip()
            if not item:
                continue
            if ":" in item:
                user_id, name = item.split(":", 1)
            else:
                user_id, name = item, item
            user_id = user_id.strip()
            name = name.strip() or user_id
            if user_id:
                users.append({"id": user_id, "name": name})
        return users or [{"id": name, "name": name} for name in ("傲", "门", "白", "丹")]

    @property
    def admin_user_ids(self) -> list[str]:
        candidates = [self.app_admin_user_id]
        candidates.extend(self.app_admin_user_ids.split(","))
        admins = []
        seen = set()
        for raw_item in candidates:
            user_id = str(raw_item or "").strip()
            if user_id and user_id not in seen:
                seen.add(user_id)
                admins.append(user_id)
        return admins or ["门"]

    def is_admin_user(self, user_id: str) -> bool:
        return str(user_id or "").strip() in set(self.admin_user_ids)

    def login_password_for(self, user_id: str) -> str:
        user_id = str(user_id or "").strip()
        env_suffix_map = {
            "傲": "AO",
            "门": "MEN",
            "白": "BAI",
            "丹": "DAN",
        }
        suffix = env_suffix_map.get(user_id, user_id.upper().replace("-", "_"))
        return os.getenv(f"APP_LOGIN_PASSWORD_{suffix}", user_id)


SETTINGS = Settings()
