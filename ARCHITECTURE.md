# DocuCraft - PDF Editor

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Next.js)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  PDFViewer          TextEditLayer        PageOrganizer      Annotations      │
│  (PDF.js Canvas)   (Click→Edit→Save)    (Thumbnails)       (Drawing)        │
└──────────┬────────────────┬────────────────┬─────────────────┬────────────────┘
           │                │                │                 │
           │  POST /edit    │  POST /ocr     │  POST /organize │  (future)
           │  POST /ocr     │  GET  /pages   │  POST /merge    │
           │  GET  /pages   │  POST /split   │  POST /export   │
           ▼                ▼                ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (FastAPI)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                              API Routes                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ /api/pdf/  │  │ /api/pdf/  │  │ /api/pdf/  │  │ /api/pdf/  │          │
│  │ extract-   │  │ edit-text  │  │ ocr        │  │ organize   │          │
│  │ text       │  │            │  │            │  │            │          │
│  └─────┬───────┘  └─────┬───────┘  └─────┬───────┘  └─────┬───────┘          │
│        │                │                │                │                 │
│        └────────────────┴────────┬───────┴────────────────┘                 │
│                                  ▼                                          │
│                    ┌─────────────────────────┐                             │
│                    │      PyMuPDF (fitz)      │                             │
│                    │  • Text extraction       │                             │
│                    │  • Text editing          │                             │
│                    │  • OCR (Tesseract)      │                             │
│                    │  • Page operations       │                             │
│                    │  • Redaction/Masking    │                             │
│                    └─────────────────────────┘                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow: In-Place Text Editing

```
1. Upload PDF → FastAPI stores temp file, returns page count + first page
2. GET /extract-text → Returns text blocks with coordinates (x, y, w, h, font, color)
3. Client renders PDF.js canvas + clickable TextEditLayer overlay
4. User clicks text → Client sends: {page, x, y, w, h, old_text, new_text}
5. POST /edit-text → Backend:
   a. Opens PDF with PyMuPDF
   b. Gets page dimensions + original font properties
   c. Draws redaction rectangle (white rect) at exact coordinates
   d. Inserts new text at same position with matching font
   e. Saves PDF, returns success
6. Client re-renders updated page
```

## Data Flow: OCR

```
1. GET /ocr-detect → Returns pages that appear to be scanned (low text coverage)
2. POST /ocr → Backend:
   a. Renders page to image (300 DPI)
   b. Runs Tesseract OCR
   c. Gets text + bounding boxes
   d. Creates searchable PDF overlay OR returns extracted text
3. Client receives searchable text layer
```

## Dependencies

### System (macOS)
```bash
brew install tesseract tesseract-lang  # OCR
brew install poppler                   # PDF utilities
```

### Python
```bash
pip install fastapi uvicorn pymupdf pytesseract python-multipart aiofiles
```

### Node.js
```bash
npm install pdfjs-dist pdf-lib
```
