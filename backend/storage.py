"""Pluggable storage backend for DocuCraft.

Serverless functions (Vercel) are stateless: module-level dicts do not survive
across invocations, so every endpoint goes through this interface instead.

- Local dev (default): ``MemoryStorage`` — plain process memory, zero config.
- Vercel (``STORAGE_BACKEND=blob``): ``BlobStorage`` — PDF bytes plus JSON
  sidecars (metadata, annotations) in Vercel Blob. Requires the official
  ``vercel`` PyPI package and ``BLOB_READ_WRITE_TOKEN``.

PDF blobs are stored with ``access="public"`` under unguessable uuid
pathnames so downloads can be served as plain redirects (this keeps large
files out of the serverless request/response body limit). Metadata and
annotation sidecars stay private — only the backend ever reads them.
"""

import abc
import base64
import hashlib
import hmac
import json
import os
import time
import uuid

# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


class StorageBackend(abc.ABC):
    """Document storage: PDF bytes, metadata dict, annotation dict."""

    # -- PDF bytes ---------------------------------------------------------
    @abc.abstractmethod
    def pdf_exists(self, pdf_id: str) -> bool: ...

    @abc.abstractmethod
    def get_pdf(self, pdf_id: str) -> bytes | None: ...

    @abc.abstractmethod
    def put_pdf(self, pdf_id: str, data: bytes) -> None: ...

    @abc.abstractmethod
    def delete_pdf(self, pdf_id: str) -> None:
        """Delete the PDF and all its sidecars (metadata, annotations)."""

    # -- metadata ----------------------------------------------------------
    @abc.abstractmethod
    def get_meta(self, pdf_id: str) -> dict: ...

    @abc.abstractmethod
    def put_meta(self, pdf_id: str, meta: dict) -> None: ...

    @abc.abstractmethod
    def update_meta(self, pdf_id: str, **fields) -> None:
        """Update metadata fields; no-op when no metadata exists."""

    # -- annotations -------------------------------------------------------
    @abc.abstractmethod
    def get_annotations(self, pdf_id: str) -> dict: ...

    @abc.abstractmethod
    def put_annotations(self, pdf_id: str, annots: dict) -> None: ...

    # -- file delivery -----------------------------------------------------
    @abc.abstractmethod
    def public_url(self, pdf_id: str) -> str | None:
        """Direct download URL for the stored PDF, or None when the backend
        cannot serve bytes without proxying through the function."""

    @abc.abstractmethod
    def put_result(self, data: bytes, filename: str, media_type: str) -> str | None:
        """Stage derived result bytes (split/merge/export…) and return a direct
        download URL, or None when the backend cannot do that."""

    # -- misc --------------------------------------------------------------
    @abc.abstractmethod
    def count(self) -> int: ...

    def create_upload_token(self, pathname: str) -> str:
        """Mint a short-lived browser upload token for direct-to-storage
        uploads (bypasses the serverless body-size limit)."""
        raise NotImplementedError("direct upload not supported by this backend")


# ---------------------------------------------------------------------------
# In-memory (local dev / tests)
# ---------------------------------------------------------------------------


