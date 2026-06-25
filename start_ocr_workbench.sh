#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-8789}"

cd "${ROOT_DIR}"
APP_HOST="${APP_HOST}" APP_PORT="${APP_PORT}" python3 -m backend.ocr_server
