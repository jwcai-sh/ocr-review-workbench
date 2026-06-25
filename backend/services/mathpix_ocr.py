from __future__ import annotations

import base64
import re
import time
import uuid
from collections import OrderedDict
from typing import Any, Callable

import requests

from backend.config import SETTINGS

ATTACHMENT_STORE: OrderedDict[str, dict[str, Any]] = OrderedDict()
MAX_ATTACHMENTS = 24


def _compact_error(response: requests.Response) -> str:
    body = response.text.strip()
    if len(body) > 600:
        body = f"{body[:600]}..."
    return f"HTTP {response.status_code}: {body or response.reason}"


def _parse_data_url(data_url: str) -> tuple[str, str] | None:
    if not data_url.startswith("data:") or "," not in data_url:
        return None
    header, data = data_url.split(",", 1)
    mime_type = header[5:].split(";", 1)[0].strip() or "application/octet-stream"
    if ";base64" not in header:
        data = base64.b64encode(data.encode("utf-8")).decode("ascii")
    return mime_type, data


def _strip_markdown_fence(text: str) -> str:
    stripped = text.strip()
    match = re.match(r"^```(?:markdown|md)?\s*(.*?)\s*```$", stripped, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else stripped


def _clean_latex_text(value: str) -> str:
    text = value.strip()
    text = re.sub(r"(?:\\\\|\\)\s*$", "", text).strip()
    text = re.sub(r"\\\s*\$$", "$", text)
    text = re.sub(r"\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b\s*", "", text)
    text = text.replace(r"\&", "&")
    text = text.replace(r"\{", "{").replace(r"\}", "}")
    text = re.sub(r"\\backslash\b", r"\\", text)
    text = re.sub(r"\\left\s*", r"\\left", text)
    text = re.sub(r"\\right\s*", r"\\right", text)
    return re.sub(r"\s+", " ", text).strip()


def _balance_latex_cell_math(value: str) -> str:
    text = value.strip()
    if not text:
        return text
    dollar_count = text.count("$")
    if dollar_count % 2 == 1:
        if text.startswith("$"):
            return f"{text}$"
        if text.endswith("$"):
            return f"${text}"
    if "$" not in text and re.search(r"\\[A-Za-z]+|[_^]\s*(?:\{|[A-Za-z0-9])", text):
        return f"${text}$"
    return text


def _replace_latex_command_arg(text: str, command: str, replacer: Callable[[str], str]) -> str:
    marker = f"\\{command}{{"
    output: list[str] = []
    index = 0
    while True:
        start = text.find(marker, index)
        if start < 0:
            output.append(text[index:])
            break
        output.append(text[index:start])
        pos = start + len(marker)
        depth = 1
        while pos < len(text) and depth > 0:
            char = text[pos]
            previous = text[pos - 1] if pos > 0 else ""
            if char == "{" and previous != "\\":
                depth += 1
            elif char == "}" and previous != "\\":
                depth -= 1
            pos += 1
        if depth != 0:
            output.append(text[start:])
            break
        output.append(replacer(text[start + len(marker) : pos - 1]))
        index = pos
    return "".join(output)


def _markdown_table_from_tabular(match: re.Match[str]) -> str:
    body = match.group(2)
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    body = re.sub(r"\\hline\b", "\n", body)
    raw_rows: list[str] = []
    for line in body.split("\n"):
        line = line.strip()
        if "&" in line:
            raw_rows.extend(part for part in re.split(r"\\\\", line) if part.strip())
    rows: list[list[str]] = []
    for raw_row in raw_rows:
        row = raw_row.strip()
        if not row:
            continue
        cells = [_balance_latex_cell_math(_clean_latex_text(cell)) for cell in row.split("&")]
        if any(cells):
            rows.append(cells)
    if not rows:
        return ""

    width = max(len(row) for row in rows)
    normalized_rows = [row + [""] * (width - len(row)) for row in rows]
    lines = [
        "| " + " | ".join(normalized_rows[0]) + " |",
        "| " + " | ".join("---" for _ in range(width)) + " |",
    ]
    for row in normalized_rows[1:]:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _indent_fenced_code_blocks(markdown: str) -> str:
    def indent_block(match: re.Match[str]) -> str:
        language = match.group(1) or ""
        body = match.group(2)
        indent = 0
        formatted: list[str] = []
        for raw_line in body.splitlines():
            line = raw_line.strip()
            if not line:
                formatted.append("")
                continue
            if re.fullmatch(r"end\b.*", line, flags=re.IGNORECASE):
                indent = max(0, indent - 1)
            formatted.append(f"{'  ' * indent}{line}")
            if re.match(r"for\b", line, flags=re.IGNORECASE):
                indent += 1
        return f"```{language}\n" + "\n".join(formatted).strip("\n") + "\n```"

    return re.sub(r"```([A-Za-z0-9_-]*)\n([\s\S]*?)\n```", indent_block, markdown)


def _normalize_mathpix_latex(markdown: str) -> str:
    text = _strip_markdown_fence(markdown).strip()
    if not text:
        return ""
    text = text.replace(r"\{", "{").replace(r"\}", "}")
    text = text.replace(r"\&", "&")
    text = re.sub(r"\\backslash\b", r"\\", text)
    text = re.sub(r"(^|\n)\s*lbegin\{", r"\1\\begin{", text)
    text = re.sub(r"(^|\n)\s*lend\{", r"\1\\end{", text)
    text = re.sub(r"\\begin\{table\}", "", text)
    text = re.sub(r"\\end\{table\}", "", text)
    text = re.sub(r"(?m)^\s*}\s*$\n?", "", text)
    text = re.sub(r"\\captionsetup\{[^}]*\}", "", text)
    text = _replace_latex_command_arg(text, "caption", _clean_latex_text)
    text = re.sub(
        r"\\begin\{tabular\}\s*\{([^}]*)\}(.*?)\\end\{tabular\}",
        _markdown_table_from_tabular,
        text,
        flags=re.DOTALL,
    )
    text = re.sub(r"(?m)^(\|.*\|)\s+}\s*$", r"\1", text)
    text = _indent_fenced_code_blocks(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _trim_attachment_store() -> None:
    while len(ATTACHMENT_STORE) > MAX_ATTACHMENTS:
        ATTACHMENT_STORE.popitem(last=False)


class MathpixOcrService:
    def upload_attachment(self, payload: dict[str, Any]) -> dict[str, Any]:
        attachment_id = uuid.uuid4().hex
        item = {
            "id": attachment_id,
            "name": str(payload.get("name") or "attachment").strip() or "attachment",
            "kind": str(payload.get("kind") or "metadata").strip() or "metadata",
            "mime_type": str(payload.get("mimeType") or "").strip(),
            "size": int(payload.get("size") or 0),
            "created_at": time.time(),
            "data_url": str(payload.get("dataUrl") or ""),
        }
        if item["kind"] != "image" or not item["data_url"]:
            return {"ok": False, "error": "Only image attachments are supported in OCR workbench."}

        ATTACHMENT_STORE[attachment_id] = item
        _trim_attachment_store()
        return {
            "ok": True,
            "id": attachment_id,
            "name": item["name"],
            "kind": item["kind"],
            "mimeType": item["mime_type"],
            "size": item["size"],
        }

    def image_to_markdown(self, payload: dict[str, Any]) -> dict[str, Any]:
        attachment_ids = payload.get("attachmentIds") if isinstance(payload.get("attachmentIds"), list) else []
        images = [
            str(ATTACHMENT_STORE.get(str(raw_id), {}).get("data_url") or "")
            for raw_id in attachment_ids
            if str(raw_id) in ATTACHMENT_STORE
        ]
        images = [image for image in images if image]
        if not images:
            return {"ok": False, "error": "未找到已上传图片，请重新上传图片后再试。", "attempts": []}
        if not SETTINGS.mathpix_app_id or not SETTINGS.mathpix_app_key:
            return {"ok": False, "error": "未配置 MATHPIX_APP_ID/MATHPIX_APP_KEY。", "attempts": []}

        started_at = time.perf_counter()
        results: list[dict[str, Any]] = []
        chunks: list[str] = []
        try:
            for image in images:
                if not _parse_data_url(image):
                    raise RuntimeError("图片数据格式无效，无法发送给 Mathpix。")
                request_body = {
                    "src": image,
                    "formats": ["text", "latex_styled", "data", "html"],
                    "ocr": ["math", "text"],
                    "skip_recrop": True,
                    "math_inline_delimiters": ["$", "$"],
                    "math_display_delimiters": ["$$", "$$"],
                    "rm_spaces": False,
                }
                response = requests.post(
                    SETTINGS.mathpix_api_url,
                    headers={
                        "Content-Type": "application/json",
                        "app_id": SETTINGS.mathpix_app_id,
                        "app_key": SETTINGS.mathpix_app_key,
                    },
                    json=request_body,
                    timeout=max(1.0, SETTINGS.mathpix_timeout_seconds),
                )
                if not response.ok:
                    raise RuntimeError(_compact_error(response))
                data = response.json()
                results.append(data)
                text = _normalize_mathpix_latex(str(data.get("latex_styled") or data.get("text") or "").strip())
                if text:
                    chunks.append(text)
        except Exception as error:  # noqa: BLE001
            return {
                "ok": False,
                "error": str(error),
                "attempts": [{"provider": "mathpix", "model": SETTINGS.mathpix_model, "status": "error", "error": str(error)}],
            }

        markdown = "\n\n".join(chunks).strip()
        if not markdown:
            return {
                "ok": False,
                "error": "Mathpix 返回为空。",
                "attempts": [{"provider": "mathpix", "model": SETTINGS.mathpix_model, "status": "error"}],
                "raw": {"provider": "mathpix", "results": results},
            }

        return {
            "ok": True,
            "markdown": markdown,
            "answer": markdown,
            "provider": "mathpix",
            "model": SETTINGS.mathpix_model,
            "modelRef": f"mathpix:{SETTINGS.mathpix_model}",
            "path": SETTINGS.mathpix_api_url,
            "latencyMs": round((time.perf_counter() - started_at) * 1000),
            "usage": None,
            "finishReason": None,
            "attempts": [{"provider": "mathpix", "model": SETTINGS.mathpix_model, "status": "done"}],
            "raw": {"provider": "mathpix", "results": results, "prompt": str(payload.get("prompt") or "")},
        }


MATHPIX_OCR_SERVICE = MathpixOcrService()
