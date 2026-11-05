from __future__ import annotations

from collections.abc import Callable
from functools import cache

import pytest
from fastapi.testclient import TestClient

from reissue_worker.api import create_app
from reissue_worker.config import Settings
from reissue_worker.extract import extract_document
from support import Result, fixture_bytes


@cache
def _extract_cached(name: str, hint: str) -> Result:
    return extract_document(fixture_bytes(name), Settings(), hint).to_json()


@pytest.fixture(scope="session")
def extract_fixture() -> Callable[..., Result]:
    def run(name: str, hint: str | None = None) -> Result:
        return _extract_cached(name, hint if hint is not None else name)

    return run


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings()))
