"""Annotation models and types for DocuCraft PDF Editor."""

from api.pdf.routes import (
    AnnotationType,
    Point,
    FreehandAnnotation,
    TextBoxAnnotation,
    HighlightAnnotation,
    StickyNoteAnnotation,
    ImageAnnotation,
    AnnotationPayload,
)

__all__ = [
    "AnnotationType",
    "Point",
    "FreehandAnnotation",
    "TextBoxAnnotation",
    "HighlightAnnotation",
    "StickyNoteAnnotation",
    "ImageAnnotation",
    "AnnotationPayload",
]
