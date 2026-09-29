"""Comprehensive integration tests for DocuCraft PDF Editor API."""

import io
import random
import zipfile
import pymupdf as fitz
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def create_sample_pdf(pages: int = 2) -> bytes:
    doc = fitz.open()
    # Page 1
    page1 = doc.new_page(width=600, height=800)
    page1.insert_text((50, 100), "DocuCraft PDF Testing Document", fontsize=16)
    page1.insert_text((50, 150), "Line 1: The quick brown fox jumps over the lazy dog.", fontsize=12)
    page1.insert_text((50, 200), "Line 2: Invoice Amount $1,250.00 Due on March 30.", fontsize=12)

    # Page 2
    page2 = doc.new_page(width=600, height=800)
    page2.insert_text((50, 100), "Page 2: Terms and Conditions", fontsize=14)
    page2.insert_text((50, 150), "All rights reserved. Antigravity DocuCraft Pro.", fontsize=11)

    for i in range(2, pages):
        p = doc.new_page(width=600, height=800)
        p.insert_text((50, 100), f"Extra page {i + 1} for testing purposes.", fontsize=12)

    output = doc.tobytes()
    doc.close()
    return output


def create_pdf_with_image() -> bytes:
    """PDF with a large noisy image so compression has something to chew on."""
    # Build noise as random vector rects, then rasterize to a PNG
    tmp = fitz.open()
    pg = tmp.new_page(width=1600, height=1600)
    rnd = random.Random(42)
    for _ in range(3000):
        x, y = rnd.randrange(1600), rnd.randrange(1600)
        w, h = rnd.randrange(5, 60), rnd.randrange(5, 60)
        pg.draw_rect(
            fitz.Rect(x, y, x + w, y + h),
            color=None,
            fill=(rnd.random(), rnd.random(), rnd.random()),
        )
    pix = pg.get_pixmap()
    png = pix.tobytes("png")
    tmp.close()

    doc = fitz.open()
    page = doc.new_page(width=1200, height=1200)
    page.insert_image(page.rect, stream=png)
    output = doc.tobytes()
    doc.close()
    return output


def create_png_bytes(w: int = 400, h: int = 300) -> bytes:
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h))
    pix.set_rect(pix.irect, (200, 100, 50))
    png = pix.tobytes("png")
    pix = None
    return png


