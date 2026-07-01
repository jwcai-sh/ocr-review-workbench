from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import posixpath
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from backend.config import SETTINGS
from backend.services.mathpix_ocr import MATHPIX_OCR_SERVICE
from backend.services.ocr_correction import OCR_CORRECTION_SERVICE
from backend.services.ocr_preview import OCR_PREVIEW_SERVICE
from backend.services.oss_storage import OSS_STORAGE_SERVICE
from backend.services.workbench_db import DB_SERVICE

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
DEFAULT_OSS_SYNC_LIMIT = 200000
DEFAULT_OSS_BOOKS_PREFIX = "books-raw/"
SESSION_COOKIE_NAME = "ocr_workbench_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14
OSS_SYNC_JOBS: dict[str, dict] = {}
OSS_SYNC_JOBS_LOCK = threading.Lock()


class OcrWorkbenchHandler(BaseHTTPRequestHandler):
    server_version = "OcrWorkbenchHTTP/1.0"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(HTTPStatus.OK)
            self._send_cors_headers()
            self.end_headers()
            return
        self._serve_static(parsed.path, head_only=True)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            db_health = DB_SERVICE.health()
            self._send_json(
                {
                    "ok": True,
                    "appName": SETTINGS.app_name,
                    "service": "ocr-workbench",
                    "mathpixConfigured": SETTINGS.mathpix_configured,
                    "mathpixConfigError": SETTINGS.mathpix_config_error or None,
                    "ossConfigured": SETTINGS.oss_configured,
                    "ossStorageEnabled": OSS_STORAGE_SERVICE.enabled,
                    "ossStorageError": OSS_STORAGE_SERVICE.error or None,
                    "databaseConfigured": DB_SERVICE.enabled,
                    "databaseBackend": db_health.get("backend"),
                    "databaseError": db_health.get("error"),
                }
            )
            return
        if parsed.path == "/api/config":
            self._send_json(SETTINGS.public_dict())
            return
        if parsed.path == "/api/auth/me":
            self._send_json(self._auth_me_payload())
            return
        if parsed.path == "/api/oss/categories":
            self._send_json(self._oss_categories())
            return
        if parsed.path == "/api/oss/category-overview":
            self._send_json(self._oss_category_overview())
            return
        if parsed.path == "/api/books/sync-oss/status":
            query = parse_qs(parsed.query)
            job_id = str(query.get("jobId", [""])[0] or "")
            self._send_json(_get_oss_sync_job(job_id))
            return
        if parsed.path == "/api/books":
            query = parse_qs(parsed.query)
            books_payload = DB_SERVICE.list_books(
                status=str(query.get("status", [""])[0] or ""),
                reviewer_id=str(query.get("reviewerId", [""])[0] or ""),
                limit=int(query.get("limit", ["5000"])[0] or "5000"),
            )
            if books_payload.get("ok"):
                books_payload["syncRuns"] = DB_SERVICE.list_oss_sync_runs(limit=100).get("runs", [])
            self._send_json(books_payload)
            return
        book_state_id = _book_state_id_from_path(parsed.path)
        if book_state_id:
            self._send_json(DB_SERVICE.get_state(book_state_id))
            return
        self._serve_static(parsed.path)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)

        if parsed.path == "/api/ocr/upload-document":
            self._send_json(
                OCR_PREVIEW_SERVICE.upload_document(
                    content=self._read_body(),
                    mime_type=self._request_mime_type(),
                    name=self._uploaded_file_name(),
                )
            )
            return
        if parsed.path == "/api/ocr/upload-document-chunk":
            self._send_json(
                OCR_PREVIEW_SERVICE.upload_document_chunk(
                    upload_id=str(self.headers.get("X-Upload-Id") or ""),
                    chunk_index=int(self.headers.get("X-Chunk-Index") or "0"),
                    chunk_count=int(self.headers.get("X-Chunk-Count") or "1"),
                    content=self._read_body(),
                    mime_type=self._request_mime_type(),
                    name=self._uploaded_file_name(),
                )
            )
            return

        payload = self._read_json()

        if parsed.path == "/api/auth/login":
            self._handle_login(payload)
            return
        if parsed.path == "/api/auth/logout":
            self._handle_logout()
            return
        if parsed.path == "/api/ocr/preview-pages":
            self._send_json(OCR_PREVIEW_SERVICE.preview_pages(payload))
            return
        if parsed.path == "/api/ocr/workspace/load":
            self._send_json(self._load_workspace(payload))
            return
        if parsed.path == "/api/ocr/workspace/save":
            self._send_json(self._save_workspace(payload))
            return
        if parsed.path == "/api/oss/books":
            self._send_json(self._oss_books(payload))
            return
        if parsed.path == "/api/books/sync-oss":
            self._send_json(self._sync_oss_books(payload))
            return
        if parsed.path == "/api/oss/book-assignment":
            self._send_json(DB_SERVICE.upsert_oss_book_assignment(payload, user_id=self._current_user_id()))
            return
        if parsed.path == "/api/oss/load-book":
            self._send_json(self._load_oss_book(payload))
            return
        book_update_id = _book_update_id_from_path(parsed.path)
        if book_update_id:
            self._send_json(
                DB_SERVICE.update_book(
                    book_update_id,
                    payload,
                    user_id=self._current_user_id(),
                )
            )
            return
        book_mark_id = _book_mark_from_path(parsed.path)
        if book_mark_id:
            self._send_json(
                DB_SERVICE.save_review_mark(
                    book_mark_id,
                    payload,
                    user_id=self._current_user_id(),
                )
            )
            return
        book_patch = _book_patch_from_path(parsed.path)
        if book_patch:
            book_id, patch_id = book_patch
            if patch_id:
                self._send_json(
                    DB_SERVICE.update_patch_status(
                        book_id,
                        patch_id,
                        str(payload.get("status") or ""),
                        user_id=self._current_user_id(),
                    )
                )
            else:
                self._send_json(
                    DB_SERVICE.save_patch(
                        book_id,
                        payload,
                        user_id=self._current_user_id(),
                    )
                )
            return
        if parsed.path == "/api/ocr/correct":
            self._send_json(OCR_CORRECTION_SERVICE.correct_markdown(payload))
            return
        if parsed.path == "/api/ocr/convert-and-correct":
            self._send_json(OCR_CORRECTION_SERVICE.convert_and_correct(payload))
            return
        if parsed.path == "/api/model-tester/upload":
            self._send_json(MATHPIX_OCR_SERVICE.upload_attachment(payload))
            return
        if parsed.path == "/api/model-tester/image-to-markdown":
            self._send_json(MATHPIX_OCR_SERVICE.image_to_markdown(payload))
            return

        self._send_json({"ok": False, "error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def _auth_me_payload(self) -> dict:
        user_id = self._current_user_id()
        users = SETTINGS.auth_users
        current = next((user for user in users if user["id"] == user_id), None)
        return {
            "ok": True,
            "authenticated": bool(current),
            "user": current,
            "users": users,
            "adminUserId": SETTINGS.app_admin_user_id,
        }

    def _handle_login(self, payload: dict) -> None:
        user_id = str(payload.get("userId") or payload.get("user_id") or "").strip()
        password = str(payload.get("password") or "")
        users = SETTINGS.auth_users
        if not any(user["id"] == user_id for user in users):
            self._send_json({"ok": False, "error": "unknown_user"}, status=HTTPStatus.UNAUTHORIZED)
            return
        expected = SETTINGS.login_password_for(user_id)
        if not expected or not hmac.compare_digest(password, expected):
            self._send_json({"ok": False, "error": "invalid_password"}, status=HTTPStatus.UNAUTHORIZED)
            return
        token = _sign_session_token(user_id)
        self._send_json_with_cookie(
            {
                "ok": True,
                "authenticated": True,
                "user": next(user for user in users if user["id"] == user_id),
                "users": users,
                "adminUserId": SETTINGS.app_admin_user_id,
            },
            cookie=f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_MAX_AGE_SECONDS}",
        )

    def _handle_logout(self) -> None:
        self._send_json_with_cookie(
            {"ok": True, "authenticated": False, "user": None, "users": SETTINGS.auth_users, "adminUserId": SETTINGS.app_admin_user_id},
            cookie=f"{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        )

    def _load_workspace(self, payload: dict) -> dict:
        workspace_id = str(payload.get("workspaceId") or "").strip()
        if not workspace_id:
            return {"ok": False, "error": "Missing workspaceId"}
        if not OSS_STORAGE_SERVICE.enabled:
            return {"ok": True, "workspace": None, "storage": "local", "ossError": OSS_STORAGE_SERVICE.error or None}
        workspace = OSS_STORAGE_SERVICE.get_json(OSS_STORAGE_SERVICE.workspace_key(workspace_id))
        return {"ok": True, "workspace": workspace, "storage": "oss", "ossError": OSS_STORAGE_SERVICE.error or None}

    def _save_workspace(self, payload: dict) -> dict:
        workspace_id = str(payload.get("workspaceId") or "").strip()
        workspace = payload.get("workspace")
        if not workspace_id:
            return {"ok": False, "error": "Missing workspaceId"}
        if not isinstance(workspace, dict):
            return {"ok": False, "error": "Missing workspace"}
        if not OSS_STORAGE_SERVICE.enabled:
            return {"ok": True, "saved": False, "storage": "local", "ossError": OSS_STORAGE_SERVICE.error or None}
        ok = OSS_STORAGE_SERVICE.put_json(OSS_STORAGE_SERVICE.workspace_key(workspace_id), workspace)
        return {
            "ok": ok,
            "saved": ok,
            "storage": "oss",
            "error": None if ok else OSS_STORAGE_SERVICE.error or "OSS workspace save failed",
        }

    def _oss_books(self, payload: dict) -> dict:
        if not OSS_STORAGE_SERVICE.enabled:
            return {"ok": False, "error": OSS_STORAGE_SERVICE.error or "OSS storage is not configured", "books": []}
        prefix = str(payload.get("prefix") or DEFAULT_OSS_BOOKS_PREFIX).strip()
        keys = OSS_STORAGE_SERVICE.list_keys(prefix=prefix, limit=int(payload.get("limit") or DEFAULT_OSS_SYNC_LIMIT))
        books = _build_oss_book_index(keys)
        sync_result = DB_SERVICE.upsert_oss_books(books, owner_user_id=str(payload.get("ownerUserId") or "")) if DB_SERVICE.enabled else {"ok": False, "count": 0, "error": DB_SERVICE.error}
        return {"ok": True, "books": books, "keyCount": len(keys), "booksFound": len(books), "dbSync": sync_result}

    def _oss_categories(self) -> dict:
        if not OSS_STORAGE_SERVICE.enabled:
            return {"ok": False, "error": OSS_STORAGE_SERVICE.error or "OSS storage is not configured", "categories": []}
        prefixes = OSS_STORAGE_SERVICE.list_child_prefixes(DEFAULT_OSS_BOOKS_PREFIX, limit=500)
        categories = [
            {
                "title": prefix[len(DEFAULT_OSS_BOOKS_PREFIX) :].strip("/"),
                "prefix": prefix,
            }
            for prefix in prefixes
            if prefix.startswith(DEFAULT_OSS_BOOKS_PREFIX)
        ]
        return {"ok": True, "categories": categories, "count": len(categories)}

    def _oss_category_overview(self) -> dict:
        if not OSS_STORAGE_SERVICE.enabled:
            return {"ok": False, "error": OSS_STORAGE_SERVICE.error or "OSS storage is not configured", "categories": []}
        category_prefixes = OSS_STORAGE_SERVICE.list_child_prefixes(DEFAULT_OSS_BOOKS_PREFIX, limit=500)
        assignment_rows = DB_SERVICE.list_oss_book_assignments().get("assignments", []) if DB_SERVICE.enabled else []
        assignment_by_key = {
            (str(row.get("category_title") or "").strip(), str(row.get("book_title") or "").strip()): row
            for row in assignment_rows
        }
        categories = []
        for category_prefix in category_prefixes:
            if not str(category_prefix).startswith(DEFAULT_OSS_BOOKS_PREFIX):
                continue
            title = str(category_prefix)[len(DEFAULT_OSS_BOOKS_PREFIX) :].strip("/")
            book_prefixes = OSS_STORAGE_SERVICE.list_child_prefixes(str(category_prefix), limit=1000)
            books = [
                {
                    "title": str(book_prefix)[len(str(category_prefix)) :].strip("/"),
                    "prefix": str(book_prefix),
                    **_assignment_fields_for_overview(
                        assignment_by_key.get(
                            (title.strip(), str(book_prefix)[len(str(category_prefix)) :].strip("/").strip()),
                            {},
                        )
                    ),
                }
                for book_prefix in book_prefixes
                if str(book_prefix).startswith(str(category_prefix))
            ]
            categories.append(
                {
                    "title": title,
                    "prefix": str(category_prefix),
                    "bookCount": len(books),
                    "books": books,
                },
            )
        return {"ok": True, "categories": categories, "count": len(categories)}

    def _sync_oss_books(self, payload: dict) -> dict:
        if not OSS_STORAGE_SERVICE.enabled:
            return {"ok": False, "error": OSS_STORAGE_SERVICE.error or "OSS storage is not configured", "books": []}
        prefix = str(payload.get("prefix") or DEFAULT_OSS_BOOKS_PREFIX).strip()
        limit = int(payload.get("limit") or DEFAULT_OSS_SYNC_LIMIT)
        owner_user_id = str(payload.get("ownerUserId") or "")
        force = bool(payload.get("force"))
        job_id = uuid.uuid4().hex
        _set_oss_sync_job(
            job_id,
            {
                "ok": True,
                "jobId": job_id,
                "status": "running",
                "message": "OSS 同步任务已启动",
                "prefix": prefix,
                "limit": limit,
                "force": force,
                "startedAt": int(time.time()),
            },
        )
        thread = threading.Thread(
            target=_run_oss_sync_job,
            args=(job_id, prefix, limit, owner_user_id, force),
            daemon=True,
        )
        thread.start()
        return {"ok": True, "jobId": job_id, "status": "running"}

    def _load_oss_book(self, payload: dict) -> dict:
        if not OSS_STORAGE_SERVICE.enabled:
            return {"ok": False, "error": OSS_STORAGE_SERVICE.error or "OSS storage is not configured"}
        db_book = None
        book_id = str(payload.get("bookId") or payload.get("book_id") or "").strip()
        if book_id and DB_SERVICE.enabled:
            book_result = DB_SERVICE.get_book(book_id)
            if book_result.get("ok"):
                db_book = book_result.get("book")
            elif not payload.get("pdfKey") and not payload.get("middleKey"):
                return {"ok": False, "error": "book_not_found", "bookId": book_id}
        elif book_id and not DB_SERVICE.enabled and not payload.get("pdfKey") and not payload.get("middleKey"):
            return {"ok": False, "error": "database_not_configured", "bookId": book_id}
        pdf_key = str(payload.get("pdfKey") or (db_book or {}).get("oss_pdf_key") or "").strip()
        middle_key = str(payload.get("middleKey") or (db_book or {}).get("oss_middle_key") or "").strip()
        content_list_key = str(payload.get("contentListKey") or (db_book or {}).get("oss_content_list_key") or "").strip()
        if not pdf_key or not middle_key:
            return {
                "ok": False,
                "error": "book_missing_oss_keys" if db_book else "missing_pdf_or_middle_key",
                "bookId": book_id,
            }

        middle_bytes = OSS_STORAGE_SERVICE.get_bytes(middle_key)
        content_list_bytes = OSS_STORAGE_SERVICE.get_bytes(content_list_key) if content_list_key else None
        if not middle_bytes:
            return {"ok": False, "error": f"Cannot read middle.json from OSS: {middle_key}"}

        try:
            middle_json = json.loads(middle_bytes.decode("utf-8"))
            content_list_json = json.loads(content_list_bytes.decode("utf-8")) if content_list_bytes else None
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "error": f"Invalid JSON from OSS: {error}"}

        pdf_info = middle_json.get("pdf_info") if isinstance(middle_json, dict) else None
        page_count = len(pdf_info) if isinstance(pdf_info, list) else 0
        document = OCR_PREVIEW_SERVICE.load_document_reference(
            mime_type="application/pdf",
            name=posixpath.basename(pdf_key) or "origin.pdf",
            oss_key=pdf_key,
            page_count=page_count,
        )
        if not document.get("ok"):
            return document
        db_state = DB_SERVICE.get_state(book_id) if book_id and DB_SERVICE.enabled else {}
        return {
            "ok": True,
            "document": document,
            "middleJson": middle_json,
            "middleName": posixpath.basename(middle_key) or "middle.json",
            "contentListJson": content_list_json,
            "contentListName": posixpath.basename(content_list_key) if content_list_key else "",
            "workspaceId": str(payload.get("workspaceId") or book_id or _workspace_id_for_oss_entry(middle_key, document.get("pageCount"))),
            "book": db_book,
            "ocrPatches": db_state.get("ocrPatches", []) if db_state.get("ok") else [],
            "reviewMarks": db_state.get("reviewMarks", []) if db_state.get("ok") else [],
            "ossKeys": {
                "pdf": pdf_key,
                "middle": middle_key,
                "contentList": content_list_key,
            },
        }

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return

    def _read_json(self) -> dict:
        raw = self._read_body().decode("utf-8")
        if not raw.strip():
            return {}
        return json.loads(raw)

    def _read_body(self) -> bytes:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return b""
        return self.rfile.read(content_length)

    def _request_mime_type(self) -> str:
        return str(self.headers.get("Content-Type") or "application/octet-stream").split(";", 1)[0].strip()

    def _uploaded_file_name(self) -> str:
        raw = str(self.headers.get("X-File-Name") or "upload")
        return unquote(raw).strip() or "upload"

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        self._send_json_with_cookie(payload, status=status)

    def _send_json_with_cookie(self, payload: dict, status: HTTPStatus = HTTPStatus.OK, cookie: str = "") -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def _send_cors_headers(self) -> None:
        origin = str(self.headers.get("Origin") or "")
        self.send_header("Access-Control-Allow-Origin", origin or "*")
        if origin:
            self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Upload-Id, X-Chunk-Index, X-Chunk-Count, X-File-Name",
        )

    def _current_user_id(self) -> str:
        cookies = str(self.headers.get("Cookie") or "")
        for part in cookies.split(";"):
            key, _, value = part.strip().partition("=")
            if key == SESSION_COOKIE_NAME:
                return _verify_session_token(value)
        return ""

    def _serve_static(self, path: str, head_only: bool = False) -> None:
        relative_path = "index.html" if path in {"", "/"} else path.lstrip("/")
        file_path = (FRONTEND_DIR / relative_path).resolve()
        if FRONTEND_DIR not in file_path.parents and file_path != FRONTEND_DIR:
            self._send_json({"ok": False, "error": "Forbidden"}, status=HTTPStatus.FORBIDDEN)
            return
        if file_path.is_dir():
            file_path = file_path / "index.html"
        if not file_path.exists():
            self._send_json({"ok": False, "error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            return

        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.end_headers()
            if not head_only:
                self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            return


def run() -> None:
    server = ThreadingHTTPServer((SETTINGS.host, SETTINGS.port), OcrWorkbenchHandler)
    print(f"OCR Workbench server running at http://{SETTINGS.host}:{SETTINGS.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def _build_oss_book_index(keys: list[str]) -> list[dict]:
    files_by_dir: dict[str, list[str]] = {}
    for key in keys:
        files_by_dir.setdefault(posixpath.dirname(key), []).append(key)
    by_dir: dict[str, dict[str, str]] = {}
    key_set = set(keys)
    for key in keys:
        lower = key.lower()
        if not lower.endswith(".json") or "middle" not in posixpath.basename(lower):
            continue
        directory = posixpath.dirname(key)
        files = by_dir.setdefault(directory, {"middleKey": key})
        files["middleKey"] = key
        for candidate in files_by_dir.get(directory, []):
            name = posixpath.basename(candidate).lower()
            if name.endswith(".pdf") and ("origin" in name or "layout" not in name):
                files.setdefault("pdfKey", candidate)
            if name.endswith(".json") and "content" in name and "list" in name:
                files.setdefault("contentListKey", candidate)
        if "pdfKey" not in files:
            stem = posixpath.basename(key).replace("_middle.json", "")
            for suffix in ("_origin.pdf", "_layout.pdf"):
                candidate = posixpath.join(directory, f"{stem}{suffix}")
                if candidate in key_set:
                    files["pdfKey"] = candidate
                    break

    entries = []
    for directory, files in by_dir.items():
        if not files.get("pdfKey") or not files.get("middleKey"):
            continue
        book_root, mode, chunk_label = _classify_oss_book_dir(directory)
        title = _readable_title(book_root)
        label = title if mode == "whole-book" else f"{title} · {chunk_label}"
        middle_key = files["middleKey"]
        entries.append(
            {
                "id": _workspace_id_for_oss_entry(middle_key, ""),
                "label": label,
                "title": title,
                "mode": mode,
                "chunkLabel": chunk_label,
                "directory": directory,
                "pdfKey": files.get("pdfKey", ""),
                "middleKey": middle_key,
                "contentListKey": files.get("contentListKey", ""),
                "imagesPrefix": posixpath.join(directory, "images") + "/",
                "workspaceId": _workspace_id_for_oss_entry(middle_key, ""),
            }
        )
    return sorted(entries, key=lambda item: (item["title"], item["mode"], item["chunkLabel"], item["directory"]))


def _classify_oss_book_dir(directory: str) -> tuple[str, str, str]:
    parts = [part for part in directory.split("/") if part]
    if "chunks" in parts:
        index = parts.index("chunks")
        book_root = "/".join(parts[:index]) or directory
        chunk_label = parts[index + 1] if len(parts) > index + 1 else posixpath.basename(directory)
        return book_root, "chunked", chunk_label
    if parts and parts[-1] in {"auto", "hybrid_auto"}:
        return "/".join(parts[:-1]) or directory, "whole-book", ""
    return directory, "whole-book", ""


def _category_and_book_title_for_oss_entry(book: dict) -> tuple[str, str]:
    directory = str(book.get("directory") or book.get("middleKey") or "").replace("\\", "/")
    parts = [part for part in directory.split("/") if part]
    root_index = 1 if parts and parts[0] == "books-raw" else 0
    category_title = parts[root_index] if len(parts) > root_index else ""
    book_title = parts[root_index + 1] if len(parts) > root_index + 1 else str(book.get("title") or "")
    return category_title.strip(), book_title.strip()


def _readable_title(path: str) -> str:
    title = posixpath.basename(path.rstrip("/")) or path
    return title.replace("_解析结果", "").replace("_", " ").strip() or title


def _workspace_id_for_oss_entry(middle_key: str, page_count: object) -> str:
    count = str(page_count or "").strip()
    suffix = f":{count}" if count else ""
    return f"oss:{middle_key}{suffix}"


def _set_oss_sync_job(job_id: str, payload: dict) -> None:
    if not job_id:
        return
    with OSS_SYNC_JOBS_LOCK:
        current = OSS_SYNC_JOBS.get(job_id, {})
        current.update(payload)
        OSS_SYNC_JOBS[job_id] = current


def _get_oss_sync_job(job_id: str) -> dict:
    if not job_id:
        return {"ok": False, "error": "missing_job_id"}
    with OSS_SYNC_JOBS_LOCK:
        job = dict(OSS_SYNC_JOBS.get(job_id) or {})
    if not job:
        return {"ok": False, "error": "sync_job_not_found", "jobId": job_id}
    return job


def _run_oss_sync_job(job_id: str, prefix: str, limit: int, owner_user_id: str, force: bool = False) -> None:
    run_id = ""
    scanned_count = 0
    entries: list[dict] = []
    changed_entries: list[dict] = []
    books_found = 0
    db_sync_count = 0
    try:
        if DB_SERVICE.enabled:
            run = DB_SERVICE.begin_oss_sync_run(prefix=prefix, mode="full" if force else "incremental")
            run_id = str(run.get("id") or "") if run.get("ok") else ""
        _set_oss_sync_job(job_id, {"message": "正在扫描 OSS 对象..."})
        entries, scanned_count = OSS_STORAGE_SERVICE.list_book_index_entries(
            prefix=prefix,
            limit=limit,
            progress=lambda scanned, kept: _set_oss_sync_job(
                job_id,
                {
                    "scannedCount": scanned,
                    "keyCount": kept,
                    "message": "正在扫描 OSS 对象...",
                },
            ),
        )
        changed_result = (
            DB_SERVICE.changed_oss_sync_entries(prefix=prefix, entries=entries, force=force)
            if DB_SERVICE.enabled
            else {"ok": True, "entries": entries}
        )
        changed_entries = changed_result.get("entries", entries)
        changed_dirs = {posixpath.dirname(str(entry.get("key") or "")) for entry in changed_entries}
        keys = [str(entry.get("key") or "") for entry in entries if posixpath.dirname(str(entry.get("key") or "")) in changed_dirs]
        _set_oss_sync_job(
            job_id,
            {
                "scannedCount": scanned_count,
                "keyCount": len(entries),
                "changedKeyCount": len(changed_entries),
                "message": "正在识别变化书籍结构..." if changed_entries else "没有发现新增或变化的索引文件",
            },
        )
        books = _build_oss_book_index(keys) if changed_entries else []
        for book in books:
            if owner_user_id:
                continue
            category_title, book_title = _category_and_book_title_for_oss_entry(book)
            assignment = DB_SERVICE.assignment_for_oss_book(category_title=category_title, book_title=book_title) if DB_SERVICE.enabled else {}
            assigned_owner = str(assignment.get("owner_user_id") or assignment.get("first_reviewer_id") or "").strip()
            if assigned_owner:
                book["ownerUserId"] = assigned_owner
            first_reviewer = str(assignment.get("first_reviewer_id") or "").strip()
            second_reviewer = str(assignment.get("second_reviewer_id") or "").strip()
            if first_reviewer:
                book["firstReviewerId"] = first_reviewer
                book["status"] = "first_review"
            if second_reviewer:
                book["secondReviewerId"] = second_reviewer
                book["ownerUserId"] = second_reviewer
                book["status"] = "second_review"
        books_found = len(books)
        _set_oss_sync_job(job_id, {"booksFound": books_found, "message": "正在写入数据库..." if books else "正在记录同步结果..."})
        sync_result = DB_SERVICE.upsert_oss_books(books, owner_user_id=owner_user_id)
        db_sync_count = int(sync_result.get("count") or 0)
        if DB_SERVICE.enabled and run_id:
            DB_SERVICE.finish_oss_sync_run(
                run_id,
                prefix=prefix,
                entries=entries,
                status="completed" if sync_result.get("ok") else "failed",
                scanned_count=scanned_count,
                key_count=len(entries),
                changed_key_count=len(changed_entries),
                books_found=books_found,
                db_sync_count=db_sync_count,
                error="" if sync_result.get("ok") else str(sync_result.get("error") or "OSS 同步失败"),
            )
        _set_oss_sync_job(
            job_id,
            {
                "ok": bool(sync_result.get("ok")),
                "status": "completed" if sync_result.get("ok") else "failed",
                "message": "OSS 同步完成" if sync_result.get("ok") else sync_result.get("error") or "OSS 同步失败",
                "dbSync": sync_result,
                "scannedCount": scanned_count,
                "keyCount": len(entries),
                "changedKeyCount": len(changed_entries),
                "booksFound": books_found,
                "completedAt": int(time.time()),
            },
        )
    except Exception as error:  # noqa: BLE001
        if DB_SERVICE.enabled and run_id:
            DB_SERVICE.finish_oss_sync_run(
                run_id,
                prefix=prefix,
                entries=entries,
                status="failed",
                scanned_count=scanned_count,
                key_count=len(entries),
                changed_key_count=len(changed_entries),
                books_found=books_found,
                db_sync_count=db_sync_count,
                error=str(error),
            )
        _set_oss_sync_job(
            job_id,
            {
                "ok": False,
                "status": "failed",
                "error": str(error),
                "message": str(error),
                "completedAt": int(time.time()),
            },
        )


def _sign_session_token(user_id: str) -> str:
    expires_at = int(time.time()) + SESSION_MAX_AGE_SECONDS
    payload = f"{user_id}|{expires_at}"
    signature = hmac.new(SETTINGS.session_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    raw = f"{payload}|{signature}".encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _verify_session_token(token: str) -> str:
    try:
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        user_id, expires_raw, signature = raw.rsplit("|", 2)
        payload = f"{user_id}|{expires_raw}"
        expected = hmac.new(SETTINGS.session_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return ""
        if int(expires_raw) < int(time.time()):
            return ""
        if not any(user["id"] == user_id for user in SETTINGS.auth_users):
            return ""
        return user_id
    except Exception:  # noqa: BLE001
        return ""


def _assignment_fields_for_overview(assignment: dict) -> dict:
    first_reviewer_id = str(assignment.get("first_reviewer_id") or "").strip()
    second_reviewer_id = str(assignment.get("second_reviewer_id") or "").strip()
    owner_user_id = str(assignment.get("owner_user_id") or first_reviewer_id or "").strip()
    return {
        "owner_user_id": owner_user_id,
        "first_reviewer_id": first_reviewer_id,
        "second_reviewer_id": second_reviewer_id,
    }


def _book_state_id_from_path(path: str) -> str:
    prefix = "/api/books/"
    suffix = "/state"
    if not path.startswith(prefix) or not path.endswith(suffix):
        return ""
    raw = path[len(prefix) : -len(suffix)]
    return unquote(raw).strip("/")


def _book_patch_from_path(path: str) -> tuple[str, str] | None:
    prefix = "/api/books/"
    if not path.startswith(prefix):
        return None
    parts = [unquote(part) for part in path[len(prefix) :].split("/") if part]
    if len(parts) == 2 and parts[1] == "patches":
        return parts[0], ""
    if len(parts) == 4 and parts[1] == "patches" and parts[3] == "status":
        return parts[0], parts[2]
    return None


def _book_mark_from_path(path: str) -> str:
    prefix = "/api/books/"
    suffix = "/marks"
    if not path.startswith(prefix) or not path.endswith(suffix):
        return ""
    raw = path[len(prefix) : -len(suffix)]
    return unquote(raw).strip("/")


def _book_update_id_from_path(path: str) -> str:
    prefix = "/api/books/"
    suffix = "/update"
    if not path.startswith(prefix) or not path.endswith(suffix):
        return ""
    raw = path[len(prefix) : -len(suffix)]
    return unquote(raw).strip("/")


if __name__ == "__main__":
    run()
