"""FastAPI backend for DocuCraft PDF Editor - Core PDF operations + Annotations."""

import io
import os
import uuid
import base64
from typing import Optional, Union, Any
from dataclasses import dataclass
from enum import Enum

from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as PydanticBaseModel, Field

try:
    import pymupdf as fitz
except ImportError:
    import fitz


# Global in-memory storage (maps pdf_id -> bytes)
PDF_STORAGE: dict[str, bytes] = {}
PDF_METADATA: dict[str, dict] = {}
ANNOTATION_STORE: dict[str, dict[str, dict]] = {}


def normalize_color(color: Any, default: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> tuple[float, float, float]:
    """Normalize RGB color to 0.0-1.0 float tuple for PyMuPDF."""
    if not color:
        return default
    if isinstance(color, int):
        return (((color >> 16) & 255) / 255.0, ((color >> 8) & 255) / 255.0, (color & 255) / 255.0)
    if isinstance(color, (list, tuple)) and len(color) >= 3:
        r, g, b = float(color[0]), float(color[1]), float(color[2])
        if max(r, g, b) > 1.0:
            return (max(0.0, min(1.0, r / 255.0)), max(0.0, min(1.0, g / 255.0)), max(0.0, min(1.0, b / 255.0)))
        return (max(0.0, min(1.0, r)), max(0.0, min(1.0, g)), max(0.0, min(1.0, b)))
    return default


def int_to_rgb255(color: Any, default: tuple[int, int, int] = (0, 0, 0)) -> tuple[int, int, int]:
    """Normalize color to 0-255 RGB integer tuple for frontend JSON."""
    if isinstance(color, int):
        return ((color >> 16) & 255, (color >> 8) & 255, color & 255)
    if isinstance(color, (list, tuple)) and len(color) >= 3:
        r, g, b = float(color[0]), float(color[1]), float(color[2])
        if max(r, g, b) <= 1.0:
            return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))
        return (int(round(r)), int(round(g)), int(round(b)))
    return default


# ─────────────────────────────────────────────────────────────────────────────
# ANNOTATION MODELS
# ─────────────────────────────────────────────────────────────────────────────

class AnnotationType(str, Enum):
    FREEHAND = "freehand"
    TEXT_BOX = "text_box"
    HIGHLIGHT = "highlight"
    STICKY_NOTE = "sticky_note"
    STAMP = "stamp"


class Point(PydanticBaseModel):
    x: float
    y: float


class FreehandAnnotation(PydanticBaseModel):
    type: AnnotationType = AnnotationType.FREEHAND
    page: int
    points: list[Point]
    stroke_color: tuple[float, float, float] = (0, 0, 0)
    stroke_width: float = 2.0
    opacity: float = 1.0


class TextBoxAnnotation(PydanticBaseModel):
    type: AnnotationType = AnnotationType.TEXT_BOX
    page: int
    x: float
    y: float
    width: float = 200
    height: float = 100
    text: str = ""
    font_size: float = 12
    font_name: str = "helv"
    text_color: tuple[float, float, float] = (0, 0, 0)
    background_color: tuple[float, float, float] = (1, 1, 1)


class HighlightAnnotation(PydanticBaseModel):
    type: AnnotationType = AnnotationType.HIGHLIGHT
    page: int
    x: float
    y: float
    width: float = 100
    height: float = 20
    color: tuple[float, float, float] = (1, 1, 0)


class StickyNoteAnnotation(PydanticBaseModel):
    type: AnnotationType = AnnotationType.STICKY_NOTE
    page: int
    x: float
    y: float
    text: str = ""
    icon: str = "note"
    color: str = "yellow"


class StampAnnotation(PydanticBaseModel):
    type: AnnotationType = AnnotationType.STAMP
    page: int
    x: float
    y: float
    width: float = 150
    height: float = 50
    text: str = ""
    color: tuple[float, float, float] = (1, 0, 0)


AnnotationPayload = Union[
    FreehandAnnotation,
    TextBoxAnnotation,
    HighlightAnnotation,
    StickyNoteAnnotation,
    StampAnnotation
]


# ─────────────────────────────────────────────────────────────────────────────
# ROUTER
# ─────────────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/pdf", tags=["PDF Operations"])


# ─────────────────────────────────────────────────────────────────────────────
# PDF UPLOAD & EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_pdf(file: UploadFile = File(...)) -> dict:
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF document")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty PDF file uploaded")

    try:
        doc = fitz.open(stream=content, filetype="pdf")
        page_count = len(doc)
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid or corrupted PDF: {str(e)}")

    pdf_id = f"pdf_{uuid.uuid4().hex[:12]}"
    PDF_STORAGE[pdf_id] = content
    PDF_METADATA[pdf_id] = {
        "id": pdf_id,
        "filename": file.filename,
        "page_count": page_count,
        "size": len(content),
    }
    ANNOTATION_STORE[pdf_id] = {}

    return {
        "id": pdf_id,
        "filename": file.filename,
        "page_count": page_count,
        "size": len(content),
    }


