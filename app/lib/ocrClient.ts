// Client-side OCR powered by tesseract.js — runs entirely in the browser.
// Used automatically when the backend has no native Tesseract binary
// (e.g. Vercel serverless). Output shape matches POST /api/pdf/{id}/ocr:
// { pages: [{ page, blocks: [{text,x,y,width,height,confidence}], full_text, word_count }],
//   total_pages_processed } — coordinates in PDF points, like the backend.

import * as pdfjsLib from "pdfjs-dist";
import type { OCRBlock, OCRResult } from "@/types/pdf";

if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

// Same 2x render zoom the backend uses before feeding images to Tesseract.
const RENDER_SCALE = 2;

export interface OCRProgress {
  status: string;
  progress: number; // 0..1
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function performClientOCR(
  pdfBytes: ArrayBuffer,
  pages?: number[],
  onProgress?: (p: OCRProgress) => void
): Promise<{ pages: OCRResult[]; total_pages_processed: number }> {
  // Lazy-load: tesseract.js (~30MB WASM + language data) stays out of the main bundle.
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng+ind", undefined, {
    logger: (m: any) => {
      if (typeof m?.progress === "number") {
        onProgress?.({ status: String(m.status ?? ""), progress: m.progress });
      }
    },
  });

  try {
    // Copy the buffer: pdf.js may detach/transfer it, and the viewer may reuse the original.
    const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
    const targetPages = pages ?? Array.from({ length: doc.numPages }, (_, i) => i);
    const results: OCRResult[] = [];

    for (const pageNum of targetPages) {
      const page = await doc.getPage(pageNum + 1);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;

      const { data } = await worker.recognize(canvas);
      const blocks: OCRBlock[] = (data.words ?? [])
        .filter((w) => w.text && w.text.trim())
        .map((w) => ({
          text: w.text.trim(),
          x: round2(w.bbox.x0 / RENDER_SCALE),
          y: round2(w.bbox.y0 / RENDER_SCALE),
          width: round2((w.bbox.x1 - w.bbox.x0) / RENDER_SCALE),
          height: round2((w.bbox.y1 - w.bbox.y0) / RENDER_SCALE),
          confidence: Math.round(w.confidence),
        }));

      results.push({
        page: pageNum,
        blocks,
        full_text: blocks.map((b) => b.text).join(" "),
        word_count: blocks.length,
      });
      page.cleanup();
    }
    await doc.destroy();
    return { pages: results, total_pages_processed: results.length };
  } finally {
    await worker.terminate();
  }
}
