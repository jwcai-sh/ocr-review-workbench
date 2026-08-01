from __future__ import annotations

import json
import posixpath
import threading
import time
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
    max_get_retries: int = 3
    cache_ttl_seconds: float = 300.0
    _get_cache: dict[str, tuple[float, bytes]] | None = None
    _get_cache_lock: Any | None = None

    def __post_init__(self) -> None:
        self._bucket = None
        self.max_get_retries = max(1, int(getattr(SETTINGS, "oss_get_retries", self.max_get_retries)))
        self.cache_ttl_seconds = max(0.0, float(getattr(SETTINGS, "oss_cache_ttl_seconds", self.cache_ttl_seconds)))
        self._get_cache = {}
        self._get_cache_lock = threading.Lock()
        if not self.enabled:
            return
        if oss2 is None:
            self.enabled = False
            self.error = "oss2 is not installed"
            return
        try:
            auth = oss2.Auth(SETTINGS.oss_access_key_id, SETTINGS.oss_access_key_secret)
            self._bucket = oss2.Bucket(
                auth,
                SETTINGS.oss_endpoint_url,
                SETTINGS.oss_bucket,
                connect_timeout=max(1.0, float(getattr(SETTINGS, "oss_connect_timeout_seconds", 15))),
            )
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
        now = time.monotonic()
        with self._get_cache_lock:
            cached = self._get_cache.get(key) if self._get_cache is not None else None
            if cached and (self.cache_ttl_seconds <= 0 or cached[0] > now):
                return cached[1]
            if cached:
                self._get_cache.pop(key, None)
        last_error: Exception | None = None
        for attempt in range(self.max_get_retries):
            try:
                content = self._bucket.get_object(key).read()
                if self._get_cache is not None:
                    with self._get_cache_lock:
                        self._get_cache[key] = (time.monotonic() + self.cache_ttl_seconds, content)
                self.error = ""
                return content
            except Exception as error:  # noqa: BLE001
                last_error = error
                if attempt + 1 < self.max_get_retries:
                    time.sleep(min(0.5 * (2**attempt), 2.0))
        self.error = f"OSS object read failed after {self.max_get_retries} attempts: {last_error}"
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
