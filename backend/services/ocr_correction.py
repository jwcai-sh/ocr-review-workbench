from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any

from backend.config import SETTINGS
from backend.services.mineru_client import MINERU_CLIENT


@dataclass(slots=True)
class OcrCorrectionCandidate:
    block_index: int
    start: int
    end: int
    text: str
    reasons: list[str]
    score: float
    page_number: int | None = None


@dataclass(slots=True)
class OcrCorrection:
    block_index: int
    original: str
    corrected: str
    reasons: list[str]
    changed: bool


def _split_blocks(markdown: str) -> list[tuple[int, int, str]]:
    blocks: list[tuple[int, int, str]] = []
    for match in re.finditer(r"\S(?:.*?)(?=\n{2,}\S|\Z)", markdown, flags=re.DOTALL):
        text = match.group(0)
        if text.strip():
            blocks.append((match.start(), match.end(), text))
    return blocks


def _has_table(text: str) -> bool:
    if re.search(r"<\s*/?\s*(table|thead|tbody|tr|td|th)\b", text, flags=re.IGNORECASE):
        return True
    lines = [line for line in text.splitlines() if line.strip()]
    return sum(1 for line in lines if "|" in line) >= 2


def _strip_html_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text)


def _has_math(text: str) -> bool:
    text_for_math = _strip_html_tags(text)
    return bool(
        re.search(r"\\\(|\\\[|\$|\\frac|\\sum|\\int|\\sqrt|\\begin\{|[_^=<>≤≥±×÷]", text_for_math)
    )


def _has_split_formula(text: str) -> bool:
    patterns = [
        r"\b[A-Za-z]\s+\d\b",
        r"\b\d\s+\d\b",
        r"\^\s+\d",
        r"_\s+\d",
        r"\\\(\s*[^)]*\s{2,}[^)]*\\\)",
        r"\$\s*[^$]*\s{2,}[^$]*\$",
    ]
    return any(re.search(pattern, text) for pattern in patterns)


def _has_compact_formula_loss(text: str) -> bool:
    if not _has_table(text):
        return False
    compact = re.sub(r"\s+", "", text)
    patterns = [
        r"(?:^|[<>|,;，；])(?:w|x|y|z|n|m|k|p|q|r|t)={0,1}2\d{1,3}(?:[<>|,;，；]|$)",
        r"(?:^|[<>|,;，；])(?:w|x|y|z|n|m|k|p|q|r|t)\d{2,4}(?:[<>|,;，；]|$)",
        r"(?:^|[<>|,;，；])2\d{1,3}\$(?:[<>|,;，；]|$)",
    ]
    return any(re.search(pattern, compact, flags=re.IGNORECASE) for pattern in patterns)


def _has_matrix_signal(text: str) -> bool:
    lowered = text.lower()
    return bool(
        "\\begin{matrix" in lowered
        or "\\begin{pmatrix" in lowered
        or "\\begin{bmatrix" in lowered
        or re.search(r"[\[\(]\s*(?:[-+0-9a-zA-Z_.]+\s+){2,}[-+0-9a-zA-Z_.]+", text)
        or ("矩阵" in text and ("\n" in text or "|" in text))
    )


def _has_pseudocode_signal(text: str) -> bool:
    plain_text = _strip_html_tags(text)
    lowered = plain_text.lower()
    english_patterns = [
        r"\binput\s*:",
        r"\boutput\s*:",
        r"\bprocedure\b",
        r"\breturn\b",
        r"\bfor\b",
        r"\bwhile\b",
        r"\bif\b",
        r"\belse\b",
        r"(?:^|\n)\s*algorithm\s+\d+",
    ]
    chinese_markers = ["伪代码", "输入", "输出", "算法", "步骤"]
    return any(re.search(pattern, lowered) for pattern in english_patterns) or any(marker in text for marker in chinese_markers)


