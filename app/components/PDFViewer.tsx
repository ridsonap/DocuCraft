"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
} from "lucide-react";

// Configure PDF.js worker using self-contained local worker
if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

interface PDFViewerProps {
  pdfData: ArrayBuffer | null;
  currentPage: number;
  scale: number;
  onPageChange: (page: number, total: number) => void;
  onScaleChange: (scale: number) => void;
  onDimensionsChange?: (dims: { width: number; height: number }) => void;
  children?: React.ReactNode;
}

export default function PDFViewer({
  pdfData,
  currentPage,
  scale,
  onPageChange,
  onScaleChange,
  onDimensionsChange,
  children,
}: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [inputPage, setInputPage] = useState(String(currentPage));

  // Sync inputPage when currentPage changes
  useEffect(() => {
    setInputPage(String(currentPage));
  }, [currentPage]);

  // Load PDF Document
  useEffect(() => {
    if (!pdfData) {
      setPdfDoc(null);
      setTotalPages(0);
      return;
    }

    let isCancelled = false;

    const loadPDF = async () => {
      setLoading(true);
      try {
        const loadingTask = pdfjsLib.getDocument({
          data: pdfData.slice(0), // Clone buffer to prevent detached ArrayBuffer errors
          cMapUrl: "https://unpkg.com/pdfjs-dist@4.0.379/cmaps/",
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (!isCancelled) {
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
          onPageChange(1, doc.numPages);
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error("Failed to load PDF in PDFViewer:", err);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    loadPDF();

    return () => {
      isCancelled = true;
    };
  }, [pdfData]);

  // Render current page to canvas
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || currentPage < 1) return;

    try {
      // Cancel previous render task if still in progress
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
        renderTaskRef.current = null;
      }

      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      onDimensionsChange?.({
        width: Math.floor(viewport.width),
        height: Math.floor(viewport.height),
      });

      const renderContext = {
        canvasContext: context,
        viewport,
      };

      const task = page.render(renderContext);
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.error("PDF page render error:", err);
      }
    }
  }, [pdfDoc, currentPage, scale, onDimensionsChange]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // Navigation handlers
  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(inputPage, 10);
    if (!isNaN(p) && p >= 1 && p <= totalPages) {
      onPageChange(p, totalPages);
    } else {
      setInputPage(String(currentPage));
    }
  };

  const goToPage = (p: number) => {
    if (p >= 1 && p <= totalPages) {
      onPageChange(p, totalPages);
    }
  };

  const handleZoom = (delta: number) => {
    const newScale = Math.min(Math.max(0.5, scale + delta), 3.0);
    onScaleChange(Math.round(newScale * 10) / 10);
  };

  if (!pdfData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No PDF document loaded
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-100 select-none">
      {/* Top PDF Controls Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b shadow-sm gap-2 z-10">
        {/* Pagination controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => goToPage(1)}
            disabled={currentPage <= 1 || loading}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
            title="First Page"
          >
            <ChevronsLeft size={18} />
          </button>
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1 || loading}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
            title="Previous Page"
          >
            <ChevronLeft size={18} />
          </button>

          <form onSubmit={handlePageSubmit} className="flex items-center gap-1.5 mx-1">
            <span className="text-xs text-gray-500 font-medium">Page</span>
            <input
              type="text"
              value={inputPage}
              onChange={(e) => setInputPage(e.target.value)}
              onBlur={() => setInputPage(String(currentPage))}
              className="w-12 text-center text-sm border rounded px-1 py-0.5 font-medium focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            <span className="text-xs text-gray-500 font-medium">of {totalPages}</span>
          </form>

          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages || loading}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
            title="Next Page"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => goToPage(totalPages)}
            disabled={currentPage >= totalPages || loading}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
            title="Last Page"
          >
            <ChevronsRight size={18} />
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleZoom(-0.25)}
            disabled={scale <= 0.5 || loading}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
            title="Zoom Out"
          >
            <ZoomOut size={18} />
          </button>

          <select
            value={scale}
            onChange={(e) => onScaleChange(parseFloat(e.target.value))}
            className="text-xs font-medium border rounded px-2 py-1 bg-white text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
            <option value="1.75">175%</option>
            <option value="2">200%</option>
          </select>

          <button
            onClick={() => handleZoom(0.25)}
            disabled={scale >= 3.0 || loading}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
            title="Zoom In"
          >
            <ZoomIn size={18} />
          </button>
        </div>
      </div>

      {/* Main Canvas Scroll Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-6 flex items-start justify-center"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500">
            <div className="animate-spin h-8 w-8 border-3 border-blue-600 border-t-transparent rounded-full mb-3" />
            <span className="text-sm font-medium">Rendering PDF...</span>
          </div>
        ) : (
          <div className="relative inline-block shadow-xl bg-white border border-gray-200 rounded-sm">
            {/* The PDF Page Canvas */}
            <canvas ref={canvasRef} className="block" />

            {/* Overlays (TextEditLayer, AnnotationLayer) render right on top of this exact canvas */}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
