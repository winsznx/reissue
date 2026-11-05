from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

WORKER_VERSION = "0.1.0"

ModelProvider = Literal["anthropic", "none"]


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer, got {raw!r}")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    max_upload_bytes: int = 25 * 1024 * 1024
    max_pages: int = 60
    ocr_min_chars: int = 50
    ocr_dpi: int = 300
    ocr_max_pixels: int = 60_000_000
    xlsx_max_uncompressed_bytes: int = 100 * 1024 * 1024
    model_provider: ModelProvider = "none"
    model: str = "claude-sonnet-5-5"
    anthropic_api_key: str | None = None
    anthropic_base_url: str = "https://api.anthropic.com"

    @classmethod
    def from_env(cls) -> Settings:
        provider = os.environ.get("EXTRACTION_MODEL_PROVIDER", "none").strip().lower() or "none"
        if provider not in ("anthropic", "none"):
            raise ValueError(f"EXTRACTION_MODEL_PROVIDER must be 'anthropic' or 'none', got {provider!r}")
        defaults = cls()
        return cls(
            max_upload_bytes=_int_env("MAX_UPLOAD_BYTES", defaults.max_upload_bytes),
            max_pages=_int_env("MAX_PAGES", defaults.max_pages),
            model_provider="anthropic" if provider == "anthropic" else "none",
            model=os.environ.get("EXTRACTION_MODEL", "").strip() or defaults.model,
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
            anthropic_base_url=os.environ.get("ANTHROPIC_BASE_URL") or defaults.anthropic_base_url,
        )