def _score_block(text: str) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = 0.0
    if _has_table(text) and _has_math(text):
        score += 0.38
        reasons.append("table_with_math")
    if _has_compact_formula_loss(text):
        score += 0.36
        reasons.append("compact_formula_maybe_missing_superscript")
    if _has_split_formula(text):
        score += 0.32
        reasons.append("split_formula_tokens")
    if _has_matrix_signal(text):
        score += 0.34
        reasons.append("matrix_like_layout")
    if _has_pseudocode_signal(text):
        score += 0.28
        reasons.append("pseudocode_like_layout")
    if text.count("$") % 2 == 1:
        score += 0.2
        reasons.append("unbalanced_math_delimiter")
    if re.search(r"\\[a-zA-Z]+\s+[a-zA-Z0-9]", text):
        score += 0.12
        reasons.append("latex_command_spacing")
    return min(score, 1.0), reasons


def _detect_candidates(markdown: str, max_candidates: int) -> list[OcrCorrectionCandidate]:
    candidates: list[OcrCorrectionCandidate] = []
    for block_index, (start, end, text) in enumerate(_split_blocks(markdown)):
        score, reasons = _score_block(text)
        if score < 0.25:
            continue
        candidates.append(
            OcrCorrectionCandidate(
                block_index=block_index,
                start=start,
                end=end,
                text=text,
                reasons=reasons,
                score=round(score, 3),
                page_number=_guess_page_number(markdown[:start]),
            )
        )
    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates[:max_candidates]


def _guess_page_number(prefix: str) -> int | None:
    matches = re.findall(r"(?:page|页码|第)\s*[:：]?\s*(\d{1,5})", prefix[-3000:], flags=re.IGNORECASE)
    if not matches:
        return None
    return int(matches[-1])