@router.get("/{pdf_id}/extract-text")
async def extract_text(pdf_id: str, page: Optional[int] = Query(None)) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF document not found")

    try:
        doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open PDF: {str(e)}")

    blocks = []
    start_page = page if page is not None else 0
    end_page = page + 1 if page is not None else len(doc)

    for page_num in range(max(0, start_page), min(end_page, len(doc))):
        p = doc[page_num]
        text_dict = p.get_text("dict")
        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    span_text = span.get("text", "")
                    if not span_text.strip():
                        continue
                    bbox = span.get("bbox", [0, 0, 0, 0])
                    blocks.append({
                        "text": span_text,
                        "x": round(bbox[0], 2),
                        "y": round(bbox[1], 2),
                        "width": round(bbox[2] - bbox[0], 2),
                        "height": round(bbox[3] - bbox[1], 2),
                        "font_name": span.get("font", "helv"),
                        "font_size": round(span.get("size", 11), 1),
                        "color": int_to_rgb255(span.get("color", 0)),
                        "page": page_num,
                    })

    doc.close()
    return {"blocks": blocks, "count": len(blocks)}


# ─────────────────────────────────────────────────────────────────────────────
# IN-PLACE TEXT EDITING & ADDING
# ─────────────────────────────────────────────────────────────────────────────

class TextEditRequest(PydanticBaseModel):
    page: int
    x: float
    y: float
    width: float
    height: float
    old_text: str
    new_text: str
    font_size: Optional[float] = None
    font_name: Optional[str] = None
    color: Optional[tuple[int, int, int]] = None


class TextAddRequest(PydanticBaseModel):
    page: int
    x: float
    y: float
    text: str
    font_size: Optional[float] = 12.0
    font_name: Optional[str] = "helv"
    color: Optional[tuple[int, int, int]] = (0, 0, 0)


@router.post("/{pdf_id}/edit-text")
async def edit_text(pdf_id: str, request: TextEditRequest) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    try:
        doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open PDF: {str(e)}")

    if request.page < 0 or request.page >= len(doc):
        doc.close()
        raise HTTPException(status_code=400, detail=f"Page {request.page + 1} out of range (1-{len(doc)})")

    page = doc[request.page]

    # Calculate bounding box for redaction
    rect = fitz.Rect(
        request.x - 0.5,
        request.y - 0.5,
        request.x + max(request.width, 10) + 0.5,
        request.y + max(request.height, 8) + 0.5,
    )

    font_size = request.font_size if request.font_size and request.font_size > 0 else 11.0
    font_map = {
        "times": "times-roman",
        "times-roman": "times-roman",
        "arial": "helv",
        "helvetica": "helv",
        "courier": "courier",
    }
    font_name = font_map.get((request.font_name or "").lower(), "helv")
    text_color = normalize_color(request.color, default=(0.0, 0.0, 0.0))

    try:
        page.add_redact_annot(
            rect,
            fill=(1.0, 1.0, 1.0),
            text=request.new_text,
            fontname=font_name,
            fontsize=font_size,
            text_color=text_color,
        )
        page.apply_redactions()

        output = io.BytesIO()
        doc.save(output, garbage=3, deflate=True)
        PDF_STORAGE[pdf_id] = output.getvalue()
        if pdf_id in PDF_METADATA:
            PDF_METADATA[pdf_id]["size"] = len(PDF_STORAGE[pdf_id])
    except Exception as e:
        doc.close()
        raise HTTPException(status_code=500, detail=f"Failed to replace text: {str(e)}")

    doc.close()
    return {"success": True, "message": "Text replaced successfully"}


@router.post("/{pdf_id}/add-text")
async def add_text(pdf_id: str, request: TextAddRequest) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    try:
        doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open PDF: {str(e)}")

    if request.page < 0 or request.page >= len(doc):
        doc.close()
        raise HTTPException(status_code=400, detail=f"Page {request.page + 1} out of range")

    page = doc[request.page]
    text_color = normalize_color(request.color, default=(0.0, 0.0, 0.0))

    try:
        point = fitz.Point(request.x, request.y)
        page.insert_text(
            point,
            request.text,
            fontsize=request.font_size or 12.0,
            fontname=request.font_name or "helv",
            color=text_color,
        )
        output = io.BytesIO()
        doc.save(output, garbage=3, deflate=True)
        PDF_STORAGE[pdf_id] = output.getvalue()
        if pdf_id in PDF_METADATA:
            PDF_METADATA[pdf_id]["size"] = len(PDF_STORAGE[pdf_id])
    except Exception as e:
        doc.close()
        raise HTTPException(status_code=500, detail=f"Failed to insert text: {str(e)}")

    doc.close()
    return {"success": True, "message": "Text inserted successfully"}


