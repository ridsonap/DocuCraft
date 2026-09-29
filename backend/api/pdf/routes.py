"""FastAPI backend for DocuCraft PDF Editor - Core PDF operations + Annotations."""

import io
import os
import re
import uuid
import base64
import zipfile
from typing import Optional, Union, Any
from dataclasses import dataclass
from enum import Enum

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query, Body
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


def find_matching_span(
    page,
    old_text: Optional[str],
    x: float,
    y: float,
    width: float = 0.0,
    height: float = 0.0,
) -> Optional[dict]:
    """Find the exact span in page text_dict that matches the target text block.
    Returns the span dictionary if matched, or None.
    """
    text_dict = page.get_text("dict")
    clean_old = old_text.strip().lower() if old_text else ""
    best_span = None
    best_score = -1

    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                span_text = span.get("text", "").strip().lower()
                bbox = span.get("bbox", [0, 0, 0, 0])
                sx, sy = bbox[0], bbox[1]
                dist = (sx - x) ** 2 + (sy - y) ** 2

                score = 0
                if dist < 4:
                    score += 50
                elif dist < 25:
                    score += 30
                elif dist < 400:
                    score += 10

                if clean_old:
                    if span_text == clean_old:
                        score += 50
                    elif clean_old in span_text or span_text in clean_old:
                        score += 30
                    else:
                        words_old = set(clean_old.split())
                        words_span = set(span_text.split())
                        overlap = words_old & words_span
                        if overlap:
                            score += len(overlap) * 10

                if score > best_score:
                    best_score = score
                    best_span = span

    return best_span if best_score >= 20 else None


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
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
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
        "filename": filename or "document.pdf",
        "page_count": page_count,
        "size": len(content),
    }
    ANNOTATION_STORE[pdf_id] = {}

    return {
        "id": pdf_id,
        "filename": filename or "document.pdf",
        "page_count": page_count,
        "size": len(content),
    }


# ─────────────────────────────────────────────────────────────────────────────
# SHARED HELPERS (new endpoints)
# ─────────────────────────────────────────────────────────────────────────────

def _open_stored_pdf(pdf_id: str):
    """Open a stored PDF, authenticating with the stored password if encrypted."""
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF document not found")
    try:
        doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open PDF: {str(e)}")
    if doc.needs_pass:
        pw = PDF_METADATA.get(pdf_id, {}).get("password")
        if not pw or not doc.authenticate(pw):
            doc.close()
            raise HTTPException(status_code=401, detail="PDF is password protected")
    return doc


def _persist_pdf(pdf_id: str, doc, **save_kwargs) -> bytes:
    """Save doc back into in-memory storage and refresh metadata size.
    Re-applies stored encryption settings so mutations don't strip protection."""
    output = io.BytesIO()
    enc_kwargs = PDF_METADATA.get(pdf_id, {}).get("enc_kwargs", {})
    doc.save(output, garbage=4, deflate=True, **{**enc_kwargs, **save_kwargs})
    data = output.getvalue()
    PDF_STORAGE[pdf_id] = data
    if pdf_id in PDF_METADATA:
        PDF_METADATA[pdf_id]["size"] = len(data)
    return data


def _file_response(data: bytes, filename: str, media_type: str = "application/pdf") -> StreamingResponse:
    safe_name = re.sub(r'[\\"/\r\n]', "_", filename or "file.pdf").strip() or "file.pdf"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


def _stem(pdf_id: str, fallback: str) -> str:
    raw = PDF_METADATA.get(pdf_id, {}).get("filename", fallback)
    return raw.rsplit(".", 1)[0] if "." in raw else raw


