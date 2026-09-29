"""Unit tests for BlobStorage with a mocked BlobClient (no real token needed)."""

import base64
import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import MagicMock, patch

import storage
from storage import BlobStorage, _store_id_from_token


FAKE_TOKEN = "vercel_blob_rw_teststore123_secret"


class FakeBlob:
    def __init__(self, url="https://x.public.blob.vercel-storage.com/p"):
        self.url = url


class FakeGet:
    def __init__(self, content: bytes):
        self.content = content


def make_storage():
    fake_client = MagicMock()
    with patch.object(storage, "BlobClient", return_value=fake_client):
        bs = BlobStorage(token=FAKE_TOKEN)
    bs._client = fake_client
    return bs, fake_client


class TestTokenFormat(unittest.TestCase):
    def test_store_id_parsing(self):
        self.assertEqual(_store_id_from_token(FAKE_TOKEN), "teststore123")
        self.assertEqual(_store_id_from_token("garbage"), "")

    def test_upload_token_structure(self):
        bs, _ = make_storage()
        tok = bs.create_upload_token("docucraft/pdfs/pdf_abcdef123456.pdf")
        self.assertTrue(tok.startswith("vercel_blob_client_teststore123_"))
        inner = base64.b64decode(tok.split("_", 4)[4]).decode()
        sig, payload_b64 = inner.split(".", 1)
        # signature must be HMAC-SHA256(rw_token, payload_b64)
        expected = hmac.new(FAKE_TOKEN.encode(), payload_b64.encode(),
                            hashlib.sha256).hexdigest()
        self.assertEqual(sig, expected)
        payload = json.loads(base64.b64decode(payload_b64))
        self.assertEqual(payload["pathname"], "docucraft/pdfs/pdf_abcdef123456.pdf")
        self.assertEqual(payload["allowedContentTypes"], ["application/pdf"])
        self.assertFalse(payload["addRandomSuffix"])
        self.assertGreater(payload["validUntil"], int(time.time() * 1000))

    def test_upload_token_rejects_bad_token(self):
        # With no constructor token and a malformed env token, BlobStorage
        # must fail fast (constructor or token minting).
        with patch.object(storage, "BlobClient", return_value=MagicMock()):
            with patch.dict("os.environ", {"BLOB_READ_WRITE_TOKEN": "bad"}):
                with self.assertRaises(RuntimeError):
                    BlobStorage().create_upload_token(
                        "docucraft/pdfs/pdf_abcdef123456.pdf"
                    )


class TestBlobOps(unittest.TestCase):
    def test_put_pdf_uses_public_overwrite_and_updates_meta_size(self):
        bs, client = make_storage()
        client.get.return_value = FakeGet(json.dumps({"id": "pdf_1", "size": 10}).encode())
        bs.put_pdf("pdf_1", b"0123456789ABCDEF")
        pdf_put = client.put.call_args_list[0]
        self.assertEqual(pdf_put.args[0], "docucraft/pdfs/pdf_1.pdf")
        self.assertEqual(pdf_put.args[1], b"0123456789ABCDEF")
        self.assertEqual(pdf_put.kwargs["access"], "public")
        self.assertTrue(pdf_put.kwargs["overwrite"])
        # meta sidecar rewritten with new size
        meta_put = [c for c in client.put.call_args_list
                    if c.args[0] == "docucraft/meta/pdf_1.json"][0]
        self.assertEqual(json.loads(meta_put.args[1])["size"], 16)

    def test_get_pdf_and_missing(self):
        bs, client = make_storage()
        client.get.return_value = FakeGet(b"PDFBYTES")
        self.assertEqual(bs.get_pdf("pdf_1"), b"PDFBYTES")
        client.get.assert_called_with("docucraft/pdfs/pdf_1.pdf",
                                     access="private", use_cache=False)
        client.get.side_effect = storage.BlobNotFoundError()
        self.assertIsNone(bs.get_pdf("nope"))

    def test_pdf_exists(self):
        bs, client = make_storage()
        self.assertTrue(bs.pdf_exists("pdf_1"))
        client.head.side_effect = storage.BlobNotFoundError()
        self.assertFalse(bs.pdf_exists("nope"))

    def test_public_url(self):
        bs, _ = make_storage()
        self.assertEqual(
            bs.public_url("pdf_abc"),
            "https://teststore123.public.blob.vercel-storage.com/docucraft/pdfs/pdf_abc.pdf",
        )

    def test_put_result_returns_url(self):
        bs, client = make_storage()
        client.put.return_value = FakeBlob(url="https://x/public/r.pdf")
        url = bs.put_result(b"data", "split.pdf", "application/pdf")
        self.assertEqual(url, "https://x/public/r.pdf")
        pathname = client.put.call_args.args[0]
        self.assertTrue(pathname.startswith("docucraft/results/"))
        self.assertTrue(pathname.endswith("_split.pdf"))

    def test_annotations_roundtrip(self):
        bs, client = make_storage()
        bs.put_annotations("pdf_1", {"a1": {"type": "x"}})
        put_call = client.put.call_args
        self.assertEqual(put_call.args[0], "docucraft/annotations/pdf_1.json")
        self.assertEqual(put_call.kwargs["access"], "private")
        client.get.return_value = FakeGet(json.dumps({"a1": {"type": "x"}}).encode())
        self.assertEqual(bs.get_annotations("pdf_1"), {"a1": {"type": "x"}})
        client.get.side_effect = storage.BlobNotFoundError()
        self.assertEqual(bs.get_annotations("nope"), {})

    def test_delete_pdf_removes_sidecars(self):
        bs, client = make_storage()
        bs.delete_pdf("pdf_1")
        deleted = client.delete.call_args.args[0]
        self.assertIn("docucraft/pdfs/pdf_1.pdf", deleted)
        self.assertIn("docucraft/meta/pdf_1.json", deleted)
        self.assertIn("docucraft/annotations/pdf_1.json", deleted)


if __name__ == "__main__":
    unittest.main()
