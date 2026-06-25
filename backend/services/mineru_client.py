from __future__ import annotations

from typing import Any

from backend.config import SETTINGS
from backend.services.http_json import safe_post_json


class MineruClient:
    def convert_markdown(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{SETTINGS.mineru_base_url}{SETTINGS.mineru_convert_path}"
        data, error = safe_post_json(url, payload, SETTINGS.request_timeout_seconds)
        if error:
            return {"ok": False, "error": error, "url": url}
        return {"ok": True, "url": url, "result": data or {}}


MINERU_CLIENT = MineruClient()

