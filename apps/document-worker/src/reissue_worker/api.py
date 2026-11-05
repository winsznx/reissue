"""HTTP surface: POST /v1/extract, POST /v1/render, GET /health."""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from reissue_worker.config import WORKER_VERSION, Settings
from reissue_worker.errors import DocumentError, PayloadTooLarge
from reissue_worker.extract import detect_mime, extract_document
from reissue_worker.llm import FieldAssistant, build_assistant
from reissue_worker.ocr import tesseract_available
from reissue_worker.pdf_text import check_page_limit, open_document, render_page_png
from reissue_worker.sniff import XLSX

logger = logging.getLogger(__name__)

MULTIPART_OVERHEAD_BYTES = 64 * 1024


def create_app(settings: Settings | None = None, assistant: FieldAssistant | None = None) -> FastAPI:
    config = settings or Settings.from_env()
    field_assistant = assistant if assistant is not None else build_assistant(config)
    app = FastAPI(title="Reissue document worker", version=WORKER_VERSION)

    @app.middleware("http")
    async def reject_oversized_bodies(request: Request, call_next: Any) -> Response:
        declared = request.headers.get("content-length")
        if (
            declared
            and declared.isdigit()
            and int(declared) > config.max_upload_bytes + MULTIPART_OVERHEAD_BYTES
        ):
            return _error(
                PayloadTooLarge(f"request body exceeds the {config.max_upload_bytes} byte upload limit")
            )
        response: Response = await call_next(request)
        return response

    @app.exception_handler(DocumentError)
    async def document_error(_: Request, exc: DocumentError) -> JSONResponse:
        return _error(exc)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "workerVersion": WORKER_VERSION,
            "ocr": tesseract_available(),
            "modelProvider": config.model_provider,
        }

    @app.post("/v1/extract")
    async def extract(
        file: Annotated[UploadFile, File()],
        filename_hint: Annotated[str | None, Form()] = None,
    ) -> JSONResponse:
        data = await _read_limited(file, config)
        hint = filename_hint or file.filename
        result = await run_in_threadpool(extract_document, data, config, hint, field_assistant)
        return JSONResponse(result.to_json())

    @app.post("/v1/render")
    async def render(
        file: Annotated[UploadFile, File()],
        page: Annotated[int, Form(ge=1)],
    ) -> Response:
        data = await _read_limited(file, config)
        png = await run_in_threadpool(_render, data, page, config)
        return Response(content=png, media_type="image/png")

    return app


def _render(data: bytes, page: int, settings: Settings) -> bytes:
    mime = detect_mime(data, settings)
    if mime == XLSX:
        raise DocumentError("spreadsheets have no page images to render")
    with open_document(data, mime) as document:
        check_page_limit(document, settings)
        if page > document.page_count:
            raise DocumentError(f"page {page} is out of range; document has {document.page_count} pages")
        return render_page_png(document, page)


async def _read_limited(file: UploadFile, settings: Settings) -> bytes:
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise PayloadTooLarge(f"upload exceeds the {settings.max_upload_bytes} byte limit")
    return data


def _error(exc: DocumentError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})


app = create_app()
