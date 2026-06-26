#!/usr/bin/env python3
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.config import SETTINGS, mathpix_credentials_error
from backend.services.mathpix_ocr import ATTACHMENT_STORE, MATHPIX_OCR_SERVICE, _normalize_mathpix_latex


def assert_in(text: str, needle: str) -> None:
    assert needle in text, f"expected {needle!r} in {text!r}"


assert mathpix_credentials_error("app-id", "app-key") == ""
assert_in(mathpix_credentials_error("", "app-key"), "未配置")
assert_in(mathpix_credentials_error("你的_app_id", "app-key"), "占位符")
assert_in(mathpix_credentials_error("app-id", "密钥"), "ASCII")

diacritic_result = _normalize_mathpix_latex(
    "laboratory Eotv¨os experiments, gravitational interactions are¨ totally irrelevant."
)
assert_in(diacritic_result, "laboratory Eötvös experiments")
assert_in(diacritic_result, "interactions are totally irrelevant")
assert "are¨ totally" not in diacritic_result
assert_in(_normalize_mathpix_latex("The Eotv¨ os experiment."), "The Eötvös experiment.")

old_app_id = SETTINGS.mathpix_app_id
old_app_key = SETTINGS.mathpix_app_key
try:
    SETTINGS.mathpix_app_id = "你的_app_id"
    SETTINGS.mathpix_app_key = "你的_app_key"
    ATTACHMENT_STORE.clear()
    ATTACHMENT_STORE["test-image"] = {"data_url": "data:image/png;base64,AAAA"}
    result = MATHPIX_OCR_SERVICE.image_to_markdown({"attachmentIds": ["test-image"]})
    assert result["ok"] is False
    assert_in(result["error"], "占位符")
    assert "latin-1" not in result["error"]
finally:
    SETTINGS.mathpix_app_id = old_app_id
    SETTINGS.mathpix_app_key = old_app_key
    ATTACHMENT_STORE.clear()

print("mathpix config tests ok")
