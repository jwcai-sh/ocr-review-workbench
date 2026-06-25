from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any


def post_json(url: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    if not body.strip():
        return {}
    return json.loads(body)


def get_json(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    if not body.strip():
        return {}
    return json.loads(body)


def safe_post_json(url: str, payload: dict[str, Any], timeout: float) -> tuple[dict[str, Any] | None, str | None]:
    last_error = ""
    for attempt in range(2):
        try:
            return post_json(url, payload, timeout), None
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="ignore")
            return None, f"HTTP {error.code}: {details[:300]}"
        except Exception as error:  # noqa: BLE001
            last_error = str(error)
            if attempt == 0:
                time.sleep(0.35)
                continue
    return None, last_error


def safe_get_json(url: str, timeout: float) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return get_json(url, timeout), None
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="ignore")
        return None, f"HTTP {error.code}: {details[:300]}"
    except Exception as error:  # noqa: BLE001
        return None, str(error)
