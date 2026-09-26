"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Eraser, Undo, Check, X } from "lucide-react";

interface Point {
  x: number;
  y: number;
}

interface SignatureCanvasProps {
  onSave: (points: Point[], imageDataUrl?: string) => void;
  onCancel: () => void;
  width?: number;
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export default function SignatureCanvas({
  onSave,
  onCancel,
  width = 400,
  height = 200,
  strokeColor = "#000000",
  strokeWidth = 2,
}: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Draw existing points
  const redraw = useCallback((pts: Point[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (pts.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }, [strokeColor, strokeWidth, width, height]);

  // Redraw when points change
  useEffect(() => {
    redraw(points);
  }, [points, redraw]);

  const getPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const pos = getPos(e);
    setPoints([pos]);
    setHasDrawn(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();

    const pos = getPos(e);
    setPoints((prev) => [...prev, pos]);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    setPoints([]);
    setHasDrawn(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, width, height);
    }
  };

  const handleUndo = () => {
    // Remove last 10 points (approximate stroke)
    setPoints((prev) => {
      if (prev.length <= 10) {
        setHasDrawn(false);
        return [];
      }
      return prev.slice(0, -10);
    });
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;

    const imageDataUrl = canvas.toDataURL("image/png");
    onSave(points, imageDataUrl);
  };

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 bg-gray-100 rounded-t-lg border">
        <button
          onClick={handleUndo}
          disabled={points.length === 0}
          className="p-2 hover:bg-gray-200 rounded disabled:opacity-50"
          title="Undo"
        >
          <Undo size={18} />
        </button>
        <button
          onClick={handleClear}
          disabled={points.length === 0}
          className="p-2 hover:bg-gray-200 rounded disabled:opacity-50"
          title="Clear"
        >
          <Eraser size={18} />
        </button>
        <div className="flex-1" />
        <span className="text-sm text-gray-500">Sign here</span>
      </div>

      {/* Canvas */}
      <div className="relative border-x border-b rounded-b-lg overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full cursor-crosshair touch-none"
          style={{ maxWidth: "100%" }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />

        {/* Signature line */}
        <div className="absolute bottom-8 left-8 right-8 border-b border-gray-300 pointer-events-none" />
        <div className="absolute bottom-4 left-8 text-xs text-gray-400 pointer-events-none">
          X
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={onCancel}
          className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
        >
          <X size={16} />
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!hasDrawn}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Check size={16} />
          Apply Signature
        </button>
      </div>
    </div>
  );
}
