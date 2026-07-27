#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

IMPORT_TMP = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(IMPORT_TMP.name) / 'import.sqlite'}")
os.environ.setdefault("APP_ADMIN_USER_ID", "门")

from backend import ocr_server


def assert_true(value: object, message: str) -> None:
    if not value:
        raise AssertionError(message)


class FakeOssStorage:
    enabled = True
    error = ""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def get_bytes(self, key: str) -> bytes | None:
        self.calls.append(key)
        if key.endswith("middle.json"):
            return json.dumps({"pdf_info": [{"page_size": [612, 792]}]}).encode("utf-8")
        if key.endswith("content_list.json"):
            return json.dumps([{"type": "text", "text": "content"}]).encode("utf-8")
        return None


class FakePreviewService:
    def load_document_reference(self, **kwargs: object) -> dict:
        return {
            "ok": True,
            "documentId": "doc-1",
            "pageCount": kwargs.get("page_count"),
            "deferred": True,
        }


class FakeDbService:
    enabled = True

    def __init__(self) -> None:
        self.get_state_calls = 0

    def get_book(self, book_id: str) -> dict:
        return {
            "ok": True,
            "book": {
                "id": book_id,
                "oss_pdf_key": "books/book-1/origin.pdf",
                "oss_middle_key": "books/book-1/middle.json",
                "oss_content_list_key": "books/book-1/content_list.json",
                "owner_user_id": "门",
            },
        }

    def get_state(self, book_id: str) -> dict:
        self.get_state_calls += 1
        return {
            "ok": True,
            "ocrPatches": [{"patchId": "patch-1", "status": "accepted"}],
            "reviewMarks": [{"blockId": "p1_b1", "markType": "needs_extra_correction", "status": "open"}],
        }


def call_load_book(payload: dict) -> tuple[dict, FakeDbService, FakeOssStorage]:
    fake_oss = FakeOssStorage()
    fake_db = FakeDbService()
    old_oss = ocr_server.OSS_STORAGE_SERVICE
    old_db = ocr_server.DB_SERVICE
    old_preview = ocr_server.OCR_PREVIEW_SERVICE
    try:
        ocr_server.OSS_STORAGE_SERVICE = fake_oss
        ocr_server.DB_SERVICE = fake_db
        ocr_server.OCR_PREVIEW_SERVICE = FakePreviewService()
        response = ocr_server.OcrWorkbenchHandler._load_oss_book(object(), payload)
        return response, fake_db, fake_oss
    finally:
        ocr_server.OSS_STORAGE_SERVICE = old_oss
        ocr_server.DB_SERVICE = old_db
        ocr_server.OCR_PREVIEW_SERVICE = old_preview


def main() -> None:
    deferred, deferred_db, deferred_oss = call_load_book({"bookId": "book-1", "deferBookState": True})
    assert_true(deferred["ok"], "deferred book load should succeed")
    assert_true(deferred.get("bookStateDeferred") is True, "deferred book load should mark DB state as deferred")
    assert_true(deferred_db.get_state_calls == 0, "deferred book load should not synchronously read DB patches or marks")
    assert_true("ocrPatches" not in deferred, "deferred book load should not return an empty patch list that masks saved state")
    assert_true("reviewMarks" not in deferred, "deferred book load should not return an empty review mark list that masks saved state")
    assert_true(any(key.endswith("middle.json") for key in deferred_oss.calls), "deferred load should still read middle.json")

    full, full_db, _ = call_load_book({"bookId": "book-1"})
    assert_true(full["ok"], "full book load should succeed")
    assert_true(full_db.get_state_calls == 1, "full book load should keep the existing synchronous DB state behavior")
    assert_true(full.get("bookStateDeferred") is False, "full book load should not mark DB state as deferred")
    assert_true(full["ocrPatches"][0]["patchId"] == "patch-1", "full book load should include DB patches")
    assert_true(full["reviewMarks"][0]["blockId"] == "p1_b1", "full book load should include review marks")

    print("ocr server load-book ok")


if __name__ == "__main__":
    main()
