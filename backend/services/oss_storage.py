from __future__ import annotations

import json
import posixpath
from dataclasses import dataclass
from typing import Any, Callable

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
    _bucket: Any | None = None
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

    def list_keys(self, prefix: str = "", *, limit: int = 5000) -> list[str]:
        if not self.enabled or not self._bucket:
            return []
        keys: list[str] = []
        try:
            scan_prefix = str(prefix or "").strip().lstrip("/")
            for item in oss2.ObjectIterator(self._bucket, prefix=scan_prefix):
                keys.append(str(item.key))
                if len(keys) >= limit:
                    break
        except Exception as error:  # noqa: BLE001
            self.error = str(error)
        return keys

    def list_child_prefixes(self, prefix: str = "", *, limit: int = 500) -> list[str]:
        if not self.enabled or not self._bucket:
            return []
        prefixes: list[str] = []
        try:
            scan_prefix = str(prefix or "").strip().lstrip("/")
            result = self._bucket.list_objects(prefix=scan_prefix, delimiter="/", max_keys=limit)
            prefixes = [str(item) for item in getattr(result, "prefix_list", [])]
        except Exception as error:  # noqa: BLE001
            self.error = str(error)
        return prefixes[:limit]

    def list_book_index_keys(
        self,
        prefix: str = "",
        *,
        limit: int = 5000,
        progress: Callable[[int, int], None] | None = None,
    ) -> tuple[list[str], int]:
        entries, scanned = self.list_book_index_entries(prefix=prefix, limit=limit, progress=progress)
        return [entry["key"] for entry in entries], scanned

    def list_book_index_entries(
        self,
        prefix: str = "",
        *,
        limit: int = 5000,
        progress: Callable[[int, int], None] | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        if not self.enabled or not self._bucket:
            return [], 0
        entries: list[dict[str, Any]] = []
        scanned = 0
        try:
            scan_prefix = str(prefix or "").strip().lstrip("/")
            for item in oss2.ObjectIterator(self._bucket, prefix=scan_prefix):
                scanned += 1
                key = str(item.key)
                if _is_book_index_key(key):
                    entries.append(
                        {
                            "key": key,
                            "etag": str(getattr(item, "etag", "") or ""),
                            "lastModified": str(getattr(item, "last_modified", "") or ""),
                            "size": int(getattr(item, "size", 0) or 0),
                        }
                    )
                if progress and scanned % 1000 == 0:
                    progress(scanned, len(entries))
                if len(entries) >= limit:
                    break
        except Exception as error:  # noqa: BLE001
            self.error = str(error)
        return entries, scanned

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


def _is_book_index_key(key: str) -> bool:
    lower = str(key or "").lower()
    name = posixpath.basename(lower)
    if "/images/" in lower or "/image/" in lower:
        return False
    if name.endswith(".pdf"):
        return True
    if not name.endswith(".json"):
        return False
    return "middle" in name or ("content" in name and "list" in name)


OSS_STORAGE_SERVICE = OssStorageService(enabled=_oss_enabled_from_settings())
