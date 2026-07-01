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
                """
                CREATE TABLE IF NOT EXISTS oss_sync_runs (
                    id TEXT PRIMARY KEY,
                    prefix TEXT NOT NULL,
                    mode TEXT NOT NULL DEFAULT 'incremental',
                    status TEXT NOT NULL,
                    scanned_count INTEGER NOT NULL DEFAULT 0,
                    key_count INTEGER NOT NULL DEFAULT 0,
                    changed_key_count INTEGER NOT NULL DEFAULT 0,
                    books_found INTEGER NOT NULL DEFAULT 0,
                    db_sync_count INTEGER NOT NULL DEFAULT 0,
                    error TEXT NOT NULL DEFAULT '',
                    started_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL DEFAULT ''
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS oss_sync_objects (
                    prefix TEXT NOT NULL,
                    object_key TEXT NOT NULL,
                    etag TEXT NOT NULL DEFAULT '',
                    last_modified TEXT NOT NULL DEFAULT '',
                    size INTEGER NOT NULL DEFAULT 0,
                    seen_at TEXT NOT NULL,
                    PRIMARY KEY (prefix, object_key)
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS oss_book_assignments (
                    id TEXT PRIMARY KEY,
                    category_title TEXT NOT NULL,
                    book_title TEXT NOT NULL,
                    book_prefix TEXT NOT NULL DEFAULT '',
                    owner_user_id TEXT NOT NULL DEFAULT '',
                    first_reviewer_id TEXT NOT NULL DEFAULT '',
                    second_reviewer_id TEXT NOT NULL DEFAULT '',
                    created_by TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (category_title, book_title)
                )
                """,
                "CREATE INDEX IF NOT EXISTS idx_books_status ON books(status)",
                "CREATE INDEX IF NOT EXISTS idx_books_reviewer ON books(first_reviewer_id, second_reviewer_id)",
                "CREATE INDEX IF NOT EXISTS idx_books_oss_middle ON books(oss_middle_key)",
                "CREATE INDEX IF NOT EXISTS idx_patches_book_status ON ocr_patches(book_id, status)",
                "CREATE INDEX IF NOT EXISTS idx_marks_book_status ON review_marks(book_id, status)",
                "CREATE INDEX IF NOT EXISTS idx_exports_book ON exports(book_id)",
                "CREATE INDEX IF NOT EXISTS idx_oss_sync_runs_prefix ON oss_sync_runs(prefix, started_at)",
                "CREATE INDEX IF NOT EXISTS idx_oss_sync_objects_seen ON oss_sync_objects(prefix, seen_at)",
                "CREATE INDEX IF NOT EXISTS idx_oss_book_assignments_owner ON oss_book_assignments(owner_user_id)",
            ]
            for statement in statements:
                cur.execute(statement)
            self._ensure_column(cur, "books", "first_reviewer_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(cur, "books", "second_reviewer_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(cur, "oss_book_assignments", "first_reviewer_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(cur, "oss_book_assignments", "second_reviewer_id", "TEXT NOT NULL DEFAULT ''")

    def _ensure_column(self, cur: Any, table: str, column: str, definition: str) -> None:
        placeholder = self.placeholder
        if self.backend == "postgres":
            cur.execute(
                f"""
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = {placeholder} AND column_name = {placeholder}
                """,
                [table, column],
            )
            exists = cur.fetchone() is not None
        else:
            cur.execute(f"PRAGMA table_info({table})")
            exists = any(str(row[1]) == column for row in cur.fetchall())
        if not exists:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

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
            "first_reviewer_id",
            "second_reviewer_id",
            "status",
            "current_page",
            "created_at",
            "updated_at",
        ]
        values_sql = ", ".join([placeholder] * len(columns))
        update_sql = """
            title=excluded.title,
            mode=excluded.mode,
            parent_book_id=excluded.parent_book_id,
            chunk_label=excluded.chunk_label,
            oss_pdf_key=excluded.oss_pdf_key,
            oss_middle_key=excluded.oss_middle_key,
            oss_content_list_key=excluded.oss_content_list_key,
            owner_user_id=CASE
                WHEN excluded.owner_user_id <> '' THEN excluded.owner_user_id
                ELSE books.owner_user_id
            END,
            first_reviewer_id=CASE
                WHEN excluded.first_reviewer_id <> '' THEN excluded.first_reviewer_id
                ELSE books.first_reviewer_id
            END,
            second_reviewer_id=CASE
                WHEN excluded.second_reviewer_id <> '' THEN excluded.second_reviewer_id
                ELSE books.second_reviewer_id
            END,
            status=CASE
                WHEN books.status <> '' THEN books.status
                ELSE excluded.status
            END,
            current_page=CASE
                WHEN books.current_page > 0 THEN books.current_page
                ELSE excluded.current_page
            END,
            updated_at=excluded.updated_at
        """
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
                if row["first_reviewer_id"]:
                    self._upsert_book_user(cur, row["id"], row["first_reviewer_id"], "first_reviewer", row["first_reviewer_id"], now)
                if row["second_reviewer_id"]:
                    self._upsert_book_user(cur, row["id"], row["second_reviewer_id"], "second_reviewer", row["second_reviewer_id"], now)
        return {"ok": True, "count": len(rows)}

    def begin_oss_sync_run(self, *, prefix: str, mode: str = "incremental") -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        now = utc_now()
        run_id = f"oss-sync:{now}:{os.urandom(4).hex()}"
        placeholder = self.placeholder
        with self.connect() as conn:
            conn.cursor().execute(
                f"""
                INSERT INTO oss_sync_runs(id, prefix, mode, status, started_at)
                VALUES ({placeholder}, {placeholder}, {placeholder}, 'running', {placeholder})
                """,
                [run_id, prefix, mode, now],
            )
        return {"ok": True, "id": run_id, "prefix": prefix, "mode": mode, "startedAt": now}

    def changed_oss_sync_entries(self, *, prefix: str, entries: list[dict[str, Any]], force: bool = False) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error, "entries": entries}
        if force:
            return {"ok": True, "entries": entries, "changedCount": len(entries), "unchangedCount": 0}
        placeholder = self.placeholder
        changed: list[dict[str, Any]] = []
        with self.connect() as conn:
            cur = conn.cursor()
            for entry in entries:
                key = str(entry.get("key") or "")
                row = cur.execute(
                    f"""
                    SELECT etag, last_modified, size
                    FROM oss_sync_objects
                    WHERE prefix = {placeholder} AND object_key = {placeholder}
                    """,
                    [prefix, key],
                ).fetchone()
                old = self._normalize_row(row)
                if (
                    not old
                    or str(old.get("etag") or "") != str(entry.get("etag") or "")
                    or str(old.get("last_modified") or "") != str(entry.get("lastModified") or "")
                    or int(old.get("size") or 0) != int(entry.get("size") or 0)
                ):
                    changed.append(entry)
        return {
            "ok": True,
            "entries": changed,
            "changedCount": len(changed),
            "unchangedCount": max(0, len(entries) - len(changed)),
        }

    def finish_oss_sync_run(
        self,
        run_id: str,
        *,
        prefix: str,
        entries: list[dict[str, Any]],
        status: str,
        scanned_count: int,
        key_count: int,
        changed_key_count: int,
        books_found: int,
        db_sync_count: int,
        error: str = "",
    ) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        now = utc_now()
        placeholder = self.placeholder
        with self.connect() as conn:
            cur = conn.cursor()
            for entry in entries:
                cur.execute(
                    f"""
                    INSERT INTO oss_sync_objects(prefix, object_key, etag, last_modified, size, seen_at)
                    VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})
                    ON CONFLICT(prefix, object_key) DO UPDATE SET
                        etag=excluded.etag,
                        last_modified=excluded.last_modified,
                        size=excluded.size,
                        seen_at=excluded.seen_at
                    """,
                    [
                        prefix,
                        str(entry.get("key") or ""),
                        str(entry.get("etag") or ""),
                        str(entry.get("lastModified") or ""),
                        int(entry.get("size") or 0),
                        now,
                    ],
                )
            cur.execute(
                f"""
                UPDATE oss_sync_runs
                SET status = {placeholder},
                    scanned_count = {placeholder},
                    key_count = {placeholder},
                    changed_key_count = {placeholder},
                    books_found = {placeholder},
                    db_sync_count = {placeholder},
                    error = {placeholder},
                    completed_at = {placeholder}
                WHERE id = {placeholder}
                """,
                [
                    status,
                    int(scanned_count),
                    int(key_count),
                    int(changed_key_count),
                    int(books_found),
                    int(db_sync_count),
                    error,
                    now,
                    run_id,
                ],
            )
        return {"ok": True, "id": run_id, "completedAt": now}

    def list_oss_sync_runs(self, *, limit: int = 100) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error, "runs": []}
        with self.connect() as conn:
            rows = conn.cursor().execute(
                f"""
                SELECT *
                FROM oss_sync_runs
                ORDER BY started_at DESC
                LIMIT {int(limit)}
                """
            ).fetchall()
        return {"ok": True, "runs": [self._sync_run_from_row(row) for row in rows], "count": len(rows)}

    def list_oss_book_assignments(self) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error, "assignments": []}
        with self.connect() as conn:
            rows = conn.cursor().execute(
                """
                SELECT *
                FROM oss_book_assignments
                ORDER BY category_title ASC, book_title ASC
                """
            ).fetchall()
        return {"ok": True, "assignments": [self._normalize_row(row) for row in rows], "count": len(rows)}

    def upsert_oss_book_assignment(self, payload: dict[str, Any], *, user_id: str = "") -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        if user_id != SETTINGS.app_admin_user_id:
            return {"ok": False, "error": "permission_denied_admin_only"}
        category_title = str(payload.get("categoryTitle") or payload.get("category_title") or "").strip()
        book_title = str(payload.get("bookTitle") or payload.get("book_title") or "").strip()
        book_prefix = str(payload.get("bookPrefix") or payload.get("book_prefix") or "").strip()
        owner_user_id = str(payload.get("ownerUserId") or payload.get("owner_user_id") or "").strip()
        first_reviewer_id = str(payload.get("firstReviewerId") or payload.get("first_reviewer_id") or "").strip()
        second_reviewer_id = str(payload.get("secondReviewerId") or payload.get("second_reviewer_id") or "").strip()
        if first_reviewer_id and not owner_user_id:
            owner_user_id = first_reviewer_id
        if not category_title or not book_title:
            return {"ok": False, "error": "missing_category_or_book_title"}
        now = utc_now()
        assignment_id = f"oss-book:{category_title}:{book_title}"
        placeholder = self.placeholder
        with self.connect() as conn:
            conn.cursor().execute(
                f"""
                INSERT INTO oss_book_assignments(
                    id, category_title, book_title, book_prefix,
                    owner_user_id, first_reviewer_id, second_reviewer_id,
                    created_by, created_at, updated_at
                )
                VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})
                ON CONFLICT(category_title, book_title) DO UPDATE SET
                    book_prefix=excluded.book_prefix,
                    owner_user_id=excluded.owner_user_id,
                    first_reviewer_id=excluded.first_reviewer_id,
                    second_reviewer_id=excluded.second_reviewer_id,
                    updated_at=excluded.updated_at
                """,
                [
                    assignment_id,
                    category_title,
                    book_title,
                    book_prefix,
                    owner_user_id,
                    first_reviewer_id,
                    second_reviewer_id,
                    user_id,
                    now,
                    now,
                ],
            )
        return self.get_oss_book_assignment(category_title=category_title, book_title=book_title)

    def bulk_upsert_oss_book_assignments(self, assignments: list[dict[str, Any]], *, user_id: str = "") -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        if user_id != SETTINGS.app_admin_user_id:
            return {"ok": False, "error": "permission_denied_admin_only"}
        now = utc_now()
        placeholder = self.placeholder
        rows: list[dict[str, str]] = []
        for payload in assignments:
            if not isinstance(payload, dict):
                return {"ok": False, "error": "invalid_assignment_item"}
            category_title = str(payload.get("categoryTitle") or payload.get("category_title") or "").strip()
            book_title = str(payload.get("bookTitle") or payload.get("book_title") or "").strip()
            book_prefix = str(payload.get("bookPrefix") or payload.get("book_prefix") or "").strip()
            owner_user_id = str(payload.get("ownerUserId") or payload.get("owner_user_id") or "").strip()
            first_reviewer_id = str(payload.get("firstReviewerId") or payload.get("first_reviewer_id") or "").strip()
            second_reviewer_id = str(payload.get("secondReviewerId") or payload.get("second_reviewer_id") or "").strip()
            if first_reviewer_id and not owner_user_id:
                owner_user_id = first_reviewer_id
            if not category_title or not book_title:
                return {"ok": False, "error": "missing_category_or_book_title"}
            rows.append(
                {
                    "id": f"oss-book:{category_title}:{book_title}",
                    "category_title": category_title,
                    "book_title": book_title,
                    "book_prefix": book_prefix,
                    "owner_user_id": owner_user_id,
                    "first_reviewer_id": first_reviewer_id,
                    "second_reviewer_id": second_reviewer_id,
                },
            )
        with self.connect() as conn:
            cur = conn.cursor()
            for row in rows:
                cur.execute(
                    f"""
                    INSERT INTO oss_book_assignments(
                        id, category_title, book_title, book_prefix,
                        owner_user_id, first_reviewer_id, second_reviewer_id,
                        created_by, created_at, updated_at
                    )
                    VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})
                    ON CONFLICT(category_title, book_title) DO UPDATE SET
                        book_prefix=excluded.book_prefix,
                        owner_user_id=excluded.owner_user_id,
                        first_reviewer_id=excluded.first_reviewer_id,
                        second_reviewer_id=excluded.second_reviewer_id,
                        updated_at=excluded.updated_at
                    """,
                    [
                        row["id"],
                        row["category_title"],
                        row["book_title"],
                        row["book_prefix"],
                        row["owner_user_id"],
                        row["first_reviewer_id"],
                        row["second_reviewer_id"],
                        user_id,
                        now,
                        now,
                    ],
                )
        return {"ok": True, "assignments": rows, "count": len(rows)}

    def get_oss_book_assignment(self, *, category_title: str, book_title: str) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        placeholder = self.placeholder
        with self.connect() as conn:
            row = conn.cursor().execute(
                f"""
                SELECT *
                FROM oss_book_assignments
                WHERE category_title = {placeholder} AND book_title = {placeholder}
                """,
                [str(category_title or "").strip(), str(book_title or "").strip()],
            ).fetchone()
        if not row:
            return {"ok": False, "error": "assignment_not_found"}
        return {"ok": True, "assignment": self._normalize_row(row)}

    def owner_for_oss_book(self, *, category_title: str, book_title: str) -> str:
        result = self.get_oss_book_assignment(category_title=category_title, book_title=book_title)
        if not result.get("ok"):
            return ""
        return str((result.get("assignment") or {}).get("owner_user_id") or "").strip()

    def assignment_for_oss_book(self, *, category_title: str, book_title: str) -> dict[str, Any]:
        result = self.get_oss_book_assignment(category_title=category_title, book_title=book_title)
        if not result.get("ok"):
            return {}
        return result.get("assignment") or {}

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
            "owner_user_id": str(owner_user_id or item.get("ownerUserId") or item.get("owner_user_id") or "").strip(),
            "first_reviewer_id": str(item.get("firstReviewerId") or item.get("first_reviewer_id") or "").strip(),
            "second_reviewer_id": str(item.get("secondReviewerId") or item.get("second_reviewer_id") or "").strip(),
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
        is_admin = user_id == SETTINGS.app_admin_user_id
        if assignment_changed and not is_admin:
            return {"ok": False, "error": "permission_denied_admin_only"}
        if progress_changed and not (is_admin and assignment_changed):
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

    def bulk_update_books(self, updates_payload: list[dict[str, Any]], *, user_id: str = "") -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": self.error}
        normalized_payloads: list[tuple[str, dict[str, Any]]] = []
        for payload in updates_payload:
            if not isinstance(payload, dict):
                return {"ok": False, "error": "invalid_update_item"}
            book_id = str(payload.get("bookId") or payload.get("book_id") or payload.get("id") or "").strip()
            if not book_id:
                return {"ok": False, "error": "missing_book_id"}
            normalized_payloads.append((book_id, payload))
        if not normalized_payloads:
            return {"ok": False, "error": "missing_updates"}
        placeholder = self.placeholder
        ids = [book_id for book_id, _payload in normalized_payloads]
        unique_ids = list(dict.fromkeys(ids))
        placeholders = ", ".join([placeholder] * len(unique_ids))
        with self.connect() as conn:
            cur = conn.cursor()
            rows = cur.execute(f"SELECT * FROM books WHERE id IN ({placeholders})", unique_ids).fetchall()
            books_by_id = {str(row["id"]): self._normalize_row(row) for row in rows}
            missing_ids = [book_id for book_id in unique_ids if book_id not in books_by_id]
            if missing_ids:
                return {"ok": False, "error": "book_not_found", "bookId": missing_ids[0]}
            is_admin = user_id == SETTINGS.app_admin_user_id
            now = utc_now()
            changed_ids: list[str] = []
            for book_id, payload in normalized_payloads:
                book = books_by_id[book_id]
                updates = self._book_updates_from_payload(book, payload)
                permission_error = self._validate_book_update_permission(book, updates, user_id=user_id, is_admin=is_admin)
                if permission_error:
                    return {**permission_error, "bookId": book_id, "updatedCount": len(changed_ids)}
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
                books_by_id[book_id] = {**book, **updates, "updated_at": now}
                changed_ids.append(book_id)
            changed_unique_ids = list(dict.fromkeys(changed_ids))
            changed_placeholders = ", ".join([placeholder] * len(changed_unique_ids))
            updated_rows = cur.execute(f"SELECT * FROM books WHERE id IN ({changed_placeholders})", changed_unique_ids).fetchall()
        books = [self._normalize_row(row) for row in updated_rows]
        return {"ok": True, "books": books, "count": len(books)}

    def _book_updates_from_payload(self, book: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        owner_user_id = str(payload.get("ownerUserId") or payload.get("owner_user_id") or book.get("owner_user_id") or "").strip()
        first_reviewer_id = str(payload.get("firstReviewerId") or payload.get("first_reviewer_id") or book.get("first_reviewer_id") or "").strip()
        second_reviewer_id = str(payload.get("secondReviewerId") or payload.get("second_reviewer_id") or book.get("second_reviewer_id") or "").strip()
        if first_reviewer_id and not owner_user_id:
            owner_user_id = first_reviewer_id
        return {
            "owner_user_id": owner_user_id,
            "first_reviewer_id": first_reviewer_id,
            "second_reviewer_id": second_reviewer_id,
            "status": str(payload.get("status") or book.get("status") or "unreviewed").strip() or "unreviewed",
            "current_page": int(payload.get("currentPage") or payload.get("current_page") or book.get("current_page") or 1),
        }

    def _validate_book_update_permission(
        self,
        book: dict[str, Any],
        updates: dict[str, Any],
        *,
        user_id: str,
        is_admin: bool,
    ) -> dict[str, Any]:
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
        if assignment_changed and not is_admin:
            return {"ok": False, "error": "permission_denied_admin_only"}
        if progress_changed and not (is_admin and assignment_changed):
            permission = self._write_permission(book, user_id)
            if not permission["ok"]:
                return permission
        return {}

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

    def _sync_run_from_row(self, row: Any) -> dict[str, Any]:
        data = self._normalize_row(row)
        return {
            "id": data.get("id", ""),
            "prefix": data.get("prefix", ""),
            "mode": data.get("mode", "incremental"),
            "status": data.get("status", ""),
            "scannedCount": int(data.get("scanned_count") or 0),
            "keyCount": int(data.get("key_count") or 0),
            "changedKeyCount": int(data.get("changed_key_count") or 0),
            "booksFound": int(data.get("books_found") or 0),
            "dbSyncCount": int(data.get("db_sync_count") or 0),
            "error": data.get("error", ""),
            "startedAt": data.get("started_at", ""),
            "completedAt": data.get("completed_at", ""),
        }

    def _normalize_row(self, row: Any) -> dict[str, Any]:
        if row is None:
            return {}
        if isinstance(row, dict):
            return dict(row)
        return {key: row[key] for key in row.keys()}


DB_SERVICE = WorkbenchDatabase(SETTINGS.database_url)
