from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.services.oss_storage import OssStorageService


class FakeObject:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def read(self) -> bytes:
        return self.payload


class FakeBucket:
    def __init__(self) -> None:
        self.calls = 0

    def get_object(self, key: str) -> FakeObject:
        self.calls += 1
        if self.calls < 3:
            raise TimeoutError("temporary OSS timeout")
        return FakeObject(b"middle-json")


def main() -> None:
    service = OssStorageService(enabled=False)
    service.enabled = True
    service._bucket = FakeBucket()
    service.max_get_retries = 3
    first = service.get_bytes("books/book/middle.json")
    assert first == b"middle-json"
    assert service._bucket.calls == 3
    second = service.get_bytes("books/book/middle.json")
    assert second == b"middle-json"
    assert service._bucket.calls == 3, "successful OSS reads should be served from cache"
    print("oss storage retry/cache tests ok")


if __name__ == "__main__":
    main()
