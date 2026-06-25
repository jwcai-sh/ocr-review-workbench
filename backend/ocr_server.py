from __future__ import annotations

import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from backend.config import SETTINGS
from backend.services.mathpix_ocr import MATHPIX_OCR_SERVICE
from backend.services.ocr_correction import OCR_CORRECTION_SERVICE
from backend.services.ocr_preview import OCR_PREVIEW_SERVICE

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / "frontend"


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
            self._send_json(
                {
                    "ok": True,
                    "appName": SETTINGS.app_name,
                    "service": "ocr-workbench",
                    "mathpixConfigured": bool(SETTINGS.mathpix_app_id and SETTINGS.mathpix_app_key),
                }
            )
            return
        if parsed.path == "/api/config":
            self._send_json(SETTINGS.public_dict())
            return
        self._serve_static(parsed.path)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        payload = self._read_json()

        if parsed.path == "/api/ocr/preview-pages":
            self._send_json(OCR_PREVIEW_SERVICE.preview_pages(payload))
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

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _serve_static(self, path: str, head_only: bool = False) -> None:
        relative_path = "ocr-compare.html" if path in {"", "/"} else path.lstrip("/")
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
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        if not head_only:
            self.wfile.write(content)


def run() -> None:
    server = ThreadingHTTPServer((SETTINGS.host, SETTINGS.port), OcrWorkbenchHandler)
    print(f"OCR Workbench server running at http://{SETTINGS.host}:{SETTINGS.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
