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

    def public_dict(self) -> dict[str, Any]:
        return {
            "appName": self.app_name,
            "mineruBaseUrl": self.mineru_base_url,
            "uploadTimeoutSeconds": self.upload_timeout_seconds,
            "mathpixConfigured": bool(self.mathpix_app_id and self.mathpix_app_key),
            "ocrCorrectionConfigured": bool(self.ocr_correction_api_key and self.ocr_correction_model),
            "ocrCorrectionProvider": self.ocr_correction_provider,
        }


SETTINGS = Settings()