class MemoryStorage(StorageBackend):
    def __init__(self) -> None:
        self._pdfs: dict[str, bytes] = {}
        self._meta: dict[str, dict] = {}
        self._annots: dict[str, dict[str, dict]] = {}

    def pdf_exists(self, pdf_id: str) -> bool:
        return pdf_id in self._pdfs

    def get_pdf(self, pdf_id: str) -> bytes | None:
        return self._pdfs.get(pdf_id)

    def put_pdf(self, pdf_id: str, data: bytes) -> None:
        self._pdfs[pdf_id] = data
        if pdf_id in self._meta:
            self._meta[pdf_id]["size"] = len(data)

    def delete_pdf(self, pdf_id: str) -> None:
        self._pdfs.pop(pdf_id, None)
        self._meta.pop(pdf_id, None)
        self._annots.pop(pdf_id, None)

    def get_meta(self, pdf_id: str) -> dict:
        return self._meta.get(pdf_id, {})

    def put_meta(self, pdf_id: str, meta: dict) -> None:
        self._meta[pdf_id] = meta

    def update_meta(self, pdf_id: str, **fields) -> None:
        if pdf_id in self._meta:
            self._meta[pdf_id].update(fields)

    def get_annotations(self, pdf_id: str) -> dict:
        return self._annots.get(pdf_id, {})

    def put_annotations(self, pdf_id: str, annots: dict) -> None:
        self._annots[pdf_id] = annots

    def public_url(self, pdf_id: str) -> str | None:
        return None

    def put_result(self, data: bytes, filename: str, media_type: str) -> str | None:
        return None

    def count(self) -> int:
        return len(self._pdfs)


# ---------------------------------------------------------------------------
# Vercel Blob (production on Vercel)
# ---------------------------------------------------------------------------

try:
    from vercel.blob import BlobClient
    from vercel.blob.errors import BlobNotFoundError
except ImportError:  # pragma: no cover - optional dependency
    BlobClient = None

    class BlobNotFoundError(Exception):  # type: ignore[no-redef]
        pass


def _store_id_from_token(token: str) -> str:
    # BLOB_READ_WRITE_TOKEN looks like vercel_blob_rw_<storeId>_<secret>
    parts = (token or "").split("_")
    return parts[3] if len(parts) > 3 and parts[3] else ""


