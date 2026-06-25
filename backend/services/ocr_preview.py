from __future__ import annotations

import base64
import io
import re
from typing import Any

import fitz
from PIL import Image


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
    def preview_pages(self, payload: dict[str, Any]) -> dict[str, Any]:
        parsed = _parse_data_url(str(payload.get("dataUrl") or payload.get("image") or ""))
        if not parsed:
            return {"ok": False, "error": "Missing valid dataUrl"}

        mime_type, content = parsed
        name = str(payload.get("name") or "upload").strip() or "upload"
        render_images = payload.get("renderImages") is not False
        include_text = bool(payload.get("includeText"))
        max_page_cap = 50 if render_images else 500
        max_pages = max(1, min(int(payload.get("maxPages") or 20), max_page_cap))
        zoom = max(1.0, min(float(payload.get("zoom") or 1.8), 3.0))
        page_number = int(payload["pageNumber"]) if payload.get("pageNumber") else None

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

        return {
            "ok": True,
            "name": name,
            "mimeType": mime_type,
            "pages": pages,
            "pageCount": total_pages,
            "renderedCount": len(pages),
        }


OCR_PREVIEW_SERVICE = OcrPreviewService()