# ─────────────────────────────────────────────────────────────────────────────
# MERGE / IMAGES-TO-PDF / UNLOCK (no pdf_id)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/merge")
async def merge_pdfs(files: list[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="At least 2 PDF files are required to merge")

    merged = fitz.open()
    try:
        for f in files:
            fname = (f.filename or "").lower()
            if not fname.endswith(".pdf"):
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' is not a PDF")
            content = await f.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' is empty")
            try:
                src = fitz.open(stream=content, filetype="pdf")
            except Exception:
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' is not a valid PDF")
            if src.needs_pass:
                src.close()
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' is password protected")
            merged.insert_pdf(src)
            src.close()

        output = io.BytesIO()
        merged.save(output, garbage=4, deflate=True)
        data = output.getvalue()
    finally:
        merged.close()

    if not data:
        raise HTTPException(status_code=400, detail="Merged document is empty")
    return _file_response(data, "merged.pdf")


IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif")


@router.post("/images-to-pdf")
async def images_to_pdf(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="At least 1 image file is required")

    pdf = fitz.open()
    try:
        for f in files:
            fname = (f.filename or "").lower()
            if not fname.endswith(IMAGE_EXTENSIONS):
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' is not a supported image")
            content = await f.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' is empty")
            try:
                img_doc = fitz.open(stream=content)
                rect = img_doc[0].rect
                img_doc.close()
            except Exception:
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' is not a valid image")
            page = pdf.new_page(width=rect.width, height=rect.height)
            page.insert_image(page.rect, stream=content)

        output = io.BytesIO()
        pdf.save(output, garbage=4, deflate=True)
        data = output.getvalue()
    finally:
        pdf.close()

    return _file_response(data, "images.pdf")


@router.post("/unlock")
async def unlock_pdf(file: UploadFile = File(...), password: str = Form(...)):
    fname = (file.filename or "document.pdf")
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF document")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty PDF file uploaded")

    try:
        doc = fitz.open(stream=content, filetype="pdf")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or corrupted PDF")

    try:
        if doc.needs_pass and not doc.authenticate(password):
            raise HTTPException(status_code=401, detail="Incorrect password")
        output = io.BytesIO()
        doc.save(output, garbage=4, deflate=True)
        data = output.getvalue()
    finally:
        doc.close()

    stem = fname.rsplit(".", 1)[0]
    return _file_response(data, f"{stem}_unlocked.pdf")


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
                    font_raw = span.get("font", "helv")
                    flags = span.get("flags", 0)
                    font_lower = font_raw.lower()

                    is_bold = "bold" in font_lower or "black" in font_lower or "heavy" in font_lower or bool(flags & 16)
                    is_italic = "italic" in font_lower or "oblique" in font_lower or "slant" in font_lower or bool(flags & 2)
                    is_mono = "courier" in font_lower or "mono" in font_lower or "consolas" in font_lower or "menlo" in font_lower or bool(flags & 8)
                    is_serif = not is_mono and ("times" in font_lower or "serif" in font_lower or "georgia" in font_lower or "cambria" in font_lower or "garamond" in font_lower or bool(flags & 4))

                    font_family = "mono" if is_mono else ("serif" if is_serif else "sans")

                    origin = span.get("origin", (bbox[0], bbox[3]))
                    blocks.append({
                        "text": span_text,
                        "x": round(bbox[0], 2),
                        "y": round(bbox[1], 2),
                        "width": round(bbox[2] - bbox[0], 2),
                        "height": round(bbox[3] - bbox[1], 2),
                        "origin_x": round(origin[0], 2),
                        "origin_y": round(origin[1], 2),
                        "font_name": font_raw,
                        "font_family": font_family,
                        "is_bold": is_bold,
                        "is_italic": is_italic,
                        "font_size": round(span.get("size", 11), 1),
                        "color": int_to_rgb255(span.get("color", 0)),
                        "page": page_num,
                    })

    doc.close()
    return {"blocks": blocks, "count": len(blocks)}


# ─────────────────────────────────────────────────────────────────────────────
# IN-PLACE TEXT EDITING & ADDING
# ─────────────────────────────────────────────────────────────────────────────