# ─────────────────────────────────────────────────────────────────────────────
# OCR OPERATIONS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{pdf_id}/ocr-detect")
async def detect_scanned_pages(pdf_id: str) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    scanned_pages = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text().strip()
        images = page.get_images()
        if len(text) < 40 and len(images) > 0:
            scanned_pages.append({
                "page": page_num,
                "image_count": len(images),
                "reason": f"Only {len(text)} characters extracted, found {len(images)} image(s)."
            })

    doc.close()
    return {"scanned_pages": scanned_pages, "total_pages": len(doc)}


@router.post("/{pdf_id}/ocr")
async def perform_ocr(pdf_id: str, page: Optional[int] = Query(None)) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        raise HTTPException(status_code=503, detail="Pytesseract Python package is not installed.")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    results = []

    target_pages = [page] if page is not None else list(range(len(doc)))

    for page_num in target_pages:
        if page_num < 0 or page_num >= len(doc):
            continue

        p = doc[page_num]
        zoom = 2.0
        mat = fitz.Matrix(zoom, zoom)
        pix = p.get_pixmap(matrix=mat)
        img = Image.open(io.BytesIO(pix.tobytes("png")))

        try:
            data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        except Exception as e:
            doc.close()
            error_str = str(e)
            if "tesseract is not installed" in error_str.lower() or "not in your path" in error_str.lower():
                raise HTTPException(
                    status_code=503,
                    detail="Tesseract OCR engine is not installed or not in system PATH. Install Tesseract on your system or run via Docker."
                )
            raise HTTPException(status_code=500, detail=f"OCR execution failed: {error_str}")

        blocks = []
        for i in range(len(data.get("text", []))):
            text = (data["text"][i] or "").strip()
            if text:
                blocks.append({
                    "text": text,
                    "x": round(data["left"][i] / zoom, 2),
                    "y": round(data["top"][i] / zoom, 2),
                    "width": round(data["width"][i] / zoom, 2),
                    "height": round(data["height"][i] / zoom, 2),
                    "confidence": data.get("conf", [0])[i],
                })

        full_text = " ".join(b["text"] for b in blocks)
        results.append({
            "page": page_num,
            "blocks": blocks,
            "full_text": full_text,
            "word_count": len(blocks),
        })
        img.close()

    doc.close()
    return {"pages": results, "total_pages_processed": len(results)}


# ─────────────────────────────────────────────────────────────────────────────
# PAGE OPERATIONS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{pdf_id}/pages")
async def get_page_thumbnails(pdf_id: str, size: int = Query(160)) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    thumbnails = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        rect = page.rect
        aspect = rect.width / max(rect.height, 1)

        if aspect > 1:
            thumb_w, thumb_h = size, int(size / aspect)
        else:
            thumb_w, thumb_h = int(size * aspect), size

        mat = fitz.Matrix(thumb_w / max(rect.width, 1), thumb_h / max(rect.height, 1))
        pix = page.get_pixmap(matrix=mat)
        png_bytes = pix.tobytes("png")
        b64_str = base64.b64encode(png_bytes).decode("ascii")

        thumbnails.append({
            "page": page_num,
            "thumbnail": f"data:image/png;base64,{b64_str}",
            "width": int(rect.width),
            "height": int(rect.height),
        })

    doc.close()
    return {"pages": thumbnails, "page_count": len(thumbnails)}


@router.post("/{pdf_id}/rotate")
async def rotate_pages(pdf_id: str, pages: list[int], degrees: int = Query(..., ge=90, le=270)) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")

    for page_num in pages:
        if 0 <= page_num < len(doc):
            curr_rot = doc[page_num].rotation
            doc[page_num].set_rotation((curr_rot + degrees) % 360)

    output = io.BytesIO()
    doc.save(output, garbage=3, deflate=True)
    PDF_STORAGE[pdf_id] = output.getvalue()
    doc.close()

    return {"success": True, "rotated_pages": pages, "degrees": degrees}


