from __future__ import annotations

import base64
import io
import re
import threading
import time
import uuid
from typing import Any

import fitz
from PIL import Image

from backend.services.oss_storage import OSS_STORAGE_SERVICE


def _parse_data_url(data_url: str) -> tuple[str, bytes] | None:
    match = re.match(r"^data:([^;,]+);base64,(.+)$", data_url, flags=re.DOTALL)
    if not match:
        return None
    return match.group(1), base64.b64decode(match.group(2))


def _data_url(mime_type: str, content: bytes) -> str:
    return f"data:{mime_type};base64,{base64.b64encode(content).decode('ascii')}"


def _image_page(mime_type: str, content: bytes, name: str) -> dict[str, Any]:
    try:
        image = Image.open(io.BytesIO(content))
        width, height = image.size
    except Exception:  # noqa: BLE001
        width = None
        height = None
    return {
        "pageNumber": 1,
        "name": name,
        "mimeType": mime_type,
        "width": width,
        "height": height,
        "image": _data_url(mime_type, content),
    }


def _pdf_text_blocks(page: fitz.Page) -> list[dict[str, Any]]:
    text_blocks: list[dict[str, Any]] = []
    try:
        raw = page.get_text("dict")
    except Exception:  # noqa: BLE001
        return text_blocks
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        spans: list[str] = []
        for line in block.get("lines", []):
            line_text = "".join(str(span.get("text") or "") for span in line.get("spans", []))
            if line_text.strip():
                spans.append(line_text.strip())
        text = " ".join(spans).strip()
        bbox = block.get("bbox")
        if not text or not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        text_blocks.append(
            {
                "text": text,
                "bbox": [float(value) for value in bbox],
            }
        )
    return text_blocks


def _pdf_pages(
    content: bytes,
    page_number: int | None,
    max_pages: int,
    zoom: float,
    *,
    include_text: bool = False,
    render_images: bool = True,
) -> tuple[list[dict[str, Any]], int]:
    pages: list[dict[str, Any]] = []
    with fitz.open(stream=content, filetype="pdf") as document:
        total_pages = len(document)
        if page_number is not None:
            start = max(0, min(page_number - 1, total_pages - 1))
            end = min(start + 1, total_pages)
        else:
            start = 0
            end = min(total_pages, max_pages)
        matrix = fitz.Matrix(zoom, zoom)
        for index in range(start, end):
            page = document.load_page(index)
            page_data: dict[str, Any] = {
                "pageNumber": index + 1,
                "name": f"page-{index + 1}.png",
                "mimeType": "image/png",
                "width": float(page.rect.width),
                "height": float(page.rect.height),
            }
            if render_images:
                pixmap = page.get_pixmap(matrix=matrix, alpha=False)
                png = pixmap.tobytes("png")
                page_data.update(
                    {
                        "width": pixmap.width,
                        "height": pixmap.height,
                        "image": _data_url("image/png", png),
                    }
                )
            if include_text:
                page_data["textBlocks"] = _pdf_text_blocks(page)
                page_data["textPageSize"] = [float(page.rect.width), float(page.rect.height)]
            pages.append(page_data)
    return pages, total_pages