def resolve_pdf_font_name(
    font_name: Optional[str] = None,
    font_family: Optional[str] = None,
    is_bold: Optional[bool] = None,
    is_italic: Optional[bool] = None,
) -> str:
    name = (font_name or "").lower()
    family = (font_family or "").lower()

    if not family:
        if "courier" in name or "mono" in name or "consolas" in name:
            family = "mono"
        elif "times" in name or "serif" in name or "georgia" in name or "cambria" in name or "garamond" in name:
            family = "serif"
        else:
            family = "sans"

    bold = is_bold if is_bold is not None else ("bold" in name or "black" in name or "heavy" in name)
    italic = is_italic if is_italic is not None else ("italic" in name or "oblique" in name or "slant" in name)

    if family == "mono":
        if bold and italic:
            return "courier-boldoblique"
        if bold:
            return "courier-bold"
        if italic:
            return "courier-oblique"
        return "courier"
    elif family == "serif":
        if bold and italic:
            return "times-bolditalic"
        if bold:
            return "times-bold"
        if italic:
            return "times-italic"
        return "times-roman"
    else:  # sans
        if bold and italic:
            return "hebi"
        if bold:
            return "hebo"
        if italic:
            return "heit"
        return "helv"


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
    font_family: Optional[str] = None
    is_bold: Optional[bool] = None
    is_italic: Optional[bool] = None
    color: Optional[tuple[int, int, int]] = None
    bg_color: Optional[tuple[int, int, int]] = None
    orig_x: Optional[float] = None
    orig_y: Optional[float] = None
    orig_width: Optional[float] = None
    orig_height: Optional[float] = None
    origin_x: Optional[float] = None
    origin_y: Optional[float] = None


class TextAddRequest(PydanticBaseModel):
    page: int
    x: float
    y: float
    text: str
    font_size: Optional[float] = 12.0
    font_name: Optional[str] = "helv"
    font_family: Optional[str] = None
    is_bold: Optional[bool] = None
    is_italic: Optional[bool] = None
    color: Optional[tuple[int, int, int]] = (0, 0, 0)
    bg_color: Optional[tuple[int, int, int]] = None


class TextDeleteRequest(PydanticBaseModel):
    page: int
    x: float
    y: float
    width: float
    height: float
    old_text: str = ""


@router.post("/{pdf_id}/delete-text")
async def delete_text(pdf_id: str, request: TextDeleteRequest) -> dict:
    """Remove text from the PDF cleanly without leaving any box or touching table lines."""
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

    matching_span = find_matching_span(
        page,
        request.old_text,
        request.x,
        request.y,
        request.width,
        request.height,
    )

    if matching_span:
        rect = fitz.Rect(matching_span["bbox"])
    else:
        rect = fitz.Rect(request.x, request.y, request.x + max(request.width, 10.0), request.y + max(request.height, 8.0))

    try:
        # fill=False removes vector text glyphs without painting any rectangle
        page.add_redact_annot(rect, fill=False)
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=0)

        output = io.BytesIO()
        doc.save(output, garbage=3, deflate=True)
        PDF_STORAGE[pdf_id] = output.getvalue()
        if pdf_id in PDF_METADATA:
            PDF_METADATA[pdf_id]["size"] = len(PDF_STORAGE[pdf_id])
    except Exception as e:
        doc.close()
        raise HTTPException(status_code=500, detail=f"Failed to delete text: {str(e)}")

    doc.close()
    return {"success": True, "message": "Text deleted successfully"}


