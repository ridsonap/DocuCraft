"use client";

import { useState, useRef, useCallback } from "react";
import { Trash2, Edit3, X, MessageSquare } from "lucide-react";
import {
  Annotation,
  AnnotationType,
  Point,
  TextBoxAnnotation,
  HighlightAnnotation,
  StickyNoteAnnotation,
  ImageAnnotation,
  FreehandAnnotation,
} from "@/types/annotation";
import { api } from "@/lib/api";

interface AnnotationLayerProps {
  pdfId: string;
  pageNumber: number;
  scale: number;
  activeTool: AnnotationType | null;
  activeColor: string;
  annotations: Annotation[];
  onAnnotationsChange: (annotations: Annotation[]) => void;
}

export default function AnnotationLayer({
  pdfId,
  pageNumber,
  scale,
  activeTool,
  activeColor,
  annotations,
  onAnnotationsChange,
}: AnnotationLayerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [pendingImagePos, setPendingImagePos] = useState<{ x: number; y: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Ref mirror so memoized handlers always see the latest annotations
  // (avoids the stale-closure bug where adding a 2nd annotation dropped the 1st)
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  // Filter annotations for current page (0-indexed in storage)
  const pageAnnotations = annotations.filter((a) => a.page === pageNumber - 1);

  // Convert hex color to RGB tuple [0-255]
  const hexToRgb = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
      : [0, 0, 0];
  };

  // Convert SVG coordinates to PDF points
  const getCoordinates = (e: React.MouseEvent): { x: number; y: number } | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const createAnnotation = useCallback(
    async (type: AnnotationType, x: number, y: number, customData?: any) => {
      const rgb = hexToRgb(activeColor);

      let payload: any = {
        type,
        page: pageNumber - 1,
      };

      switch (type) {
        case AnnotationType.FREEHAND:
          payload = {
            ...payload,
            points: customData || [],
            stroke_color: rgb,
            stroke_width: 2.5,
            opacity: 1.0,
          };
          break;
        case AnnotationType.TEXT_BOX:
          payload = {
            ...payload,
            x: Math.round(x),
            y: Math.round(y),
            width: 180,
            height: 70,
            text: "Double click to edit",
            font_size: 13,
            font_name: "helv",
            text_color: rgb,
            background_color: [255, 255, 255],
          };
          break;
        case AnnotationType.STICKY_NOTE:
          payload = {
            ...payload,
            x: Math.round(x),
            y: Math.round(y),
            text: "Note comment",
            icon: "note",
            color: "yellow",
          };
          break;
        case AnnotationType.HIGHLIGHT:
          payload = {
            ...payload,
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(customData?.width || 120),
            height: Math.round(customData?.height || 20),
            color: [250, 204, 21], // Yellow
          };
          break;
        case AnnotationType.IMAGE:
          payload = {
            ...payload,
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(customData?.width || 200),
            height: Math.round(customData?.height || 150),
            data_url: customData?.data_url || "",
          };
          break;
      }

      try {
        const result = await api.addAnnotation(pdfId, payload);
        const newAnnotation: Annotation = {
          ...result.annotation,
          id: result.id,
        } as Annotation;
        onAnnotationsChange([...annotationsRef.current, newAnnotation]);
      } catch (err) {
        console.error("Failed to add annotation:", err);
      }
    },
    [pdfId, pageNumber, activeColor, onAnnotationsChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!activeTool) return;
      // Ignore clicks on existing annotations (e.g. their delete/edit buttons):
      // mousedown fires before click, so without this guard clicking "delete"
      // would first spawn a brand-new annotation of the active tool.
      if ((e.target as Element).closest?.("[data-annot]")) return;
      const coords = getCoordinates(e);
      if (!coords) return;

      if (activeTool === AnnotationType.FREEHAND) {
        setIsDrawing(true);
        setDrawingPoints([coords]);
      } else if (activeTool === AnnotationType.HIGHLIGHT) {
        setDragStart(coords);
        setDragCurrent(coords);
      } else if (activeTool === AnnotationType.IMAGE) {
        setPendingImagePos(coords);
        imageInputRef.current?.click();
      } else if (
        activeTool === AnnotationType.TEXT_BOX ||
        activeTool === AnnotationType.STICKY_NOTE
      ) {
        // Immediate placement at click point
        createAnnotation(activeTool, coords.x, coords.y);
      }
    },
    [activeTool, scale, createAnnotation]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!activeTool) return;
      const coords = getCoordinates(e);
      if (!coords) return;

      if (isDrawing && activeTool === AnnotationType.FREEHAND) {
        setDrawingPoints((prev) => [...prev, coords]);
      } else if (dragStart && activeTool === AnnotationType.HIGHLIGHT) {
        setDragCurrent(coords);
      }
    },
    [isDrawing, dragStart, activeTool, scale]
  );

  const handleMouseUp = useCallback(() => {
    if (isDrawing && drawingPoints.length >= 2 && activeTool === AnnotationType.FREEHAND) {
      createAnnotation(AnnotationType.FREEHAND, 0, 0, drawingPoints);
    } else if (dragStart && dragCurrent && activeTool === AnnotationType.HIGHLIGHT) {
      const minX = Math.min(dragStart.x, dragCurrent.x);
      const minY = Math.min(dragStart.y, dragCurrent.y);
      const width = Math.abs(dragCurrent.x - dragStart.x);
      const height = Math.abs(dragCurrent.y - dragStart.y);

      if (width > 8 && height > 6) {
        createAnnotation(AnnotationType.HIGHLIGHT, minX, minY, { width, height });
      }
    }

    setIsDrawing(false);
    setDrawingPoints([]);
    setDragStart(null);
    setDragCurrent(null);
  }, [isDrawing, drawingPoints, dragStart, dragCurrent, activeTool, createAnnotation]);

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingImagePos) return;

    const pos = pendingImagePos;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      const place = (w: number, h: number) => {
        createAnnotation(AnnotationType.IMAGE, pos.x, pos.y, {
          width: w,
          height: h,
          data_url: dataUrl,
        });
        setPendingImagePos(null);
      };
      img.onload = () => {
        const aspect =
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? img.naturalWidth / img.naturalHeight
            : 4 / 3;
        const width = 200;
        place(width, Math.round(width / aspect));
      };
      img.onerror = () => place(200, 150);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await api.deleteAnnotation(pdfId, id);
      onAnnotationsChange(annotations.filter((a) => a.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (err) {
      console.error("Failed to delete annotation:", err);
    }
  };

  const handleStartEdit = (annot: Annotation, e: React.MouseEvent) => {
    e.stopPropagation();
    if ("text" in annot) {
      setEditingId(annot.id);
      setEditText((annot as any).text);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    try {
      await api.updateAnnotation(pdfId, editingId, { text: editText });
      onAnnotationsChange(
        annotations.map((a) => (a.id === editingId ? ({ ...a, text: editText } as any) : a))
      );
    } catch (err) {
      console.error("Failed to update annotation:", err);
    } finally {
      setEditingId(null);
      setEditText("");
    }
  };

  return (
    <>
    <svg
      ref={svgRef}
      className={`absolute inset-0 w-full h-full select-none ${
        activeTool ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"
      }`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Existing Annotations */}
      {pageAnnotations.map((annot) => {
        const isEditingThis = editingId === annot.id;

        if (annot.type === AnnotationType.FREEHAND) {
          const fh = annot as FreehandAnnotation;
          const stroke = fh.stroke_color ? `rgb(${fh.stroke_color.join(",")})` : "#000";
          const strokeLists =
            fh.strokes && fh.strokes.length > 0 ? fh.strokes : [fh.points || []];
          const firstPoint = strokeLists[0]?.[0];

          return (
            <g key={annot.id} className="group pointer-events-auto" data-annot="true">
              {strokeLists.map(
                (pts, i) =>
                  pts.length >= 2 && (
                    <path
                      key={i}
                      d={pts
                        .map((p, j) => `${j === 0 ? "M" : "L"} ${p.x * scale} ${p.y * scale}`)
                        .join(" ")}
                      stroke={stroke}
                      strokeWidth={(fh.stroke_width || 2) * scale}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                      opacity={fh.opacity || 1}
                      className="cursor-pointer"
                    />
                  )
              )}
              {/* Delete button at first point on hover */}
              {firstPoint && (
                <circle
                  cx={firstPoint.x * scale}
                  cy={firstPoint.y * scale}
                  r={14}
                  fill="#ef4444"
                  onClick={(e) => handleDelete(annot.id, e as any)}
                  className="opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                />
              )}
            </g>
          );
        }

        if (annot.type === AnnotationType.HIGHLIGHT) {
          const hl = annot as HighlightAnnotation;
          const fill = hl.color ? `rgba(${hl.color.join(",")}, 0.35)` : "rgba(250, 204, 21, 0.35)";

          return (
            <g key={annot.id} className="group pointer-events-auto" data-annot="true">
              <rect
                x={hl.x * scale}
                y={hl.y * scale}
                width={hl.width * scale}
                height={hl.height * scale}
                fill={fill}
                className="cursor-pointer hover:stroke-1 hover:stroke-yellow-600 transition-all"
                onClick={(e) => handleDelete(annot.id, e as any)}
              />
            </g>
          );
        }

        if (annot.type === AnnotationType.TEXT_BOX) {
          const tb = annot as TextBoxAnnotation;
          const textColor = tb.text_color ? `rgb(${tb.text_color.join(",")})` : "#000";

          return (
            <foreignObject
              key={annot.id}
              x={tb.x * scale}
              y={tb.y * scale}
              width={Math.max(tb.width * scale, 120)}
              height={Math.max(tb.height * scale, 50)}
              className="pointer-events-auto overflow-visible"
              data-annot="true"
            >
              <div
                onDoubleClick={(e) => handleStartEdit(annot, e)}
                className="relative group p-2 bg-white/95 border border-blue-400 rounded shadow-md h-full flex flex-col cursor-move"
              >
                {isEditingThis ? (
                  <div className="flex flex-col h-full gap-1">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full flex-1 text-xs border rounded p-1 resize-none outline-none focus:ring-1 focus:ring-blue-500 font-sans"
                      autoFocus
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={handleSaveEdit}
                        className="px-1.5 py-0.5 text-[10px] bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="text-xs font-sans whitespace-pre-wrap select-text flex-1 overflow-hidden"
                      style={{ color: textColor, fontSize: `${(tb.font_size || 12) * Math.min(scale, 1.2)}px` }}
                    >
                      {tb.text}
                    </div>
                    <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                      <button
                        onClick={(e) => handleStartEdit(annot, e)}
                        className="p-2 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                        title="Edit Text"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={(e) => handleDelete(annot.id, e)}
                        className="p-2 bg-red-50 text-red-600 rounded hover:bg-red-100"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </foreignObject>
          );
        }

        if (annot.type === AnnotationType.STICKY_NOTE) {
          const note = annot as StickyNoteAnnotation;
          return (
            <foreignObject
              key={annot.id}
              x={note.x * scale}
              y={note.y * scale}
              width={220}
              height={120}
              className="pointer-events-auto overflow-visible"
              data-annot="true"
            >
              <div className="group relative">
                <div
                  onClick={(e) => handleStartEdit(annot, e)}
                  className="w-7 h-7 bg-amber-400 hover:bg-amber-500 rounded-md shadow-md flex items-center justify-center cursor-pointer transition-transform hover:scale-110 border border-amber-600/30 text-white"
                  title="Click to view comment"
                >
                  <MessageSquare size={14} className="text-amber-900" />
                </div>

                {/* Popover note card */}
                <div className="mt-1 p-2 bg-amber-50 border border-amber-200 rounded-lg shadow-lg text-xs w-48 animate-in fade-in zoom-in-95">
                  {isEditingThis ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full text-xs bg-white border border-amber-300 rounded p-1.5 outline-none resize-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={handleSaveEdit}
                          className="px-2 py-0.5 text-[10px] bg-amber-600 text-white rounded hover:bg-amber-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2 py-0.5 text-[10px] bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-gray-800 break-words">{note.text || "Click to add comment..."}</span>
                      <button
                        onClick={(e) => handleDelete(annot.id, e)}
                        className="text-red-500 hover:text-red-700 p-2"
                        title="Delete note"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </foreignObject>
          );
        }

        if (annot.type === AnnotationType.IMAGE) {
          const im = annot as ImageAnnotation;

          return (
            <g key={annot.id} className="group pointer-events-auto" data-annot="true">
              <image
                href={im.data_url}
                x={im.x * scale}
                y={im.y * scale}
                width={im.width * scale}
                height={im.height * scale}
              />
              {/* Delete button at top-right corner on hover */}
              <circle
                cx={(im.x + im.width) * scale}
                cy={im.y * scale}
                r={14}
                fill="#ef4444"
                onClick={(e) => handleDelete(annot.id, e as any)}
                className="opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
              />
            </g>
          );
        }

        return null;
      })}

      {/* In-progress freehand stroke */}
      {isDrawing && drawingPoints.length >= 2 && (
        <path
          d={`M ${drawingPoints.map((p) => `${p.x * scale} ${p.y * scale}`).join(" L ")}`}
          stroke={activeColor}
          strokeWidth={2.5 * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}

      {/* In-progress highlight drag rect */}
      {dragStart && dragCurrent && (
        <rect
          x={Math.min(dragStart.x, dragCurrent.x) * scale}
          y={Math.min(dragStart.y, dragCurrent.y) * scale}
          width={Math.abs(dragCurrent.x - dragStart.x) * scale}
          height={Math.abs(dragCurrent.y - dragStart.y) * scale}
          fill="rgba(250, 204, 21, 0.4)"
          stroke="#ca8a04"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
    </svg>
    {/* Hidden file picker for the Image tool */}
    <input
      ref={imageInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleImageFile}
    />
    </>
  );
}
