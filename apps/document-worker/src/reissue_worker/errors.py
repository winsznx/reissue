from __future__ import annotations


class DocumentError(Exception):
    """A client-visible rejection of the uploaded bytes, mapped 1:1 to an HTTP status."""

    status_code = 422
    code = "unprocessable_document"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class CorruptDocument(DocumentError):
    code = "corrupt_document"


class EmptyDocument(DocumentError):
    code = "empty_document"


class TooManyPages(DocumentError):
    code = "too_many_pages"


class UnsupportedMediaType(DocumentError):
    status_code = 415
    code = "unsupported_media_type"


class PayloadTooLarge(DocumentError):
    status_code = 413
    code = "payload_too_large"