class OcrPreviewService:
    def __init__(self) -> None:
        self._documents: dict[str, dict[str, Any]] = {}
        self._uploads: dict[str, dict[str, Any]] = {}
        self._page_cache: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def preview_pages(self, payload: dict[str, Any]) -> dict[str, Any]:
        document_id = str(payload.get("documentId") or "").strip()
        document = self._document_for_payload(document_id, payload)
        if not document:
            return {"ok": False, "error": "Missing valid dataUrl"}

        document_id = document["id"]
        mime_type = document["mimeType"]
        content = document["content"]
        name = str(payload.get("name") or document.get("name") or "upload").strip() or "upload"
        render_images = payload.get("renderImages") is not False
        include_text = bool(payload.get("includeText"))
        max_page_cap = 50 if render_images else 500
        max_pages = max(1, min(int(payload.get("maxPages") or 20), max_page_cap))
        zoom = max(1.0, min(float(payload.get("zoom") or 1.8), 3.0))
        page_number = int(payload["pageNumber"]) if payload.get("pageNumber") else None
        cache_key = self._page_cache_key(
            document_id=document_id,
            page_number=page_number,
            max_pages=max_pages,
            zoom=zoom,
            include_text=include_text,
            render_images=render_images,
        )
        if cache_key:
            cached = self._get_cached_page_preview(cache_key)
            if cached:
                return cached

        try:
            if mime_type == "application/pdf" or name.lower().endswith(".pdf"):
                pages, total_pages = _pdf_pages(
                    content,
                    page_number=page_number,
                    max_pages=max_pages,
                    zoom=zoom,
                    include_text=include_text,
                    render_images=render_images,
                )
            elif mime_type.startswith("image/"):
                pages = [_image_page(mime_type, content, name)]
                total_pages = 1
            else:
                return {"ok": False, "error": f"Unsupported file type: {mime_type}"}
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "error": str(error)}

        if OSS_STORAGE_SERVICE.enabled and document.get("persistRenderedPages") is not False:
            self._persist_rendered_pages(document_id, pages)

        result = {
            "ok": True,
            "documentId": document_id,
            "name": name,
            "mimeType": mime_type,
            "pages": pages,
            "pageCount": total_pages,
            "renderedCount": len(pages),
        }
        if cache_key:
            self._set_cached_page_preview(cache_key, result)
        return result

    def upload_document(self, *, content: bytes, mime_type: str, name: str) -> dict[str, Any]:
        if not content:
            return {"ok": False, "error": "Missing upload body"}
        document = self._store_document(
            mime_type=mime_type or "application/octet-stream",
            content=content,
            name=name or "upload",
        )
        return {
            "ok": True,
            "documentId": document["id"],
            "name": document["name"],
            "mimeType": document["mimeType"],
            "pageCount": self._document_page_count(document),
        }

    def load_document_bytes(
        self,
        *,
        content: bytes,
        mime_type: str,
        name: str,
        oss_key: str = "",
        persist_to_oss: bool = False,
    ) -> dict[str, Any]:
        if not content:
            return {"ok": False, "error": "Missing document body"}
        document = self._store_document(
            mime_type=mime_type or "application/octet-stream",
            content=content,
            name=name or "upload",
            oss_key=oss_key,
            persist_to_oss=persist_to_oss,
        )
        return {
            "ok": True,
            "documentId": document["id"],
            "name": document["name"],
            "mimeType": document["mimeType"],
            "pageCount": self._document_page_count(document),
            "ossKey": document.get("ossKey") or "",
        }

    def load_document_reference(
        self,
        *,
        mime_type: str,
        name: str,
        oss_key: str,
        page_count: int = 0,
    ) -> dict[str, Any]:
        if not oss_key:
            return {"ok": False, "error": "Missing OSS document key"}
        document = self._store_document(
            mime_type=mime_type or "application/pdf",
            content=b"",
            name=name or "origin.pdf",
            oss_key=oss_key,
            persist_to_oss=False,
            page_count=page_count,
            persist_rendered_pages=False,
        )
        return {
            "ok": True,
            "documentId": document["id"],
            "name": document["name"],
            "mimeType": document["mimeType"],
            "pageCount": self._document_page_count(document),
            "ossKey": document.get("ossKey") or "",
            "deferred": True,
        }

    def upload_document_chunk(
        self,
        *,
        upload_id: str,
        chunk_index: int,
        chunk_count: int,
        content: bytes,
        mime_type: str,
        name: str,
    ) -> dict[str, Any]:
        if not upload_id:
            return {"ok": False, "error": "Missing upload id"}
        if chunk_count <= 0 or chunk_index < 0 or chunk_index >= chunk_count:
            return {"ok": False, "error": "Invalid upload chunk"}
        if not content:
            return {"ok": False, "error": "Missing upload chunk body"}

        self._prune_uploads()
        with self._lock:
            upload = self._uploads.setdefault(
                upload_id,
                {
                    "chunkCount": chunk_count,
                    "chunks": {},
                    "mimeType": mime_type or "application/octet-stream",
                    "name": name or "upload",
                    "lastAccessedAt": time.monotonic(),
                },
            )
            upload["lastAccessedAt"] = time.monotonic()
            upload["chunks"][chunk_index] = content
            received = len(upload["chunks"])
            complete = received >= upload["chunkCount"]
            if not complete:
                return {
                    "ok": True,
                    "uploadComplete": False,
                    "received": received,
                    "chunkCount": upload["chunkCount"],
                }
            assembled = b"".join(upload["chunks"][index] for index in range(upload["chunkCount"]))
            self._uploads.pop(upload_id, None)

        result = self.upload_document(
            content=assembled,
            mime_type=mime_type or upload.get("mimeType") or "application/octet-stream",
            name=name or upload.get("name") or "upload",
        )
        result["uploadComplete"] = True
        result["received"] = chunk_count
        result["chunkCount"] = chunk_count
        return result

    def _document_for_payload(self, document_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        if document_id:
            document = self._get_document(document_id)
            if document:
                return self._materialize_document_content(document)
        parsed = _parse_data_url(str(payload.get("dataUrl") or payload.get("image") or ""))
        if not parsed:
            return None
        mime_type, content = parsed
        return self._store_document(
            mime_type=mime_type,
            content=content,
            name=str(payload.get("name") or "upload").strip() or "upload",
        )

    def _get_document(self, document_id: str) -> dict[str, Any] | None:
        with self._lock:
            document = self._documents.get(document_id)
            if document:
                document["lastAccessedAt"] = time.monotonic()
            return document

    def _store_document(
        self,
        *,
        mime_type: str,
        content: bytes,
        name: str,
        oss_key: str = "",
        persist_to_oss: bool = True,
        page_count: int = 0,
        persist_rendered_pages: bool = True,
    ) -> dict[str, Any]:
        self._prune_documents()
        document_id = uuid.uuid4().hex
        if not oss_key and persist_to_oss and OSS_STORAGE_SERVICE.enabled:
            oss_key = OSS_STORAGE_SERVICE.document_key(document_id, name)
            OSS_STORAGE_SERVICE.put_bytes(oss_key, content, content_type=mime_type or "application/octet-stream")
        document = {
            "id": document_id,
            "mimeType": mime_type,
            "content": content,
            "name": name,
            "ossKey": oss_key,
            "pageCount": int(page_count or 0),
            "persistRenderedPages": persist_rendered_pages,
            "lastAccessedAt": time.monotonic(),
        }
        with self._lock:
            self._documents[document_id] = document
        return document

    def _materialize_document_content(self, document: dict[str, Any]) -> dict[str, Any] | None:
        if bytes(document.get("content") or b""):
            return document
        oss_key = str(document.get("ossKey") or "")
        if not oss_key or not OSS_STORAGE_SERVICE.enabled:
            return document
        content = OSS_STORAGE_SERVICE.get_bytes(oss_key)
        if not content:
            return None
        with self._lock:
            stored = self._documents.get(str(document.get("id") or ""))
            if stored is not None:
                stored["content"] = content
                stored["lastAccessedAt"] = time.monotonic()
                return stored
        document["content"] = content
        document["lastAccessedAt"] = time.monotonic()
        return document

    def _persist_rendered_pages(self, document_id: str, pages: list[dict[str, Any]]) -> None:
        for page in pages:
            parsed = _parse_data_url(str(page.get("image") or ""))
            page_number = int(page.get("pageNumber") or 0)
            if not parsed or not page_number:
                continue
            mime_type, content = parsed
            key = OSS_STORAGE_SERVICE.page_image_key(document_id, page_number)
            if OSS_STORAGE_SERVICE.put_bytes(key, content, content_type=mime_type):
                page["ossKey"] = key

    def _document_page_count(self, document: dict[str, Any]) -> int:
        known_page_count = int(document.get("pageCount") or 0)
        if known_page_count:
            return known_page_count
        mime_type = str(document.get("mimeType") or "")
        name = str(document.get("name") or "")
        content = bytes(document.get("content") or b"")
        if mime_type == "application/pdf" or name.lower().endswith(".pdf"):
            try:
                with fitz.open(stream=content, filetype="pdf") as pdf:
                    return len(pdf)
            except Exception:  # noqa: BLE001
                return 0
        if mime_type.startswith("image/"):
            return 1
        return 0

    def _prune_documents(self) -> None:
        expires_before = time.monotonic() - 60 * 60
        with self._lock:
            expired = [key for key, value in self._documents.items() if value.get("lastAccessedAt", 0) < expires_before]
            for key in expired:
                self._documents.pop(key, None)
            while len(self._documents) > 4:
                oldest = min(self._documents.items(), key=lambda item: item[1].get("lastAccessedAt", 0))[0]
                self._documents.pop(oldest, None)
            expired_pages = [key for key, value in self._page_cache.items() if value.get("lastAccessedAt", 0) < expires_before]
            for key in expired_pages:
                self._page_cache.pop(key, None)
            while len(self._page_cache) > 80:
                oldest_page = min(self._page_cache.items(), key=lambda item: item[1].get("lastAccessedAt", 0))[0]
                self._page_cache.pop(oldest_page, None)

    def _prune_uploads(self) -> None:
        expires_before = time.monotonic() - 30 * 60
        with self._lock:
            expired = [key for key, value in self._uploads.items() if value.get("lastAccessedAt", 0) < expires_before]
            for key in expired:
                self._uploads.pop(key, None)

    def _page_cache_key(
        self,
        *,
        document_id: str,
        page_number: int | None,
        max_pages: int,
        zoom: float,
        include_text: bool,
        render_images: bool,
    ) -> str:
        if not document_id or page_number is None:
            return ""
        return "|".join(
            [
                document_id,
                str(int(page_number)),
                str(int(max_pages)),
                str(round(float(zoom), 3)),
                "text" if include_text else "no-text",
                "image" if render_images else "no-image",
            ]
        )

    def _get_cached_page_preview(self, cache_key: str) -> dict[str, Any] | None:
        with self._lock:
            cached = self._page_cache.get(cache_key)
            if cached:
                cached["lastAccessedAt"] = time.monotonic()
                payload = cached.get("payload")
                return dict(payload) if isinstance(payload, dict) else None
        return None

    def _set_cached_page_preview(self, cache_key: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self._page_cache[cache_key] = {
                "payload": dict(payload),
                "lastAccessedAt": time.monotonic(),
            }


OCR_PREVIEW_SERVICE = OcrPreviewService()