@router.post("/{pdf_id}/delete-pages")
async def delete_pages(pdf_id: str, pages: list[int]) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")

    if len(pages) >= len(doc):
        doc.close()
        raise HTTPException(status_code=400, detail="Cannot delete all pages from document")

    for page_num in sorted(set(pages), reverse=True):
        if 0 <= page_num < len(doc):
            doc.delete_page(page_num)

    output = io.BytesIO()
    doc.save(output, garbage=3, deflate=True)
    PDF_STORAGE[pdf_id] = output.getvalue()
    new_page_count = len(doc)
    doc.close()

    if pdf_id in PDF_METADATA:
        PDF_METADATA[pdf_id]["page_count"] = new_page_count
        PDF_METADATA[pdf_id]["size"] = len(PDF_STORAGE[pdf_id])

    return {"success": True, "deleted": len(pages), "page_count": new_page_count}


@router.post("/{pdf_id}/reorder")
async def reorder_pages(pdf_id: str, new_order: list[int]) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")

    if len(new_order) != len(doc):
        doc.close()
        raise HTTPException(status_code=400, detail=f"Order length ({len(new_order)}) must match page count ({len(doc)})")

    new_doc = fitz.open()
    for page_num in new_order:
        if 0 <= page_num < len(doc):
            new_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)

    output = io.BytesIO()
    new_doc.save(output, garbage=3, deflate=True)
    PDF_STORAGE[pdf_id] = output.getvalue()

    new_doc.close()
    doc.close()

    return {"success": True, "new_order": new_order}


@router.post("/{pdf_id}/insert-blank-page")
async def insert_blank_page(
    pdf_id: str,
    after_page: Optional[int] = Query(None),
    width: float = 595.0,
    height: float = 842.0
) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    pno = (after_page + 1) if after_page is not None else len(doc)
    doc.new_page(pno=pno, width=width, height=height)

    output = io.BytesIO()
    doc.save(output, garbage=3, deflate=True)
    PDF_STORAGE[pdf_id] = output.getvalue()
    new_page_count = len(doc)
    doc.close()

    if pdf_id in PDF_METADATA:
        PDF_METADATA[pdf_id]["page_count"] = new_page_count
        PDF_METADATA[pdf_id]["size"] = len(PDF_STORAGE[pdf_id])

    return {"success": True, "page_count": new_page_count, "inserted_at": pno}


# ─────────────────────────────────────────────────────────────────────────────
# ANNOTATIONS
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{pdf_id}/annotations")
async def add_annotation(pdf_id: str, annotation: AnnotationPayload):
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    annot_id = f"annot_{uuid.uuid4().hex[:8]}"

    if pdf_id not in ANNOTATION_STORE:
        ANNOTATION_STORE[pdf_id] = {}

    data = annotation.model_dump()
    data["id"] = annot_id
    ANNOTATION_STORE[pdf_id][annot_id] = data

    return {"id": annot_id, "annotation": data}


@router.get("/{pdf_id}/annotations")
async def get_annotations(pdf_id: str):
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")
    return {"annotations": ANNOTATION_STORE.get(pdf_id, {})}


@router.put("/{pdf_id}/annotations/{annot_id}")
async def update_annotation(pdf_id: str, annot_id: str, payload: dict = Body(...)):
    if pdf_id not in ANNOTATION_STORE or annot_id not in ANNOTATION_STORE[pdf_id]:
        raise HTTPException(status_code=404, detail="Annotation not found")

    ANNOTATION_STORE[pdf_id][annot_id].update(payload)
    return {"id": annot_id, "annotation": ANNOTATION_STORE[pdf_id][annot_id]}


@router.delete("/{pdf_id}/annotations/{annot_id}")
async def delete_annotation(pdf_id: str, annot_id: str):
    if pdf_id not in ANNOTATION_STORE or annot_id not in ANNOTATION_STORE[pdf_id]:
        raise HTTPException(status_code=404, detail="Annotation not found")

    del ANNOTATION_STORE[pdf_id][annot_id]
    return {"success": True}


@router.delete("/{pdf_id}/annotations")
async def clear_annotations(pdf_id: str):
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    ANNOTATION_STORE[pdf_id] = {}
    return {"success": True}