@router.post("/{pdf_id}/edit-text")
async def edit_text(pdf_id: str, request: TextEditRequest) -> dict:
    """Edit text in place: cleanly removes old text and inserts replacement at the exact baseline."""
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

    # Find the matching text span in the PDF to get exact bbox and origin baseline
    search_x = request.orig_x if request.orig_x is not None else request.x
    search_y = request.orig_y if request.orig_y is not None else request.y
    search_w = request.orig_width if request.orig_width is not None else request.width
    search_h = request.orig_height if request.orig_height is not None else request.height

    matching_span = find_matching_span(
        page,
        request.old_text,
        search_x,
        search_y,
        search_w,
        search_h,
    )

    if matching_span:
        orig_bbox = fitz.Rect(matching_span["bbox"])
        orig_baseline_y = matching_span["origin"][1]
        orig_anchor_x = matching_span["bbox"][0]
        orig_anchor_y = matching_span["bbox"][1]
        span_font = matching_span["font"]
        span_size = matching_span["size"]
        span_color = matching_span.get("color")
    else:
        orig_bbox = fitz.Rect(search_x, search_y, search_x + max(search_w, 10.0), search_y + max(search_h, 8.0))
        orig_baseline_y = request.origin_y if request.origin_y is not None else (search_y + (request.font_size or 11.0) * 0.82)
        orig_anchor_x = search_x
        orig_anchor_y = search_y
        span_font = None
        span_size = None
        span_color = None

    # Redact the old text.
    # If bg_color is explicitly provided by the user, fill with that color.
    # If bg_color is None (transparent / default), fill=False so NO white box is drawn!
    redact_fill = normalize_color(request.bg_color) if request.bg_color is not None else False
    page.add_redact_annot(orig_bbox, fill=redact_fill)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=0)

    # Calculate target text insertion position
    dx = request.x - orig_anchor_x
    dy = request.y - orig_anchor_y
    target_x = orig_anchor_x + dx
    target_baseline_y = orig_baseline_y + dy

    font_size = request.font_size if request.font_size and request.font_size > 0 else (span_size or 11.0)
    font_name = resolve_pdf_font_name(
        request.font_name or span_font,
        request.font_family,
        request.is_bold,
        request.is_italic,
    )
    text_color = normalize_color(
        request.color,
        default=normalize_color(span_color) if span_color is not None else (0.0, 0.0, 0.0)
    )

    try:
        # If user explicitly requested an opaque background, draw the rect before inserting text
        if request.bg_color is not None:
            bg_norm = normalize_color(request.bg_color)
            f_size = font_size
            text_w = max(len(request.new_text) * f_size * 0.6, request.width)
            bg_rect = fitz.Rect(target_x, target_baseline_y - f_size * 0.85, target_x + text_w, target_baseline_y + f_size * 0.25)
            page.draw_rect(bg_rect, color=None, fill=bg_norm)

        # Insert replacement text at the exact baseline!
        insert_point = fitz.Point(target_x, target_baseline_y)
        page.insert_text(
            insert_point,
            request.new_text,
            fontname=font_name,
            fontsize=font_size,
            color=text_color,
        )

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
    font_name = resolve_pdf_font_name(
        request.font_name,
        request.font_family,
        request.is_bold,
        request.is_italic,
    )
    text_color = normalize_color(request.color, default=(0.0, 0.0, 0.0))

    try:
        if request.bg_color is not None:
            bg_norm = normalize_color(request.bg_color)
            f_size = request.font_size or 12.0
            text_w = max(len(request.text) * f_size * 0.6, 20.0)
            bg_rect = fitz.Rect(request.x, request.y - f_size, request.x + text_w, request.y + 4)
            page.draw_rect(bg_rect, color=None, fill=bg_norm)

        point = fitz.Point(request.x, request.y)
        page.insert_text(
            point,
            request.text,
            fontsize=request.font_size or 12.0,
            fontname=font_name,
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
    if degrees % 90 != 0:
        raise HTTPException(status_code=400, detail="Degrees must be a multiple of 90")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")

    for page_num in pages:
        if 0 <= page_num < len(doc):
            curr_rot = doc[page_num].rotation
            doc[page_num].set_rotation((curr_rot + degrees) % 360)

    output = io.BytesIO()
    doc.save(output, garbage=3, deflate=True)
    PDF_STORAGE[pdf_id] = output.getvalue()
    doc.close()

    if pdf_id in PDF_METADATA:
        PDF_METADATA[pdf_id]["size"] = len(PDF_STORAGE[pdf_id])

    return {"success": True, "rotated_pages": pages, "degrees": degrees}


@router.post("/{pdf_id}/delete-pages")
async def delete_pages(pdf_id: str, pages: list[int]) -> dict:
    if pdf_id not in PDF_STORAGE:
        raise HTTPException(status_code=404, detail="PDF not found")

    doc = fitz.open(stream=PDF_STORAGE[pdf_id], filetype="pdf")

    if len(pages) >= len(doc):
        doc.close()
        raise HTTPException(status_code=400, detail="Cannot delete all pages from document")

    deleted = 0
    for page_num in sorted(set(pages), reverse=True):
        if 0 <= page_num < len(doc):
            doc.delete_page(page_num)
            deleted += 1

    output = io.BytesIO()
    doc.save(output, garbage=3, deflate=True)
    PDF_STORAGE[pdf_id] = output.getvalue()
    new_page_count = len(doc)
    doc.close()

    if pdf_id in PDF_METADATA:
        PDF_METADATA[pdf_id]["page_count"] = new_page_count
        PDF_METADATA[pdf_id]["size"] = len(PDF_STORAGE[pdf_id])

    return {"success": True, "deleted": deleted, "page_count": new_page_count}


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

    if pdf_id in PDF_METADATA:
        PDF_METADATA[pdf_id]["size"] = len(PDF_STORAGE[pdf_id])

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
    if width <= 0 or height <= 0:
        doc.close()
        raise HTTPException(status_code=400, detail="width and height must be positive")
    pno = (after_page + 1) if after_page is not None else len(doc)
    pno = max(0, min(pno, len(doc)))
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
# SPLIT / COMPRESS / EXPORT IMAGES / WATERMARK / PAGE NUMBERS / PROTECT
# ─────────────────────────────────────────────────────────────────────────────

class SplitRequest(PydanticBaseModel):
    pages: list[int]  # 1-based page numbers


@router.post("/{pdf_id}/split")
async def split_pdf(pdf_id: str, request: SplitRequest):
    doc = _open_stored_pdf(pdf_id)
    try:
        if not request.pages:
            raise HTTPException(status_code=400, detail="Page list cannot be empty")
        for p in request.pages:
            if p < 1 or p > len(doc):
                raise HTTPException(status_code=400, detail=f"Page {p} out of range (1-{len(doc)})")

        new_doc = fitz.open()
        try:
            for p in request.pages:
                new_doc.insert_pdf(doc, from_page=p - 1, to_page=p - 1)
            output = io.BytesIO()
            new_doc.save(output, garbage=4, deflate=True)
            data = output.getvalue()
        finally:
            new_doc.close()
    finally:
        doc.close()

    return _file_response(data, f"{_stem(pdf_id, pdf_id)}_split.pdf")


class CompressRequest(PydanticBaseModel):
    level: str = "medium"  # low | medium | high


@router.post("/{pdf_id}/compress")
async def compress_pdf(pdf_id: str, request: CompressRequest) -> dict:
    level = (request.level or "medium").lower()
    if level not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="level must be one of: low, medium, high")

    doc = _open_stored_pdf(pdf_id)
    original_size = len(PDF_STORAGE[pdf_id])
    try:
        if level == "high":
            # Downscale large images (target <=1200px) and re-encode as JPEG
            for page in doc:
                for img in page.get_images(full=True):
                    xref = img[0]
                    try:
                        pix = fitz.Pixmap(doc, xref)
                    except Exception:
                        continue
                    try:
                        if pix.alpha or pix.n > 3:
                            continue  # keep transparency/CMYK images as-is
                        factor = max(2, -(-max(pix.width, pix.height) // 1200))
                        if max(pix.width, pix.height) > 1200:
                            pix.shrink(factor)
                            doc.update_stream(xref, pix.tobytes("jpg", jpg_quality=65))
                    except Exception:
                        continue
                    finally:
                        pix = None

        data = _persist_pdf(pdf_id, doc, clean=(level != "low"))
    finally:
        doc.close()

    compressed_size = len(data)
    saved_pct = round((1 - compressed_size / original_size) * 100, 2) if original_size else 0.0
    return {
        "success": True,
        "level": level,
        "original_size": original_size,
        "compressed_size": compressed_size,
        "saved_pct": saved_pct,
    }


@router.get("/{pdf_id}/export-images")
async def export_images(pdf_id: str, dpi: int = Query(150, ge=72, le=300)):
    doc = _open_stored_pdf(pdf_id)
    try:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for i, page in enumerate(doc):
                pix = page.get_pixmap(dpi=dpi)
                zf.writestr(f"page_{i + 1:03d}.png", pix.tobytes("png"))
        data = buf.getvalue()
    finally:
        doc.close()

    return _file_response(data, f"{_stem(pdf_id, pdf_id)}_pages.zip", media_type="application/zip")


class WatermarkRequest(PydanticBaseModel):
    text: str
    opacity: float = 0.15
    font_size: float = 48
    angle: float = 45


@router.post("/{pdf_id}/watermark")
async def add_watermark(pdf_id: str, request: WatermarkRequest) -> dict:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Watermark text cannot be empty")
    opacity = max(0.05, min(1.0, request.opacity))

    doc = _open_stored_pdf(pdf_id)
    try:
        font = fitz.Font("helv")
        rot = fitz.Matrix(1, 1).prerotate(request.angle)
        fs = request.font_size
        for page in doc:
            rect = page.rect
            cx, cy = rect.width / 2, rect.height / 2
            tw_len = fitz.get_text_length(request.text, fontname="helv", fontsize=fs)
            # Anchor text midpoint at page center; morph rotates about the anchor
            start = fitz.Point(cx - tw_len / 2, cy + fs * 0.35)
            tw = fitz.TextWriter(rect)
            tw.append(start, request.text, font=font, fontsize=fs)
            tw.write_text(
                page,
                color=(0.45, 0.45, 0.45),
                opacity=opacity,
                overlay=True,
                morph=(fitz.Point(cx, cy), rot),
            )

        _persist_pdf(pdf_id, doc)
    finally:
        doc.close()

    return {"success": True}


class PageNumberRequest(PydanticBaseModel):
    position: str = "bottom-center"  # bottom/top + left/center/right
    start: int = 1
    font_size: float = 10


@router.post("/{pdf_id}/page-numbers")
async def add_page_numbers(pdf_id: str, request: PageNumberRequest) -> dict:
    pos = (request.position or "bottom-center").lower()
    valid = ("bottom-left", "bottom-center", "bottom-right", "top-left", "top-center", "top-right")
    if pos not in valid:
        raise HTTPException(status_code=400, detail=f"position must be one of: {', '.join(valid)}")

    doc = _open_stored_pdf(pdf_id)
    try:
        margin = 36
        fs = request.font_size
        for i, page in enumerate(doc):
            rect = page.rect
            label = str(request.start + i)
            tw = fitz.get_text_length(label, fontname="helv", fontsize=fs)
            vertical, horizontal = pos.split("-")

            y = rect.height - margin if vertical == "bottom" else margin + fs
            if horizontal == "left":
                x = margin
            elif horizontal == "right":
                x = rect.width - margin - tw
            else:
                x = (rect.width - tw) / 2

            page.insert_text(
                fitz.Point(x, y),
                label,
                fontsize=fs,
                fontname="helv",
                color=(0.35, 0.35, 0.35),
            )

        _persist_pdf(pdf_id, doc)
    finally:
        doc.close()

    return {"success": True}


class ProtectRequest(PydanticBaseModel):
    password: str


@router.post("/{pdf_id}/protect")
async def protect_pdf(pdf_id: str, request: ProtectRequest) -> dict:
    if not request.password:
        raise HTTPException(status_code=400, detail="Password cannot be empty")

    doc = _open_stored_pdf(pdf_id)
    try:
        data = _persist_pdf(
            pdf_id,
            doc,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            user_pw=request.password,
            owner_pw=request.password,
        )
    finally:
        doc.close()

    if pdf_id in PDF_METADATA:
        PDF_METADATA[pdf_id]["password"] = request.password
        PDF_METADATA[pdf_id]["enc_kwargs"] = {
            "encryption": fitz.PDF_ENCRYPT_AES_256,
            "user_pw": request.password,
            "owner_pw": request.password,
        }

    return {"success": True, "size": len(data)}


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
    target_filename = re.sub(r'[\\"/\r\n]', "_", target_filename).strip() or f"{pdf_id}.pdf"

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
