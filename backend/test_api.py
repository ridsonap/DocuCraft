"""Comprehensive integration tests for DocuCraft PDF Editor API."""

import io
import pymupdf as fitz
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def create_sample_pdf() -> bytes:
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

    output = doc.tobytes()
    doc.close()
    return output


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

    # Add Stamp
    stamp_payload = {
        "type": "stamp",
        "page": 0,
        "x": 300,
        "y": 100,
        "width": 150,
        "height": 50,
        "text": "APPROVED",
        "color": [0, 180, 0],
    }
    res = client.post(f"/api/pdf/{pdf_id}/annotations", json=stamp_payload)
    assert res.status_code == 200, res.text
    stamp_id = res.json()["id"]

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
    print(f"✓ Added 3 annotations: freehand ({fh_id}), stamp ({stamp_id}), note ({note_id})")

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


if __name__ == "__main__":
    test_full_pdf_workflow()