class BlobStorage(StorageBackend):
    PDF_PREFIX = "docucraft/pdfs/"
    META_PREFIX = "docucraft/meta/"
    ANNOT_PREFIX = "docucraft/annotations/"
    RESULT_PREFIX = "docucraft/results/"

    def __init__(self, token: str | None = None) -> None:
        if BlobClient is None:
            raise RuntimeError(
                "STORAGE_BACKEND=blob requires the 'vercel' package "
                "(pip install vercel) and the BLOB_READ_WRITE_TOKEN env var."
            )
        token = token or os.environ.get("BLOB_READ_WRITE_TOKEN", "")
        self._token = token
        self._store_id = _store_id_from_token(token)
        if not self._store_id:
            raise RuntimeError(
                "BLOB_READ_WRITE_TOKEN is missing or malformed; "
                "cannot use STORAGE_BACKEND=blob."
            )
        self._client = BlobClient(token=token)

    # -- pathnames ----------------------------------------------------------
    def _pdf_path(self, pdf_id: str) -> str:
        return f"{self.PDF_PREFIX}{pdf_id}.pdf"

    def _meta_path(self, pdf_id: str) -> str:
        return f"{self.META_PREFIX}{pdf_id}.json"

    def _annot_path(self, pdf_id: str) -> str:
        return f"{self.ANNOT_PREFIX}{pdf_id}.json"

    def _get_json(self, pathname: str) -> dict:
        try:
            raw = self._client.get(pathname, access="private", use_cache=False).content
        except BlobNotFoundError:
            return {}
        except Exception:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _put_json(self, pathname: str, obj: dict) -> None:
        self._client.put(
            pathname,
            json.dumps(obj).encode("utf-8"),
            access="private",
            content_type="application/json",
            overwrite=True,
        )

    # -- PDF bytes ----------------------------------------------------------
    def pdf_exists(self, pdf_id: str) -> bool:
        try:
            self._client.head(self._pdf_path(pdf_id))
            return True
        except BlobNotFoundError:
            return False
        except Exception:
            return False

    def get_pdf(self, pdf_id: str) -> bytes | None:
        try:
            return self._client.get(
                self._pdf_path(pdf_id), access="private", use_cache=False
            ).content
        except BlobNotFoundError:
            return None

    def put_pdf(self, pdf_id: str, data: bytes) -> None:
        # Public + unguessable pathname: downloads are served as redirects,
        # never proxied through the serverless function.
        self._client.put(
            self._pdf_path(pdf_id),
            data,
            access="public",
            content_type="application/pdf",
            overwrite=True,
        )
        meta = self.get_meta(pdf_id)
        if meta:
            meta["size"] = len(data)
            self.put_meta(pdf_id, meta)

    def delete_pdf(self, pdf_id: str) -> None:
        try:
            self._client.delete(
                [self._pdf_path(pdf_id), self._meta_path(pdf_id), self._annot_path(pdf_id)]
            )
        except Exception:
            pass

    # -- metadata / annotations ---------------------------------------------
    def get_meta(self, pdf_id: str) -> dict:
        return self._get_json(self._meta_path(pdf_id))

    def put_meta(self, pdf_id: str, meta: dict) -> None:
        self._put_json(self._meta_path(pdf_id), meta)

    def update_meta(self, pdf_id: str, **fields) -> None:
        meta = self.get_meta(pdf_id)
        if meta:
            meta.update(fields)
            self.put_meta(pdf_id, meta)

    def get_annotations(self, pdf_id: str) -> dict:
        return self._get_json(self._annot_path(pdf_id))

    def put_annotations(self, pdf_id: str, annots: dict) -> None:
        self._put_json(self._annot_path(pdf_id), annots)

    # -- file delivery -------------------------------------------------------
    def public_url(self, pdf_id: str) -> str | None:
        return (
            f"https://{self._store_id}.public.blob.vercel-storage.com/"
            f"{self._pdf_path(pdf_id)}"
        )

    def put_result(self, data: bytes, filename: str, media_type: str) -> str | None:
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename) or "result"
        pathname = f"{self.RESULT_PREFIX}{uuid.uuid4().hex}_{safe}"
        result = self._client.put(
            pathname, data, access="public", content_type=media_type, overwrite=True
        )
        return result.url

    def count(self) -> int:
        try:
            return len(self._client.list_objects(prefix=self.META_PREFIX).blobs)
        except Exception:
            return 0

    # -- direct browser upload -------------------------------------------------
    # Mirrors @vercel/blob's generateClientTokenFromReadWriteToken so the
    # browser can PUT straight to Blob (no 4.5 MB function body limit):
    #   clientToken = "vercel_blob_client_<storeId>_<b64(sig + '.' + payload)>"
    #   sig       = HMAC-SHA256(key=rwToken, msg=payload).hexdigest()
    #   payload   = b64({"pathname", "validUntil", ...constraints})
    def create_upload_token(self, pathname: str, max_size: int = 100 * 1024 * 1024) -> str:
        token = self._token or os.environ.get("BLOB_READ_WRITE_TOKEN", "")
        store_id = _store_id_from_token(token)
        if not store_id:
            raise RuntimeError("BLOB_READ_WRITE_TOKEN is missing or malformed.")
        payload = base64.b64encode(
            json.dumps(
                {
                    "pathname": pathname,
                    "allowedContentTypes": ["application/pdf"],
                    "maximumSizeInBytes": max_size,
                    "addRandomSuffix": False,
                    "allowOverwrite": False,
                    "validUntil": int(time.time() * 1000) + 5 * 60 * 1000,
                },
                separators=(",", ":"),
            ).encode()
        ).decode()
        sig = hmac.new(token.encode(), payload.encode(), hashlib.sha256).hexdigest()
        inner = base64.b64encode(f"{sig}.{payload}".encode()).decode()
        return f"vercel_blob_client_{store_id}_{inner}"


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    """Process-wide storage singleton, selected by STORAGE_BACKEND env."""
    global _storage
    if _storage is None:
        backend = os.environ.get("STORAGE_BACKEND", "memory").strip().lower()
        if backend == "blob":
            _storage = BlobStorage()
        else:
            _storage = MemoryStorage()
    return _storage


def reset_storage() -> None:
    """Test hook: drop the singleton so the next get_storage() re-creates it."""
    global _storage
    _storage = None
