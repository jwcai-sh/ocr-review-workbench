from __future__ import annotations

import json
import posixpath
from dataclasses import dataclass
from typing import Any

from backend.config import SETTINGS

try:
    import oss2
except Exception:  # noqa: BLE001
    oss2 = None


def _clean_segment(value: str) -> str:
    segment = "".join(char if char.isalnum() or char in "._-" else "-" for char in str(value or "").strip())
    return segment.strip(".-_") or "unnamed"


def _join_key(*parts: str) -> str:
    cleaned = [_clean_segment(part) for part in parts if str(part or "").strip()]
    prefix = _clean_segment(SETTINGS.oss_prefix) if SETTINGS.oss_prefix else ""
    return posixpath.join(prefix, *cleaned) if prefix else posixpath.join(*cleaned)


@dataclass(slots=True)
class OssStorageService:
    enabled: bool
    error: str = ""

    def __post_init__(self) -> None:
        self._bucket = None
        if not self.enabled:
            return
        if oss2 is None:
            self.enabled = False
            self.error = "oss2 is not installed"
            return
        try:
            auth = oss2.Auth(SETTINGS.oss_access_key_id, SETTINGS.oss_access_key_secret)
            self._bucket = oss2.Bucket(auth, SETTINGS.oss_endpoint_url, SETTINGS.oss_bucket)
        except Exception as error:  # noqa: BLE001
            self.enabled = False
            self.error = str(error)

    def put_bytes(self, key: str, content: bytes, *, content_type: str = "application/octet-stream") -> bool:
        if not self.enabled or not self._bucket or not key:
            return False
        try:
            self._bucket.put_object(key, content, headers={"Content-Type": content_type})
            return True
        except Exception as error:  # noqa: BLE001
            self.error = str(error)
            return False

    def get_bytes(self, key: str) -> bytes | None:
        if not self.enabled or not self._bucket or not key:
            return None
        try:
            return self._bucket.get_object(key).read()
        except Exception as error:  # noqa: BLE001
            self.error = str(error)
            return None

    def put_json(self, key: str, payload: dict[str, Any]) -> bool:
        return self.put_bytes(
            key,
            json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
            content_type="application/json; charset=utf-8",
        )

    def get_json(self, key: str) -> dict[str, Any] | None:
        content = self.get_bytes(key)
        if not content:
            return None
        try:
            payload = json.loads(content.decode("utf-8"))
            return payload if isinstance(payload, dict) else None
        except Exception as error:  # noqa: BLE001
            self.error = str(error)
            return None

    def document_key(self, document_id: str, name: str) -> str:
        return _join_key("uploads", document_id, name or "upload")

    def page_image_key(self, document_id: str, page_number: int) -> str:
        return _join_key("uploads", document_id, "pages", f"page-{int(page_number):04d}.png")

    def workspace_key(self, workspace_id: str) -> str:
        return _join_key("workspace", f"{_clean_segment(workspace_id)}.json")


def _oss_enabled_from_settings() -> bool:
    return bool(
        SETTINGS.oss_access_key_id
        and SETTINGS.oss_access_key_secret
        and SETTINGS.oss_bucket
        and SETTINGS.oss_endpoint_url
    )


OSS_STORAGE_SERVICE = OssStorageService(enabled=_oss_enabled_from_settings())