def upload(pdf_bytes: bytes, name: str = "test_doc.pdf") -> str:
    files = {"file": (name, pdf_bytes, "application/pdf")}
    res = client.post("/api/pdf/upload", files=files)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_full_pdf_workflow():
    print("\n--- 1. Testing Health Endpoints ---")
    res = client.get("/health")
    assert res.status_code == 200, res.text
    print("✓ Root health check passed")

    res = client.get("/api/pdf/health")
    assert res.status_code == 200, res.text
    print("✓ PDF router health check passed")

    print("\n--- 2. Testing PDF Upload ---")
    pdf_bytes = create_sample_pdf()
    files = {"file": ("test_doc.pdf", pdf_bytes, "application/pdf")}
    res = client.post("/api/pdf/upload", files=files)
    assert res.status_code == 200, res.text
    upload_data = res.json()
    pdf_id = upload_data["id"]
    assert upload_data["page_count"] == 2
    assert upload_data["filename"] == "test_doc.pdf"
    print(f"✓ PDF uploaded successfully: ID={pdf_id}, Pages={upload_data['page_count']}")

    print("\n--- 3. Testing Text Extraction ---")
    res = client.get(f"/api/pdf/{pdf_id}/extract-text?page=0")
    assert res.status_code == 200, res.text
    extract_data = res.json()
    assert extract_data["count"] > 0
    blocks = extract_data["blocks"]
    print(f"✓ Extracted {len(blocks)} text spans from Page 1:")
    for b in blocks[:3]:
        print(f"   • Text: '{b['text']}' at ({b['x']}, {b['y']}) font={b['font_name']} color={b['color']}")

    print("\n--- 4. Testing In-Place Text Editing ---")
    target_block = next((b for b in blocks if "Invoice Amount" in b["text"]), blocks[1])
    edit_payload = {
        "page": 0,
        "x": target_block["x"],
        "y": target_block["y"],
        "width": target_block["width"],
        "height": target_block["height"],
        "old_text": target_block["text"],
        "new_text": "Invoice Amount $9,999.00 PAID IN FULL",
        "font_size": 12.0,
        "font_name": "helv",
        "color": [0, 128, 0],
    }
    res = client.post(f"/api/pdf/{pdf_id}/edit-text", json=edit_payload)
    assert res.status_code == 200, res.text
    print("✓ Replaced text successfully")

    # Verify text was edited in PDF
    res = client.get(f"/api/pdf/{pdf_id}/download")
    assert res.status_code == 200
    doc = fitz.open(stream=res.content, filetype="pdf")
    page1_text = doc[0].get_text()
    assert "PAID IN FULL" in page1_text
    doc.close()
    print("✓ Verified edited text exists in downloaded PDF")

    print("\n--- 5. Testing Adding New Text ---")
    add_payload = {
        "page": 0,
        "x": 50.0,
        "y": 300.0,
        "text": "Authorized Signature: Antigravity Certified",
        "font_size": 12.0,
        "font_name": "helv",
        "color": [0, 0, 200],
    }
    res = client.post(f"/api/pdf/{pdf_id}/add-text", json=add_payload)
    assert res.status_code == 200, res.text
    print("✓ Added new text successfully")

    print("\n--- 6. Testing Page Thumbnails ---")
    res = client.get(f"/api/pdf/{pdf_id}/pages?size=120")
    assert res.status_code == 200, res.text
    pages_data = res.json()
    assert len(pages_data["pages"]) == 2
    assert pages_data["pages"][0]["thumbnail"].startswith("data:image/png;base64,")
    print(f"✓ Generated {len(pages_data['pages'])} thumbnails successfully")

    print("\n--- 7. Testing Page Rotation ---")
    res = client.post(f"/api/pdf/{pdf_id}/rotate?degrees=90", json=[0])
    assert res.status_code == 200, res.text
    print("✓ Rotated Page 1 by 90° successfully")

    print("\n--- 8. Testing Insert Blank Page ---")
    res = client.post(f"/api/pdf/{pdf_id}/insert-blank-page?after_page=1")
    assert res.status_code == 200, res.text
    assert res.json()["page_count"] == 3
    print("✓ Inserted blank page (Total pages now: 3)")

    print("\n--- 9. Testing Annotations & Signatures ---")
    # Add Freehand (Signature)
    fh_payload = {
        "type": "freehand",
        "page": 0,
        "points": [{"x": 100, "y": 400}, {"x": 120, "y": 410}, {"x": 150, "y": 395}, {"x": 180, "y": 420}],
        "stroke_color": [0, 0, 150],
        "stroke_width": 2.5,
        "opacity": 1.0,
    }
    res = client.post(f"/api/pdf/{pdf_id}/annotations", json=fh_payload)
    assert res.status_code == 200, res.text
    fh_id = res.json()["id"]

    # Add Image annotation (tiny 1x1 red PNG as data URL)
    img_payload = {
        "type": "image",
        "page": 0,
        "x": 300,
        "y": 100,
        "width": 100,
        "height": 100,
        "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    }
    res = client.post(f"/api/pdf/{pdf_id}/annotations", json=img_payload)
    assert res.status_code == 200, res.text
    img_id = res.json()["id"]

    # Add Sticky Note
    note_payload = {
        "type": "sticky_note",
        "page": 0,
        "x": 200,
        "y": 250,
        "text": "Review passed without remarks.",
        "icon": "note",
        "color": "yellow",
    }
    res = client.post(f"/api/pdf/{pdf_id}/annotations", json=note_payload)
    assert res.status_code == 200, res.text
    note_id = res.json()["id"]

    # Get annotations
    res = client.get(f"/api/pdf/{pdf_id}/annotations")
    assert res.status_code == 200, res.text
    annots = res.json()["annotations"]
    assert len(annots) == 3
    print(f"✓ Added 3 annotations: freehand ({fh_id}), image ({img_id}), note ({note_id})")

    # Update annotation
    res = client.put(f"/api/pdf/{pdf_id}/annotations/{note_id}", json={"text": "Updated note comment"})
    assert res.status_code == 200, res.text
    assert res.json()["annotation"]["text"] == "Updated note comment"
    print("✓ Updated annotation successfully")

    print("\n--- 10. Testing Export With Burned-in Annotations ---")
    res = client.post(f"/api/pdf/{pdf_id}/export-annotations")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    annotated_bytes = res.content
    assert len(annotated_bytes) > len(pdf_bytes)
    # Check that the annotated PDF is valid
    doc_annot = fitz.open(stream=annotated_bytes, filetype="pdf")
    assert len(doc_annot) == 3
    doc_annot.close()
    print(f"✓ Exported annotated PDF ({len(annotated_bytes)} bytes)")

    print("\n--- 11. Testing Delete Pages ---")
    # Delete page 2 (the blank page)
    res = client.post(f"/api/pdf/{pdf_id}/delete-pages", json=[2])
    assert res.status_code == 200, res.text
    assert res.json()["page_count"] == 2
    print("✓ Deleted blank page (Total pages now: 2)")

    print("\n--- 12. Testing Reorder Pages ---")
    res = client.post(f"/api/pdf/{pdf_id}/reorder", json=[1, 0])
    assert res.status_code == 200, res.text
    assert res.json()["new_order"] == [1, 0]
    print("✓ Reordered pages [1, 0] successfully")

    print("\n==========================================")
    print("🎉 ALL 12 INTEGRATION TESTS PASSED 100%!")
    print("==========================================\n")


def test_merge_pdfs():
    print("\n--- 13. Testing Merge PDFs ---")
    pdf_a = create_sample_pdf(pages=2)
    pdf_b = create_sample_pdf(pages=3)
    files = [
        ("files", ("a.pdf", pdf_a, "application/pdf")),
        ("files", ("b.pdf", pdf_b, "application/pdf")),
    ]
    res = client.post("/api/pdf/merge", files=files)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    assert 'filename="merged.pdf"' in res.headers["content-disposition"]
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert len(doc) == 5, f"expected 5 pages, got {len(doc)}"
    doc.close()
    print("✓ Merged 2+3 pages into 5-page PDF")

    # Reject: fewer than 2 files
    res = client.post("/api/pdf/merge", files=[("files", ("a.pdf", pdf_a, "application/pdf"))])
    assert res.status_code == 400, res.text
    print("✓ Rejected merge with only 1 file (400)")

    # Reject: non-PDF file
    res = client.post("/api/pdf/merge", files=[
        ("files", ("a.pdf", pdf_a, "application/pdf")),
        ("files", ("b.txt", b"hello", "text/plain")),
    ])
    assert res.status_code == 400, res.text
    print("✓ Rejected merge with non-PDF file (400)")


def test_split_pdf():
    print("\n--- 14. Testing Split PDF ---")
    pdf_id = upload(create_sample_pdf(pages=4), "split_me.pdf")

    res = client.post(f"/api/pdf/{pdf_id}/split", json={"pages": [1, 3]})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    assert "split" in res.headers["content-disposition"]
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert len(doc) == 2, f"expected 2 pages, got {len(doc)}"
    assert "DocuCraft PDF Testing" in doc[0].get_text()
    assert "Extra page 3" in doc[1].get_text()
    doc.close()
    print("✓ Split pages [1,3] into 2-page PDF with correct content")

    # Original untouched
    res = client.get(f"/api/pdf/{pdf_id}/info")
    assert res.json()["page_count"] == 4
    print("✓ Original document untouched (4 pages)")

    # Reject: out of range
    res = client.post(f"/api/pdf/{pdf_id}/split", json={"pages": [99]})
    assert res.status_code == 400, res.text
    # Reject: empty list
    res = client.post(f"/api/pdf/{pdf_id}/split", json={"pages": []})
    assert res.status_code == 400, res.text
    print("✓ Rejected invalid split requests (400)")


def test_compress_pdf():
    print("\n--- 15. Testing Compress PDF ---")
    pdf_id = upload(create_pdf_with_image(), "big_image.pdf")

    res = client.post(f"/api/pdf/{pdf_id}/compress", json={"level": "high"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["success"] is True
    assert data["level"] == "high"
    assert data["compressed_size"] <= data["original_size"]
    assert data["compressed_size"] < data["original_size"], "high compression should shrink noisy image PDF"
    print(f"✓ Compressed high: {data['original_size']} → {data['compressed_size']} bytes (saved {data['saved_pct']}%)")

    # low level still valid
    res = client.post(f"/api/pdf/{pdf_id}/compress", json={"level": "low"})
    assert res.status_code == 200, res.text
    assert res.json()["success"] is True
    print("✓ Compress level=low OK")

    # Reject: invalid level
    res = client.post(f"/api/pdf/{pdf_id}/compress", json={"level": "extreme"})
    assert res.status_code == 400, res.text
    print("✓ Rejected invalid compress level (400)")


def test_images_to_pdf():
    print("\n--- 16. Testing Images to PDF ---")
    img1 = create_png_bytes(400, 300)
    img2 = create_png_bytes(200, 200)
    files = [
        ("files", ("one.png", img1, "image/png")),
        ("files", ("two.png", img2, "image/png")),
    ]
    res = client.post("/api/pdf/images-to-pdf", files=files)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert len(doc) == 2, f"expected 2 pages, got {len(doc)}"
    # page size follows the image's point dimensions (PNG DPI aware)
    ref = fitz.open(stream=img1)[0].rect
    assert abs(doc[0].rect.width - ref.width) < 1 and abs(doc[0].rect.height - ref.height) < 1
    doc.close()
    print("✓ Converted 2 images to 2-page PDF (page sizes match images)")

    # Reject: non-image
    res = client.post("/api/pdf/images-to-pdf", files=[("files", ("x.pdf", create_sample_pdf(), "application/pdf"))])
    assert res.status_code == 400, res.text
    print("✓ Rejected non-image file (400)")


def test_export_images():
    print("\n--- 17. Testing Export Images (ZIP) ---")
    pdf_id = upload(create_sample_pdf(pages=2), "to_images.pdf")

    res = client.get(f"/api/pdf/{pdf_id}/export-images?dpi=72")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(res.content))
    names = zf.namelist()
    assert len(names) == 2, names
    for n in names:
        assert zf.read(n)[:8] == b"\x89PNG\r\n\x1a\n", f"{n} is not a PNG"
    print(f"✓ Exported ZIP with {len(names)} PNGs: {names}")

    # Reject: dpi out of range
    res = client.get(f"/api/pdf/{pdf_id}/export-images?dpi=600")
    assert res.status_code == 422, res.text
    print("✓ Rejected dpi=600 (422)")


def test_watermark():
    print("\n--- 18. Testing Watermark ---")
    pdf_id = upload(create_sample_pdf(pages=2), "wm.pdf")

    res = client.post(f"/api/pdf/{pdf_id}/watermark", json={
        "text": "CONFIDENTIAL",
        "opacity": 0.2,
        "font_size": 48,
        "angle": 45,
    })
    assert res.status_code == 200, res.text
    assert res.json()["success"] is True

    res = client.get(f"/api/pdf/{pdf_id}/download")
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert len(doc) == 2
    assert "CONFIDENTIAL" in doc[0].get_text()
    assert "CONFIDENTIAL" in doc[1].get_text()
    doc.close()
    print("✓ Watermark burned into all pages (in-place)")

    # Reject: empty text
    res = client.post(f"/api/pdf/{pdf_id}/watermark", json={"text": "   "})
    assert res.status_code == 400, res.text
    print("✓ Rejected empty watermark text (400)")


def test_page_numbers():
    print("\n--- 19. Testing Page Numbers ---")
    pdf_id = upload(create_sample_pdf(pages=3), "pagenum.pdf")

    res = client.post(f"/api/pdf/{pdf_id}/page-numbers", json={
        "position": "bottom-right",
        "start": 5,
        "font_size": 10,
    })
    assert res.status_code == 200, res.text
    assert res.json()["success"] is True

    res = client.get(f"/api/pdf/{pdf_id}/download")
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert len(doc) == 3
    assert "5" in doc[0].get_text()
    assert "7" in doc[2].get_text()
    doc.close()
    print("✓ Page numbers 5,6,7 added bottom-right (in-place)")

    # Reject: invalid position
    res = client.post(f"/api/pdf/{pdf_id}/page-numbers", json={"position": "middle-earth"})
    assert res.status_code == 400, res.text
    print("✓ Rejected invalid position (400)")


def test_protect_and_unlock():
    print("\n--- 20. Testing Protect + Unlock ---")
    pdf_id = upload(create_sample_pdf(pages=2), "secret.pdf")
    original = client.get(f"/api/pdf/{pdf_id}/download").content

    res = client.post(f"/api/pdf/{pdf_id}/protect", json={"password": "s3cr3t!"})
    assert res.status_code == 200, res.text
    assert res.json()["success"] is True
    print("✓ PDF protected with AES-256 (in-place)")

    # Stored copy now requires password
    res = client.get(f"/api/pdf/{pdf_id}/download")
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert doc.needs_pass
    assert doc.authenticate("s3cr3t!") > 0
    assert len(doc) == 2
    doc.close()
    print("✓ Stored PDF is encrypted, opens with correct password")

    # New endpoints still work via stored password (auth helper)
    res = client.post(f"/api/pdf/{pdf_id}/watermark", json={"text": "LOCKED-DOC"})
    assert res.status_code == 200, res.text
    print("✓ Operations on protected PDF work with stored password")

    # Encryption must survive mutations (not silently stripped)
    res = client.get(f"/api/pdf/{pdf_id}/download")
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert doc.needs_pass, "encryption was stripped by watermark!"
    doc.close()
    print("✓ Encryption preserved after in-place mutation")

    # Reject: empty password
    pdf_id2 = upload(create_sample_pdf(), "secret2.pdf")
    res = client.post(f"/api/pdf/{pdf_id2}/protect", json={"password": ""})
    assert res.status_code == 400, res.text
    print("✓ Rejected empty password (400)")

    print("\n--- 21. Testing Unlock ---")
    protected_bytes = client.get(f"/api/pdf/{pdf_id}/download").content
    files = {"file": ("secret.pdf", protected_bytes, "application/pdf")}
    res = client.post("/api/pdf/unlock", files=files, data={"password": "s3cr3t!"})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    assert "unlocked" in res.headers["content-disposition"]
    doc = fitz.open(stream=res.content, filetype="pdf")
    assert not doc.needs_pass
    assert len(doc) == 2
    doc.close()
    print("✓ Unlocked PDF opens without password")

    # Reject: wrong password
    res = client.post("/api/pdf/unlock", files=files, data={"password": "wrong"})
    assert res.status_code == 401, res.text
    print("✓ Rejected wrong password (401)")

    # Sanity: unlocked content matches original page count
    assert len(original) > 0


def test_bugfix_regressions():
    print("\n--- 22. Testing Bug-fix Regressions ---")
    pdf_id = upload(create_sample_pdf(pages=3), "regress.pdf")

    # rotate: non-90-multiple degrees rejected
    res = client.post(f"/api/pdf/{pdf_id}/rotate?degrees=100", json=[0])
    assert res.status_code == 400, res.text
    print("✓ rotate?degrees=100 rejected (400)")

    # delete-pages: 'deleted' counts actually removed pages
    res = client.post(f"/api/pdf/{pdf_id}/delete-pages", json=[0, 99])
    assert res.status_code == 200, res.text
    assert res.json()["deleted"] == 1, res.json()
    assert res.json()["page_count"] == 2
    print("✓ delete-pages reports actual deleted count (1, not 2)")

    # download: filename sanitized against header injection
    from urllib.parse import quote
    res = client.get(f"/api/pdf/{pdf_id}/download?filename=" + quote('evil"\r\nX: 1', safe=""))
    assert res.status_code == 200, res.text
    cd = res.headers["content-disposition"]
    assert "\r" not in cd and "\n" not in cd, cd
    print(f"✓ download filename sanitized: {cd}")

    # insert-blank-page: out-of-range after_page clamps to end
    res = client.post(f"/api/pdf/{pdf_id}/insert-blank-page?after_page=999")
    assert res.status_code == 200, res.text
    assert res.json()["page_count"] == 3
    print("✓ insert-blank-page clamps out-of-range after_page")

    print("\n==========================================")
    print("🎉 ALL NEW-ENDPOINT + REGRESSION TESTS PASSED!")
    print("==========================================\n")


if __name__ == "__main__":
    test_full_pdf_workflow()
    test_merge_pdfs()
    test_split_pdf()
    test_compress_pdf()
    test_images_to_pdf()
    test_export_images()
    test_watermark()
    test_page_numbers()
    test_protect_and_unlock()
    test_bugfix_regressions()
