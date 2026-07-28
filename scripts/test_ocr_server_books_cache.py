from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

IMPORT_TMP = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(IMPORT_TMP.name) / 'import.sqlite'}")

import backend.ocr_server as ocr_server


class FakeBookDb:
    def __init__(self) -> None:
        self.list_books_calls = 0
        self.list_focused_books_calls = 0
        self.sync_runs_calls = 0

    def list_books(self, *, status: str = "", reviewer_id: str = "", limit: int = 5000) -> dict:
        self.list_books_calls += 1
        return {
            "ok": True,
            "books": [
                {
                    "id": f"{status or 'all'}:{reviewer_id or 'all'}:{limit}:{self.list_books_calls}",
                    "title": "cached book",
                }
            ],
            "count": 1,
        }

    def list_oss_sync_runs(self, *, limit: int = 100) -> dict:
        self.sync_runs_calls += 1
        return {"runs": [{"id": f"sync-{self.sync_runs_calls}", "limit": limit}]}

    def list_focused_books(self, book_id: str, *, limit: int = 100) -> dict:
        self.list_focused_books_calls += 1
        return {
            "ok": True,
            "book": {"id": book_id, "title": "focused book"},
            "books": [
                {"id": book_id, "title": "focused book", "chunk_label": "part_0001_pages_0001-0070"},
                {"id": f"{book_id}:next", "title": "focused book", "chunk_label": "part_0002_pages_0071-0140"},
            ],
            "count": 2,
        }


def main() -> None:
    original_db = ocr_server.DB_SERVICE
    fake_db = FakeBookDb()
    ocr_server.DB_SERVICE = fake_db  # type: ignore[assignment]
    ocr_server._invalidate_books_list_cache()
    try:
        first = ocr_server._books_list_payload(limit=5000)
        first["books"][0]["title"] = "mutated by caller"
        second = ocr_server._books_list_payload(limit=5000)
        assert fake_db.list_books_calls == 1
        assert fake_db.sync_runs_calls == 1
        assert second["books"][0]["title"] == "cached book"
        assert second["syncRuns"][0]["id"] == "sync-1"

        filtered = ocr_server._books_list_payload(status="first_review", reviewer_id="门", limit=50)
        assert fake_db.list_books_calls == 2
        assert filtered["books"][0]["id"].startswith("first_review:门:50:")

        focused = ocr_server._focused_books_payload("book-1", limit=100)
        assert fake_db.list_books_calls == 2
        assert fake_db.list_focused_books_calls == 1
        assert focused["ok"] is True
        assert focused["book"]["id"] == "book-1"
        assert len(focused["books"]) == 2
        assert focused["syncRuns"][0]["id"] == "sync-3"

        ocr_server._invalidate_books_list_cache()
        third = ocr_server._books_list_payload(limit=5000)
        assert fake_db.list_books_calls == 3
        assert third["books"][0]["id"].endswith(":3")

        key = ocr_server._books_list_cache_key(limit="not-a-number")
        assert key == ("", "", 5000)
    finally:
        ocr_server.DB_SERVICE = original_db  # type: ignore[assignment]
        ocr_server._invalidate_books_list_cache()

    print("ocr server books cache tests ok")


if __name__ == "__main__":
    main()