@router.post("/{pdf_id}/export-annotations")
async def export_with_annotations(pdf_id: str):
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    try:
        doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open PDF: {str(e)}")

    annotations = ANNOTATION_STORE.get(pdf_id, {})

    for annot_id, annot_data in annotations.items():
        page_num = annot_data.get("page", 0)
        if page_num < 0 or page_num >= len(doc):
            continue

        page = doc[page_num]
        annot_type = annot_data.get("type")

        try:
            if annot_type == AnnotationType.FREEHAND.value:
                raw_points = annot_data.get("points", [])
                points = [(p["x"], p["y"]) if isinstance(p, dict) else (p.x, p.y) for p in raw_points]
                if len(points) >= 2:
                    ink_annot = page.add_ink_annot([points])
                    stroke = normalize_color(annot_data.get("stroke_color", [0, 0, 0]))
                    ink_annot.set_colors(stroke=stroke)
                    ink_annot.set_border(width=float(annot_data.get("stroke_width", 2.0)))
                    ink_annot.set_opacity(float(annot_data.get("opacity", 1.0)))
                    ink_annot.update()

            elif annot_type == AnnotationType.TEXT_BOX.value:
                x = float(annot_data.get("x", 50))
                y = float(annot_data.get("y", 50))
                w = float(annot_data.get("width", 200))
                h = float(annot_data.get("height", 80))
                rect = fitz.Rect(x, y, x + w, y + h)

                text_color = normalize_color(annot_data.get("text_color", [0, 0, 0]))
                bg_color = normalize_color(annot_data.get("background_color", [1, 1, 1]))

                page.draw_rect(rect, color=text_color, fill=bg_color, width=1)
                page.insert_textbox(
                    rect,
                    annot_data.get("text", ""),
                    fontsize=float(annot_data.get("font_size", 12)),
                    fontname=annot_data.get("font_name", "helv"),
                    color=text_color,
                )

            elif annot_type == AnnotationType.HIGHLIGHT.value:
                x = float(annot_data.get("x", 50))
                y = float(annot_data.get("y", 50))
                w = float(annot_data.get("width", 100))
                h = float(annot_data.get("height", 20))
                rect = fitz.Rect(x, y, x + w, y + h)

                hl = page.add_highlight_annot(rect)
                color = normalize_color(annot_data.get("color", [1, 1, 0]))
                hl.set_colors(stroke=color)
                hl.set_opacity(0.4)
                hl.update()

            elif annot_type == AnnotationType.STICKY_NOTE.value:
                x = float(annot_data.get("x", 50))
                y = float(annot_data.get("y", 50))
                point = fitz.Point(x, y)
                text_annot = page.add_text_annot(
                    point=point,
                    text=annot_data.get("text", ""),
                    icon=annot_data.get("icon", "note"),
                )
                text_annot.update()

            elif annot_type == AnnotationType.STAMP.value:
                x = float(annot_data.get("x", 50))
                y = float(annot_data.get("y", 50))
                w = float(annot_data.get("width", 150))
                h = float(annot_data.get("height", 50))
                rect = fitz.Rect(x, y, x + w, y + h)

                color = normalize_color(annot_data.get("color", [0.8, 0.1, 0.1]))
                shape = page.new_shape()
                shape.draw_rect(rect)
                shape.finish(fill=color, color=color, width=2)
                shape.commit()

                page.insert_textbox(
                    rect,
                    annot_data.get("text", "STAMP"),
                    fontsize=16,
                    fontname="helv",
                    color=(1.0, 1.0, 1.0),
                    align=fitz.TEXT_ALIGN_CENTER,
                )
        except Exception as e:
            print(f"Warning: Failed to render annotation {annot_id}: {e}")
            continue

    output = io.BytesIO()
    doc.save(output, garbage=3, deflate=True)
    doc.close()

    raw_filename = PDF_METADATA.get(pdf_id, {}).get("filename", f"{pdf_id}.pdf")
    clean_name = raw_filename.rsplit(".", 1)[0]
    export_filename = f"{clean_name}_annotated.pdf"

    return StreamingResponse(
        io.BytesIO(output.getvalue()),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{export_filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# PDF DOWNLOAD & HEALTH
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{pdf_id}/download")
async def download_pdf(pdf_id: str, filename: Optional[str] = Query(None)):
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    stored_name = PDF_METADATA.get(pdf_id, {}).get("filename", f"{pdf_id}.pdf")
    target_filename = filename or stored_name
    if not target_filename.lower().endswith(".pdf"):
        target_filename = f"{target_filename}.pdf"

    return StreamingResponse(
        io.BytesIO(PDF_STORAGE[pdf_id]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{target_filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/{pdf_id}/info")
async def get_pdf_info(pdf_id: str):
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    metadata = PDF_METADATA.get(pdf_id, {})
    return {
        "id": pdf_id,
        "filename": metadata.get("filename", f"{pdf_id}.pdf"),
        "page_count": metadata.get("page_count", 0),
        "size": len(PDF_STORAGE[pdf_id]),
        "annotation_count": len(ANNOTATION_STORE.get(pdf_id, {})),
    }


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "DocuCraft PDF API",
        "documents_active": len(PDF_STORAGE),
    }
