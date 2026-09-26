"""Annotation models and types for DocuCraft PDF Editor."""

from api.pdf.routes import (
    AnnotationType,
    Point,
    FreehandAnnotation,
    TextBoxAnnotation,
    HighlightAnnotation,
    StickyNoteAnnotation,
    StampAnnotation,
    AnnotationPayload,
)

__all__ = [
    "AnnotationType",
    "Point",
    "FreehandAnnotation",
    "TextBoxAnnotation",
    "HighlightAnnotation",
    "StickyNoteAnnotation",
    "StampAnnotation",
    "AnnotationPayload",
]