def _extract_markdown(payload: dict[str, Any]) -> str:
    for key in ("markdown", "md", "content", "text"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value

    result = payload.get("result")
    if isinstance(result, dict):
        nested = _extract_markdown(result)
        if nested:
            return nested

    pages = payload.get("pages")
    if isinstance(pages, list):
        chunks: list[str] = []
        for page in pages:
            if isinstance(page, dict):
                chunks.append(_extract_markdown(page))
        return "\n\n".join(chunk for chunk in chunks if chunk)
    return ""


def _strip_markdown_fence(text: str) -> str:
    stripped = text.strip()
    fence_match = re.match(r"^```(?:markdown|md)?\s*(.*?)\s*```$", stripped, flags=re.DOTALL | re.IGNORECASE)
    if fence_match:
        return fence_match.group(1).strip()
    return stripped


def _page_image_for_candidate(candidate: OcrCorrectionCandidate, page_images: list[dict[str, Any]]) -> str | None:
    if not page_images:
        return None
    if candidate.page_number is not None:
        for item in page_images:
            page_number = item.get("pageNumber") or item.get("page") or item.get("page_number")
            if page_number == candidate.page_number:
                return str(item.get("image") or item.get("dataUrl") or item.get("url") or "")
    return str(page_images[0].get("image") or page_images[0].get("dataUrl") or page_images[0].get("url") or "")


def _parse_data_url(data_url: str) -> tuple[str, str] | None:
    match = re.match(r"^data:([^;,]+);base64,(.+)$", data_url, flags=re.DOTALL)
    if not match:
        return None
    return match.group(1), match.group(2)


def _normalize_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    aliases = {
        "yunwu": "yunwu-openai",
        "yunwu-gpt55": "yunwu-openai",
        "yunwu-openai": "yunwu-openai",
        "openai": "openai-compatible",
        "openai-compatible": "openai-compatible",
        "gemini": "gemini",
    }
    return aliases.get(normalized, normalized or "openai-compatible")


def _resolve_openai_compatible_config(payload: dict[str, Any], provider: str) -> tuple[str, str, str, str]:
    if provider == "yunwu-openai":
        base_url = str(payload.get("baseUrl") or SETTINGS.yunwu_api_base_url or SETTINGS.ocr_correction_base_url).rstrip("/")
        api_key = str(payload.get("apiKey") or SETTINGS.yunwu_api_key or SETTINGS.ocr_correction_api_key)
        model = str(payload.get("model") or SETTINGS.yunwu_gpt55_model or SETTINGS.ocr_correction_model)
        path = str(payload.get("path") or SETTINGS.yunwu_chat_path or SETTINGS.ocr_correction_path)
        return base_url, api_key, model, path

    base_url = str(payload.get("baseUrl") or SETTINGS.ocr_correction_base_url).rstrip("/")
    api_key = str(payload.get("apiKey") or SETTINGS.ocr_correction_api_key)
    model = str(payload.get("model") or SETTINGS.ocr_correction_model)
    path = str(payload.get("path") or SETTINGS.ocr_correction_path)
    return base_url, api_key, model, path


class OcrCorrectionService:
    def correct_markdown(self, payload: dict[str, Any]) -> dict[str, Any]:
        markdown = str(payload.get("markdown") or "")
        if not markdown and isinstance(payload.get("mineruResult"), dict):
            markdown = _extract_markdown(payload["mineruResult"])
        if not markdown:
            return {"ok": False, "error": "Missing markdown or mineruResult markdown"}

        max_candidates = int(payload.get("maxCandidates") or SETTINGS.ocr_correction_max_candidates)
        candidates = _detect_candidates(markdown, max_candidates)
        if payload.get("dryRun"):
            return {
                "ok": True,
                "correctedMarkdown": markdown,
                "candidates": [asdict(candidate) for candidate in candidates],
                "corrections": [],
            }
        if not candidates:
            return {"ok": True, "correctedMarkdown": markdown, "candidates": [], "corrections": []}
        if not self._is_configured(payload):
            return {
                "ok": False,
                "error": "OCR correction model is not configured",
                "correctedMarkdown": markdown,
                "candidates": [asdict(candidate) for candidate in candidates],
                "corrections": [],
            }

        page_images = payload.get("pageImages") if isinstance(payload.get("pageImages"), list) else []
        corrections: list[OcrCorrection] = []
        errors: list[dict[str, Any]] = []
        replacements: dict[int, str] = {}
        for candidate in candidates:
            image = _page_image_for_candidate(candidate, page_images)
            try:
                corrected = self._correct_candidate(candidate, image, payload)
            except Exception as error:  # noqa: BLE001
                errors.append(
                    {
                        "blockIndex": candidate.block_index,
                        "reasons": candidate.reasons,
                        "error": str(error),
                    }
                )
                continue
            if corrected:
                replacements[candidate.block_index] = corrected
                corrections.append(
                    OcrCorrection(
                        block_index=candidate.block_index,
                        original=candidate.text,
                        corrected=corrected,
                        reasons=candidate.reasons,
                        changed=corrected.strip() != candidate.text.strip(),
                    )
                )

        corrected_markdown = self._merge(markdown, candidates, replacements)
        return {
            "ok": not errors,
            "correctedMarkdown": corrected_markdown,
            "candidates": [asdict(candidate) for candidate in candidates],
            "corrections": [asdict(correction) for correction in corrections],
            "errors": errors,
        }

    def convert_and_correct(self, payload: dict[str, Any]) -> dict[str, Any]:
        convert_result = MINERU_CLIENT.convert_markdown(payload)
        if not convert_result.get("ok"):
            return convert_result

        markdown = _extract_markdown(convert_result)
        if not markdown:
            return {
                "ok": False,
                "error": "MinerU response did not include markdown-like content",
                "mineru": convert_result,
            }

        correction_payload = dict(payload)
        correction_payload["markdown"] = markdown
        correction_result = self.correct_markdown(correction_payload)
        correction_result["mineru"] = convert_result
        return correction_result

    def _is_configured(self, payload: dict[str, Any]) -> bool:
        provider = _normalize_provider(str(payload.get("provider") or SETTINGS.ocr_correction_provider))
        if provider == "gemini":
            return bool(payload.get("apiKey") or SETTINGS.ocr_correction_api_key) and bool(
                payload.get("model") or SETTINGS.ocr_correction_model
            )
        base_url, api_key, model, _ = _resolve_openai_compatible_config(payload, provider)
        return bool(base_url) and bool(api_key) and bool(model)

    def _correct_candidate(self, candidate: OcrCorrectionCandidate, image: str | None, payload: dict[str, Any]) -> str:
        provider = _normalize_provider(str(payload.get("provider") or SETTINGS.ocr_correction_provider))
        if provider == "gemini":
            return self._correct_with_gemini(candidate, image, payload)
        return self._correct_with_openai_compatible(candidate, image, payload)

    def _correct_with_openai_compatible(
        self,
        candidate: OcrCorrectionCandidate,
        image: str | None,
        payload: dict[str, Any],
    ) -> str:
        provider = _normalize_provider(str(payload.get("provider") or SETTINGS.ocr_correction_provider))
        base_url, api_key, model, path = _resolve_openai_compatible_config(payload, provider)
        url = f"{base_url}{path if path.startswith('/') else '/' + path}"
        request_payload = {
            "model": model,
            "temperature": 0,
            "max_tokens": int(payload.get("maxOutputTokens") or SETTINGS.ocr_correction_max_output_tokens),
            "messages": [
                {"role": "system", "content": self._system_prompt()},
                {"role": "user", "content": self._openai_user_content(candidate, image)},
            ],
        }
        data = self._post_json(url, request_payload, api_key)
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return _strip_markdown_fence(str(content))

    def _correct_with_gemini(
        self,
        candidate: OcrCorrectionCandidate,
        image: str | None,
        payload: dict[str, Any],
    ) -> str:
        raw_model = str(payload.get("model") or SETTINGS.ocr_correction_model)
        if raw_model.startswith("models/"):
            raw_model = raw_model.removeprefix("models/")
        model = urllib.parse.quote(raw_model, safe="")
        api_key = str(payload.get("apiKey") or SETTINGS.ocr_correction_api_key)
        base_url = str(payload.get("baseUrl") or SETTINGS.ocr_correction_base_url or "https://generativelanguage.googleapis.com").rstrip("/")
        url = f"{base_url}/v1beta/models/{model}:generateContent?key={urllib.parse.quote(api_key)}"
        parts: list[dict[str, Any]] = [{"text": f"{self._system_prompt()}\n\n{self._user_text(candidate)}"}]
        if image:
            parsed = _parse_data_url(image)
            if parsed:
                mime_type, data = parsed
                parts.append({"inline_data": {"mime_type": mime_type, "data": data}})
        request_payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": int(payload.get("maxOutputTokens") or SETTINGS.ocr_correction_max_output_tokens),
            },
        }
        data = self._post_json(url, request_payload, "")
        candidates = data.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        content = "\n".join(str(part.get("text", "")) for part in parts)
        return _strip_markdown_fence(content)

    def _openai_user_content(self, candidate: OcrCorrectionCandidate, image: str | None) -> list[dict[str, Any]]:
        content: list[dict[str, Any]] = [{"type": "text", "text": self._user_text(candidate)}]
        if image:
            content.append({"type": "image_url", "image_url": {"url": image}})
        return content

    def _system_prompt(self) -> str:
        return (
            "你是一个 OCR Markdown 校正器。只修正用户给出的单个 Markdown 块，重点处理数学公式、"
            "表格中的公式、跨多行分块矩阵和伪代码。必须保持原意和原有 Markdown 结构，"
            "不要补充解释，不要输出分析过程，不要编造图片中不存在的内容。"
        )

    def _user_text(self, candidate: OcrCorrectionCandidate) -> str:
        return (
            "请根据页面图像和上下文校正下面这个 MinerU 识别块。"
            "常见错误包括把上标识别成普通空格数字，例如把 $2^7$ 识别为 $2 7$；"
            "也包括表格表头或单元格里把 $2^7$ 识别成 27、w=27 或 27$；"
            "把矩阵行列拆坏；把伪代码缩进和关键字识别错。\n\n"
            "只输出校正后的 Markdown 块，不要解释。\n\n"
            f"疑似原因: {', '.join(candidate.reasons)}\n\n"
            "原始块:\n"
            f"{candidate.text}"
        )

    def _post_json(self, url: str, payload: dict[str, Any], api_key: str) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=SETTINGS.ocr_correction_timeout_seconds) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"HTTP {error.code}: {details[:300]}") from error
        if not raw.strip():
            return {}
        return json.loads(raw)

    def _merge(
        self,
        markdown: str,
        candidates: list[OcrCorrectionCandidate],
        replacements: dict[int, str],
    ) -> str:
        if not replacements:
            return markdown
        output: list[str] = []
        cursor = 0
        for candidate in sorted(candidates, key=lambda item: item.start):
            replacement = replacements.get(candidate.block_index)
            if replacement is None:
                continue
            output.append(markdown[cursor : candidate.start])
            output.append(replacement)
            cursor = candidate.end
        output.append(markdown[cursor:])
        return "".join(output)


OCR_CORRECTION_SERVICE = OcrCorrectionService()
