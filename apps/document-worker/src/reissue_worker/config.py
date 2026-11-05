from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

WORKER_VERSION = "0.1.0"

ModelProvider = Literal["anthropic", "claude_code", "none"]
MODEL_PROVIDERS: tuple[ModelProvider, ...] = ("anthropic", "claude_code", "none")


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
    claude_code_bin: str = "claude"
    claude_code_model: str | None = None
    model_timeout_seconds: int = 180

    @classmethod
    def from_env(cls) -> Settings:
        provider = _provider(os.environ.get("EXTRACTION_MODEL_PROVIDER", ""))
        defaults = cls()
        model = os.environ.get("EXTRACTION_MODEL", "").strip()
        return cls(
            max_upload_bytes=_int_env("MAX_UPLOAD_BYTES", defaults.max_upload_bytes),
            max_pages=_int_env("MAX_PAGES", defaults.max_pages),
            model_provider=provider,
            model=model or defaults.model,
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
            anthropic_base_url=os.environ.get("ANTHROPIC_BASE_URL") or defaults.anthropic_base_url,
            claude_code_bin=os.environ.get("CLAUDE_CODE_BIN", "").strip() or defaults.claude_code_bin,
            claude_code_model=model or None,
            model_timeout_seconds=_int_env(
                "EXTRACTION_MODEL_TIMEOUT_SECONDS", defaults.model_timeout_seconds
            ),
        )


def _provider(raw: str) -> ModelProvider:
    name = raw.strip().lower() or "none"
    for provider in MODEL_PROVIDERS:
        if provider == name:
            return provider
    raise ValueError(f"EXTRACTION_MODEL_PROVIDER must be one of {', '.join(MODEL_PROVIDERS)}; got {name!r}")
