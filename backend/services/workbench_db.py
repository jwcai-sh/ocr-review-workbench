from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterator
from urllib.parse import urlparse

from backend.config import SETTINGS

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # noqa: BLE001
    psycopg = None
    dict_row = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, sort_keys=True)


BOOK_STATUS_VALUES = {"unreviewed", "first_review", "second_review", "needs_extra_correction", "completed"}
@dataclass(slots=True)
class WorkbenchDatabase:
    database_url: str
    enabled: bool = True
    error: str = ""

    def __post_init__(self) -> None:
        self.database_url = str(self.database_url or "").strip()
        if not self.database_url:
            self.enabled = False
            self.error = "DATABASE_URL is empty"
            return
        try:
            self.migrate()
        except Exception as error:  # noqa: BLE001
            self.enabled = False
            self.error = str(error)

    @property
    def backend(self) -> str:
        parsed = urlparse(self.database_url)
        if parsed.scheme in {"postgres", "postgresql"}:
            return "postgres"
        return "sqlite"

    @property
    def placeholder(self) -> str:
        return "%s" if self.backend == "postgres" else "?"

    @contextmanager
    def connect(self) -> Iterator[Any]:
        if self.backend == "postgres":
            if psycopg is None or dict_row is None:
                raise RuntimeError("psycopg is not installed; install psycopg[binary] for PostgreSQL DATABASE_URL")
            conn = psycopg.connect(self.database_url, row_factory=dict_row)
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
            return

        path = self.sqlite_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def sqlite_path(self) -> str:
        parsed = urlparse(self.database_url)
        if parsed.scheme == "sqlite":
            if parsed.netloc and parsed.path:
                return os.path.abspath(f"/{parsed.netloc}{parsed.path}")
            return os.path.abspath(parsed.path or "data/ocr_workbench.db")
        return os.path.abspath(self.database_url)

    def migrate(self) -> None:
        with self.connect() as conn:
            cur = conn.cursor()
            statements = [
                """
                CREATE TABLE IF NOT EXISTS books (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    parent_book_id TEXT NOT NULL DEFAULT '',
                    chunk_label TEXT NOT NULL DEFAULT '',
                    oss_pdf_key TEXT NOT NULL DEFAULT '',
                    oss_middle_key TEXT NOT NULL DEFAULT '',
                    oss_content_list_key TEXT NOT NULL DEFAULT '',
                    owner_user_id TEXT NOT NULL DEFAULT '',
                    first_reviewer_id TEXT NOT NULL DEFAULT '',
                    second_reviewer_id TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'unreviewed',
                    current_page INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS book_users (
                    book_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    created_by TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (book_id, user_id)
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS ocr_patches (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL,
                    patch_id TEXT NOT NULL,
                    block_id TEXT NOT NULL,
                    old_hash TEXT NOT NULL DEFAULT '',
                    new_text TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT 'human',
                    status TEXT NOT NULL DEFAULT 'draft',
                    created_by TEXT NOT NULL DEFAULT '',
                    updated_by TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    UNIQUE (book_id, patch_id)
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS review_marks (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL,
                    block_id TEXT NOT NULL,
                    page_no INTEGER NOT NULL DEFAULT 0,
                    mark_type TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    created_by TEXT NOT NULL DEFAULT '',
                    resolved_by TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    resolved_at TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS exports (
                    id TEXT PRIMARY KEY,
                    book_id TEXT NOT NULL,
                    export_type TEXT NOT NULL,
                    oss_key TEXT NOT NULL,
                    created_by TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                )
                """,
                "CREATE INDEX IF NOT EXISTS idx_books_status ON books(status)",
                "CREATE INDEX IF NOT EXISTS idx_books_reviewer ON books(first_reviewer_id, second_reviewer_id)",
                "CREATE INDEX IF NOT EXISTS idx_books_oss_middle ON books(oss_middle_key)",
                "CREATE INDEX IF NOT EXISTS idx_patches_book_status ON ocr_patches(book_id, status)",
                "CREATE INDEX IF NOT EXISTS idx_marks_book_status ON review_marks(book_id, status)",
                "CREATE INDEX IF NOT EXISTS idx_exports_book ON exports(book_id)",
            ]
            for statement in statements:
                cur.execute(statement)

    def health(self) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "backend": self.backend, "error": self.error}
        try:
            with self.connect() as conn:
                conn.cursor().execute("SELECT 1")
            return {"ok": True, "backend": self.backend, "error": None}
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "backend": self.backend, "error": str(error)}

    def upsert_oss_books(self, books: list[dict[str, Any]], *, owner_user_id: str = "") -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error, "count": 0}
        now = utc_now()
        placeholder = self.placeholder
        rows = [self._book_row_from_oss(item, owner_user_id=owner_user_id, now=now) for item in books]
        rows = [row for row in rows if row["id"]]
        if not rows:
            return {"ok": True, "count": 0}
        columns = [
            "id",
            "title",
            "mode",
            "parent_book_id",
            "chunk_label",
            "oss_pdf_key",
            "oss_middle_key",
            "oss_content_list_key",
            "owner_user_id",
            "status",
            "current_page",
            "created_at",
            "updated_at",
        ]
        values_sql = ", ".join([placeholder] * len(columns))
        update_columns = [column for column in columns if column not in {"id", "created_at"}]
        update_sql = ", ".join([f"{column}=excluded.{column}" for column in update_columns])
        sql = f"""
            INSERT INTO books ({", ".join(columns)})
            VALUES ({values_sql})
            ON CONFLICT(id) DO UPDATE SET {update_sql}
        """
        with self.connect() as conn:
            cur = conn.cursor()
            for row in rows:
                cur.execute(sql, [row[column] for column in columns])
                if row["owner_user_id"]:
                    self._upsert_book_user(cur, row["id"], row["owner_user_id"], "owner", row["owner_user_id"], now)
        return {"ok": True, "count": len(rows)}

    def _book_row_from_oss(self, item: dict[str, Any], *, owner_user_id: str, now: str) -> dict[str, Any]:
        book_id = str(item.get("workspaceId") or item.get("id") or item.get("middleKey") or "").strip()
        title = str(item.get("title") or item.get("label") or book_id or "Untitled").strip()
        mode = "chunk" if item.get("mode") == "chunked" else "whole_book"
        parent_book_id = f"book:{title}" if mode == "chunk" else ""
        return {
            "id": book_id,
            "title": title,
            "mode": mode,
            "parent_book_id": parent_book_id,
            "chunk_label": str(item.get("chunkLabel") or "").strip(),
            "oss_pdf_key": str(item.get("pdfKey") or "").strip(),
            "oss_middle_key": str(item.get("middleKey") or "").strip(),
            "oss_content_list_key": str(item.get("contentListKey") or "").strip(),
            "owner_user_id": str(owner_user_id or "").strip(),
            "status": str(item.get("status") or "unreviewed").strip() or "unreviewed",
            "current_page": int(item.get("currentPage") or 1),
            "created_at": now,
            "updated_at": now,
        }

    def _upsert_book_user(self, cur: Any, book_id: str, user_id: str, role: str, created_by: str, now: str) -> None:
        placeholder = self.placeholder
        cur.execute(
            f"""
            INSERT INTO book_users(book_id, user_id, role, created_by, created_at)
            VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})
            ON CONFLICT(book_id, user_id) DO UPDATE SET role=excluded.role
            """,
            [book_id, user_id, role, created_by, now],
        )

    def _sync_book_users(self, cur: Any, book_id: str, assignments: dict[str, str], *, created_by: str, now: str) -> None:
        placeholder = self.placeholder
        cur.execute(
            f"DELETE FROM book_users WHERE book_id = {placeholder} AND role IN ('owner', 'first_reviewer', 'second_reviewer')",
            [book_id],
        )
        for role, user_id in assignments.items():
            user_id = str(user_id or "").strip()
            if not user_id:
                continue
            self._upsert_book_user(cur, book_id, user_id, role, created_by or user_id, now)

    def list_books(self, *, status: str = "", reviewer_id: str = "", limit: int = 5000) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error, "books": []}
        clauses: list[str] = []
        params: list[Any] = []
        placeholder = self.placeholder
        if status:
            clauses.append(f"status = {placeholder}")
            params.append(status)
        if reviewer_id:
            clauses.append(f"(owner_user_id = {placeholder} OR first_reviewer_id = {placeholder} OR second_reviewer_id = {placeholder})")
            params.extend([reviewer_id, reviewer_id, reviewer_id])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT
              b.*,
              COALESCE(p.patch_count, 0) AS patch_count,
              COALESCE(p.accepted_patch_count, 0) AS accepted_patch_count,
              COALESCE(p.draft_patch_count, 0) AS draft_patch_count,
              COALESCE(m.needs_extra_correction_count, 0) AS needs_extra_correction_count
            FROM books b
            LEFT JOIN (
              SELECT
                book_id,
                COUNT(*) AS patch_count,
                SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_patch_count,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_patch_count
              FROM ocr_patches
              GROUP BY book_id
            ) p ON p.book_id = b.id
            LEFT JOIN (
              SELECT book_id, COUNT(*) AS needs_extra_correction_count
              FROM review_marks
              WHERE mark_type = 'needs_extra_correction' AND status = 'open'
              GROUP BY book_id
            ) m ON m.book_id = b.id
            {where}
            ORDER BY b.updated_at DESC, b.title ASC, b.chunk_label ASC
            LIMIT {int(limit)}
        """
        with self.connect() as conn:
            rows = conn.cursor().execute(sql, params).fetchall()
        books = [self._normalize_row(row) for row in rows]
        return {"ok": True, "books": books, "count": len(books)}

    def get_book(self, book_id: str) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        placeholder = self.placeholder
        with self.connect() as conn:
            row = conn.cursor().execute(f"SELECT * FROM books WHERE id = {placeholder}", [book_id]).fetchone()
        if not row:
            return {"ok": False, "error": "book_not_found"}
        return {"ok": True, "book": self._normalize_row(row)}

    def update_book(self, book_id: str, payload: dict[str, Any], *, user_id: str = "") -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        current = self.get_book(book_id)
        if not current.get("ok"):
            return current
        book = current["book"]
        updates = {
            "owner_user_id": str(payload.get("ownerUserId") or payload.get("owner_user_id") or book.get("owner_user_id") or "").strip(),
            "first_reviewer_id": str(payload.get("firstReviewerId") or payload.get("first_reviewer_id") or book.get("first_reviewer_id") or "").strip(),
            "second_reviewer_id": str(payload.get("secondReviewerId") or payload.get("second_reviewer_id") or book.get("second_reviewer_id") or "").strip(),
            "status": str(payload.get("status") or book.get("status") or "unreviewed").strip() or "unreviewed",
            "current_page": int(payload.get("currentPage") or payload.get("current_page") or book.get("current_page") or 1),
        }
        if updates["status"] not in BOOK_STATUS_VALUES:
            return {"ok": False, "error": "unsupported_book_status"}
        assignment_changed = any(
            updates[key] != str(book.get(key) or "").strip()
            for key in ("owner_user_id", "first_reviewer_id", "second_reviewer_id")
        )
        progress_changed = (
            updates["status"] != str(book.get("status") or "").strip()
            or updates["current_page"] != int(book.get("current_page") or 1)
        )
        if assignment_changed and user_id != SETTINGS.app_admin_user_id:
            return {"ok": False, "error": "permission_denied_admin_only"}
        if progress_changed:
            permission = self._write_permission(book, user_id)
            if not permission["ok"]:
                return permission
        now = utc_now()
        placeholder = self.placeholder
        with self.connect() as conn:
            cur = conn.cursor()
            cur.execute(
                f"""
                UPDATE books
                SET owner_user_id = {placeholder},
                    first_reviewer_id = {placeholder},
                    second_reviewer_id = {placeholder},
                    status = {placeholder},
                    current_page = {placeholder},
                    updated_at = {placeholder}
                WHERE id = {placeholder}
                """,
                [
                    updates["owner_user_id"],
                    updates["first_reviewer_id"],
                    updates["second_reviewer_id"],
                    updates["status"],
                    updates["current_page"],
                    now,
                    book_id,
                ],
            )
            self._sync_book_users(
                cur,
                book_id,
                {
                    "owner": updates["owner_user_id"],
                    "first_reviewer": updates["first_reviewer_id"],
                    "second_reviewer": updates["second_reviewer_id"],
                },
                created_by=user_id,
                now=now,
            )
        return self.get_book(book_id)

    def save_patch(self, book_id: str, patch: dict[str, Any], *, user_id: str = "") -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        patch_id = str(patch.get("patchId") or patch.get("patch_id") or "").strip()
        if not book_id or not patch_id:
            return {"ok": False, "error": "missing_book_id_or_patch_id"}
        book_result = self.get_book(book_id)
        if not book_result.get("ok"):
            return book_result
        permission = self._write_permission(book_result["book"], user_id)
        if not permission["ok"]:
            return permission
        now = utc_now()
        row = {
            "id": f"{book_id}:{patch_id}",
            "book_id": book_id,
            "patch_id": patch_id,
            "block_id": str(patch.get("blockId") or patch.get("block_id") or "").strip(),
            "old_hash": str(patch.get("oldHash") or patch.get("old_hash") or "").strip(),
            "new_text": str(patch.get("newText") or patch.get("new_text") or ""),
            "source": str(patch.get("source") or "human"),
            "status": str(patch.get("status") or "draft"),
            "created_by": str(patch.get("createdBy") or user_id or ""),
            "updated_by": str(patch.get("updatedBy") or user_id or ""),
            "created_at": str(patch.get("createdAt") or now),
            "updated_at": str(patch.get("updatedAt") or now),
            "metadata_json": _json_dumps(patch.get("metadata") or {}),
        }
        columns = list(row.keys())
        placeholder = self.placeholder
        values_sql = ", ".join([placeholder] * len(columns))
        update_columns = [column for column in columns if column not in {"id", "book_id", "patch_id", "created_at"}]
        update_sql = ", ".join([f"{column}=excluded.{column}" for column in update_columns])
        with self.connect() as conn:
            cur = conn.cursor()
            cur.execute(
                f"""
                INSERT INTO ocr_patches ({", ".join(columns)})
                VALUES ({values_sql})
                ON CONFLICT(book_id, patch_id) DO UPDATE SET {update_sql}
                """,
                [row[column] for column in columns],
            )
            self._touch_book_after_patch(cur, book_id, now)
        return {"ok": True, "patch": row}

    def update_patch_status(self, book_id: str, patch_id: str, status: str, *, user_id: str = "") -> dict[str, Any]:
        if status not in {"accepted", "rejected", "draft", "noop", "conflict"}:
            return {"ok": False, "error": "unsupported_status"}
        book_result = self.get_book(book_id)
        if not book_result.get("ok"):
            return book_result
        permission = self._write_permission(book_result["book"], user_id)
        if not permission["ok"]:
            return permission
        placeholder = self.placeholder
        now = utc_now()
        with self.connect() as conn:
            cur = conn.cursor()
            if status == "accepted":
                row = cur.execute(
                    f"SELECT block_id, old_hash FROM ocr_patches WHERE book_id = {placeholder} AND patch_id = {placeholder}",
                    [book_id, patch_id],
                ).fetchone()
                if row:
                    current = self._normalize_row(row)
                    cur.execute(
                        f"""
                        UPDATE ocr_patches
                        SET status = 'rejected', updated_at = {placeholder}, updated_by = {placeholder}
                        WHERE book_id = {placeholder}
                          AND patch_id <> {placeholder}
                          AND block_id = {placeholder}
                          AND old_hash = {placeholder}
                          AND status IN ('draft', 'accepted')
                        """,
                        [now, user_id, book_id, patch_id, current.get("block_id", ""), current.get("old_hash", "")],
                    )
            cur.execute(
                f"""
                UPDATE ocr_patches
                SET status = {placeholder}, updated_at = {placeholder}, updated_by = {placeholder}
                WHERE book_id = {placeholder} AND patch_id = {placeholder}
                """,
                [status, now, user_id, book_id, patch_id],
            )
            changed = cur.rowcount
            if changed:
                self._touch_book_after_patch(cur, book_id, now)
        return {"ok": changed > 0, "updated": changed}

    def list_patches(self, book_id: str) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error, "patches": []}
        placeholder = self.placeholder
        with self.connect() as conn:
            rows = conn.cursor().execute(
                f"SELECT * FROM ocr_patches WHERE book_id = {placeholder} ORDER BY created_at, patch_id",
                [book_id],
            ).fetchall()
        return {"ok": True, "patches": [self._patch_from_row(row) for row in rows]}

    def get_state(self, book_id: str) -> dict[str, Any]:
        book = self.get_book(book_id)
        if not book.get("ok"):
            return book
        patches = self.list_patches(book_id)
        marks = self.list_review_marks(book_id)
        return {
            "ok": True,
            "book": book["book"],
            "ocrPatches": patches.get("patches", []),
            "reviewMarks": marks.get("reviewMarks", []),
        }

    def save_review_mark(self, book_id: str, mark: dict[str, Any], *, user_id: str = "") -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        block_id = str(mark.get("blockId") or mark.get("block_id") or "").strip()
        mark_type = str(mark.get("markType") or mark.get("mark_type") or "needs_extra_correction").strip()
        status = str(mark.get("status") or "open").strip()
        if not book_id or not block_id:
            return {"ok": False, "error": "missing_book_id_or_block_id"}
        book_result = self.get_book(book_id)
        if not book_result.get("ok"):
            return book_result
        permission = self._write_permission(book_result["book"], user_id)
        if not permission["ok"]:
            return permission
        if mark_type != "needs_extra_correction":
            return {"ok": False, "error": "unsupported_mark_type"}
        if status not in {"open", "resolved"}:
            return {"ok": False, "error": "unsupported_mark_status"}
        now = utc_now()
        placeholder = self.placeholder
        page_no = int(mark.get("pageNo") or mark.get("page_no") or 0)
        mark_id = f"{book_id}:{mark_type}:{block_id}"
        metadata = mark.get("metadata") if isinstance(mark.get("metadata"), dict) else {}
        with self.connect() as conn:
            cur = conn.cursor()
            if status == "open":
                cur.execute(
                    f"""
                    INSERT INTO review_marks(
                        id, book_id, block_id, page_no, mark_type, status,
                        created_by, resolved_by, created_at, resolved_at, metadata_json
                    )
                    VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, '', {placeholder}, '', {placeholder})
                    ON CONFLICT(id) DO UPDATE SET
                        status='open',
                        resolved_by='',
                        resolved_at='',
                        metadata_json=excluded.metadata_json
                    """,
                    [mark_id, book_id, block_id, page_no, mark_type, status, user_id, now, _json_dumps(metadata)],
                )
            else:
                cur.execute(
                    f"""
                    UPDATE review_marks
                    SET status='resolved', resolved_by={placeholder}, resolved_at={placeholder}
                    WHERE id={placeholder}
                    """,
                    [user_id, now, mark_id],
                )
                if cur.rowcount == 0:
                    cur.execute(
                        f"""
                        INSERT INTO review_marks(
                            id, book_id, block_id, page_no, mark_type, status,
                            created_by, resolved_by, created_at, resolved_at, metadata_json
                        )
                        VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, 'resolved', '', {placeholder}, {placeholder}, {placeholder}, {placeholder})
                        """,
                        [mark_id, book_id, block_id, page_no, mark_type, user_id, now, now, _json_dumps(metadata)],
                    )
            self._touch_book_after_mark(cur, book_id, now, status)
        return {
            "ok": True,
            "reviewMark": {
                "blockId": block_id,
                "pageNo": page_no,
                "markType": mark_type,
                "status": status,
                "updatedAt": now,
            },
        }

    def list_review_marks(self, book_id: str) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error, "reviewMarks": []}
        placeholder = self.placeholder
        with self.connect() as conn:
            rows = conn.cursor().execute(
                f"SELECT * FROM review_marks WHERE book_id = {placeholder} ORDER BY created_at, block_id",
                [book_id],
            ).fetchall()
        return {"ok": True, "reviewMarks": [self._review_mark_from_row(row) for row in rows]}

    def _touch_book_after_patch(self, cur: Any, book_id: str, now: str) -> None:
        placeholder = self.placeholder
        cur.execute(
            f"""
            UPDATE books
            SET
                status = CASE WHEN status = 'unreviewed' THEN 'first_review' ELSE status END,
                updated_at = {placeholder}
            WHERE id = {placeholder}
            """,
            [now, book_id],
        )

    def _touch_book_after_mark(self, cur: Any, book_id: str, now: str, status: str) -> None:
        placeholder = self.placeholder
        next_status = "needs_extra_correction" if status == "open" else self._resume_status_after_mark_resolved(cur, book_id)
        cur.execute(
            f"""
            UPDATE books
            SET
                status = CASE
                    WHEN status = 'completed' THEN status
                    ELSE {placeholder}
                END,
                updated_at = {placeholder}
            WHERE id = {placeholder}
            """,
            [next_status, now, book_id],
        )

    def _resume_status_after_mark_resolved(self, cur: Any, book_id: str) -> str:
        placeholder = self.placeholder
        row = cur.execute(
            f"SELECT owner_user_id, first_reviewer_id, second_reviewer_id, status FROM books WHERE id = {placeholder}",
            [book_id],
        ).fetchone()
        data = self._normalize_row(row)
        if data.get("status") == "completed":
            return "completed"
        if data.get("second_reviewer_id"):
            return "second_review"
        if data.get("first_reviewer_id") or data.get("owner_user_id"):
            return "first_review"
        return "unreviewed"

    def _write_permission(self, book: dict[str, Any], user_id: str) -> dict[str, Any]:
        reviewer = str(user_id or "").strip()
        owner = str((book or {}).get("owner_user_id") or "").strip()
        if not reviewer:
            return {"ok": False, "error": "missing_user_id"}
        if not owner:
            return {"ok": False, "error": "book_not_assigned"}
        if reviewer != owner:
            return {
                "ok": False,
                "error": "permission_denied_not_owner",
                "ownerUserId": owner,
            }
        return {"ok": True}

    def _review_mark_from_row(self, row: Any) -> dict[str, Any]:
        data = self._normalize_row(row)
        try:
            metadata = json.loads(data.get("metadata_json") or "{}")
        except Exception:  # noqa: BLE001
            metadata = {}
        return {
            "blockId": data.get("block_id", ""),
            "pageNo": data.get("page_no", 0),
            "markType": data.get("mark_type", ""),
            "status": data.get("status", ""),
            "createdBy": data.get("created_by", ""),
            "resolvedBy": data.get("resolved_by", ""),
            "createdAt": data.get("created_at", ""),
            "resolvedAt": data.get("resolved_at", ""),
            "metadata": metadata,
        }

    def _patch_from_row(self, row: Any) -> dict[str, Any]:
        data = self._normalize_row(row)
        try:
            metadata = json.loads(data.get("metadata_json") or "{}")
        except Exception:  # noqa: BLE001
            metadata = {}
        return {
            "patchId": data.get("patch_id", ""),
            "blockId": data.get("block_id", ""),
            "oldHash": data.get("old_hash", ""),
            "newText": data.get("new_text", ""),
            "source": data.get("source", "human"),
            "status": data.get("status", "draft"),
            "createdAt": data.get("created_at", ""),
            "updatedAt": data.get("updated_at", ""),
            "metadata": metadata,
        }

    def _normalize_row(self, row: Any) -> dict[str, Any]:
        if row is None:
            return {}
        if isinstance(row, dict):
            return dict(row)
        return {key: row[key] for key in row.keys()}


DB_SERVICE = WorkbenchDatabase(SETTINGS.database_url)
