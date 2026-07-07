from __future__ import annotations

import tempfile
import sys
import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

IMPORT_TMP = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(IMPORT_TMP.name) / 'import.sqlite'}")
os.environ.setdefault("APP_ADMIN_USER_ID", "门")

from backend.services.workbench_db import WorkbenchDatabase


def assert_true(value: object, message: str) -> None:
    if not value:
        raise AssertionError(message)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "workbench.sqlite"
        db = WorkbenchDatabase(f"sqlite:///{db_path}")
        assert_true(db.enabled, db.error or "database should be enabled")

        sync = db.upsert_oss_books(
            [
                {
                    "id": "oss:books/book-a/auto/book-a_middle.json",
                    "title": "Book A",
                    "mode": "whole-book",
                    "pdfKey": "books/book-a/auto/book-a_origin.pdf",
                    "middleKey": "books/book-a/auto/book-a_middle.json",
                    "contentListKey": "books/book-a/auto/book-a_content_list.json",
                },
                {
                    "id": "oss:books/book-b/chunks/part-0001/book-b_middle.json",
                    "title": "Book B",
                    "mode": "chunked",
                    "chunkLabel": "part-0001",
                    "pdfKey": "books/book-b/chunks/part-0001/book-b_origin.pdf",
                    "middleKey": "books/book-b/chunks/part-0001/book-b_middle.json",
                },
            ],
            owner_user_id="reviewer-a",
        )
        assert_true(sync["ok"], "OSS book sync should succeed")
        assert_true(sync["count"] == 2, "two OSS books should be synced")

        books = db.list_books()
        assert_true(books["ok"], "book list should succeed")
        assert_true(len(books["books"]) == 2, "book list should contain two rows")
        first = db.get_book("oss:books/book-a/auto/book-a_middle.json")
        assert_true(first["ok"], "synced book should be readable")
        assert_true(first["book"]["owner_user_id"] == "reviewer-a", "owner should be persisted")

        updated_book = db.update_book(
            first["book"]["id"],
            {
                "ownerUserId": "owner-1",
                "firstReviewerId": "reviewer-1",
                "secondReviewerId": "reviewer-2",
            },
            user_id="门",
        )
        assert_true(updated_book["ok"], "book update should succeed")
        assert_true(updated_book["book"]["first_reviewer_id"] == "reviewer-1", "first reviewer should be updated")
        assert_true(updated_book["book"]["second_reviewer_id"] == "reviewer-2", "second reviewer should be updated")

        owner_progress = db.update_book(
            first["book"]["id"],
            {
                "status": "second_review",
                "currentPage": 7,
            },
            user_id="owner-1",
        )
        assert_true(owner_progress["ok"], "owner progress update should succeed")
        assert_true(owner_progress["book"]["status"] == "second_review", "status should be updated")
        assert_true(owner_progress["book"]["current_page"] == 7, "current page should be updated")

        forbidden_assignment = db.update_book(
            first["book"]["id"],
            {"ownerUserId": "reviewer-b"},
            user_id="reviewer-a",
        )
        assert_true(forbidden_assignment["ok"] is False, "non-admin assignment update should be rejected")
        assert_true(forbidden_assignment["error"] == "permission_denied_admin_only", "assignment should require admin")

        patch = {
            "patchId": "patch-1",
            "blockId": "1:3",
            "oldHash": "abc123",
            "newText": "corrected markdown",
            "source": "human",
            "status": "draft",
            "metadata": {"pageNo": 1},
        }
        saved = db.save_patch(first["book"]["id"], patch, user_id="owner-1")
        assert_true(saved["ok"], "patch save should succeed")
        forbidden_patch = db.save_patch(first["book"]["id"], {**patch, "patchId": "patch-2"}, user_id="reviewer-a")
        assert_true(forbidden_patch["ok"] is False, "non-owner patch save should be rejected")
        assert_true(forbidden_patch["error"] == "permission_denied_not_owner", "patch save should require owner")
        accepted = db.update_patch_status(first["book"]["id"], "patch-1", "accepted", user_id="owner-1")
        assert_true(accepted["ok"], "patch status update should succeed")

        mark = db.save_review_mark(
            first["book"]["id"],
            {"blockId": "1:3", "pageNo": 1, "markType": "needs_extra_correction", "status": "open"},
            user_id="owner-1",
        )
        assert_true(mark["ok"], "review mark save should succeed")
        forbidden_mark = db.save_review_mark(
            first["book"]["id"],
            {"blockId": "1:4", "pageNo": 1, "markType": "needs_extra_correction", "status": "open"},
            user_id="reviewer-a",
        )
        assert_true(forbidden_mark["ok"] is False, "non-owner mark save should be rejected")
        assert_true(forbidden_mark["error"] == "permission_denied_not_owner", "review mark should require owner")

        state = db.get_state(first["book"]["id"])
        assert_true(state["ok"], "book state should be readable")
        assert_true(state["ocrPatches"][0]["status"] == "accepted", "accepted patch should be restored")
        assert_true(state["reviewMarks"][0]["status"] == "open", "open review mark should be restored")

        listed = db.list_books()
        row = next(item for item in listed["books"] if item["id"] == first["book"]["id"])
        assert_true(row["accepted_patch_count"] == 1, "accepted patch count should be reported")
        assert_true(row["needs_extra_correction_count"] == 1, "open review mark count should be reported")
        assert_true(row["status"] == "needs_extra_correction", "book status should reflect open review mark")

        resolved = db.save_review_mark(
            first["book"]["id"],
            {"blockId": "1:3", "pageNo": 1, "markType": "needs_extra_correction", "status": "resolved"},
            user_id="owner-1",
        )
        assert_true(resolved["ok"], "review mark resolve should succeed")
        state_after_resolve = db.get_state(first["book"]["id"])
        assert_true(state_after_resolve["reviewMarks"][0]["status"] == "resolved", "resolved mark should be restored")
        resumed_book = db.get_book(first["book"]["id"])
        assert_true(resumed_book["book"]["status"] == "second_review", "resolved mark should resume second review when second reviewer exists")

        admin_patch = db.save_patch(
            first["book"]["id"],
            {**patch, "patchId": "patch-admin", "blockId": "1:4", "newText": "admin corrected markdown"},
            user_id="门",
        )
        assert_true(admin_patch["ok"], "admin should save patches for another owner")
        admin_accepted = db.update_patch_status(first["book"]["id"], "patch-admin", "accepted", user_id="门")
        assert_true(admin_accepted["ok"], "admin should update patch status for another owner")
        admin_mark = db.save_review_mark(
            first["book"]["id"],
            {"blockId": "1:4", "pageNo": 1, "markType": "needs_extra_correction", "status": "open"},
            user_id="门",
        )
        assert_true(admin_mark["ok"], "admin should save review marks for another owner")

    print("workbench db ok")


if __name__ == "__main__":
    main()
