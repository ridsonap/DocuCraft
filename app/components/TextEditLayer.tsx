"use client";

import { useState, useRef, useEffect } from "react";
import { TextBlock } from "@/types/pdf";
import { api } from "@/lib/api";
import { Check, X, Type, Minus, Plus, Move, Bold, Italic, Trash2 } from "lucide-react";

interface TextEditLayerProps {
  pdfId: string;
  pageNumber: number;
  scale: number;
  blocks: TextBlock[];
  onEditComplete?: () => void;
  isAddTextMode?: boolean;
  onAddTextModeChange?: (active: boolean) => void;
}

interface EditingState {
  isNew?: boolean;
  block?: TextBlock;
  x: number;
  y: number;
  width: number;
  height: number;
  // Baseline anchor offset (PDF points) so the editor aligns to the text baseline
  anchorDx: number;
  anchorDy: number;
  originalText: string;
  fontSize: number;
  fontName: string;
  fontFamily: "sans" | "serif" | "mono";
  isBold: boolean;
  isItalic: boolean;
  color: [number, number, number];
  isTransparentBg: boolean;
}

type DragType =
  | "move"
  | "resize-nw"
  | "resize-n"
  | "resize-ne"
  | "resize-e"
  | "resize-se"
  | "resize-s"
  | "resize-sw"
  | "resize-w"
  | null;

interface DragState {
  type: DragType;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startBoxX: number;
  startBoxY: number;
}

interface ToolbarPosition {
  x: number;
  y: number;
}

const PRESET_COLORS: { label: string; value: [number, number, number]; hex: string }[] = [
  { label: "Hitam", value: [0, 0, 0], hex: "#000000" },
  { label: "Abu Gelap", value: [75, 85, 99], hex: "#4b5563" },
  { label: "Biru", value: [37, 99, 235], hex: "#2563eb" },
  { label: "Merah", value: [220, 38, 38], hex: "#dc2626" },
  { label: "Hijau", value: [22, 163, 74], hex: "#16a34a" },
  { label: "Kuning", value: [245, 158, 11], hex: "#f59e0b" },
];

export default function TextEditLayer({
  pdfId,
  pageNumber,
  scale,
  blocks,
  onEditComplete,
  isAddTextMode = false,
  onAddTextModeChange,
}: TextEditLayerProps) {
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [textValue, setTextValue] = useState("");
  const [fontSize, setFontSize] = useState(12);
  const [fontFamily, setFontFamily] = useState<"sans" | "serif" | "mono">("sans");
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isTransparentBg, setIsTransparentBg] = useState(true);
  const [selectedColor, setSelectedColor] = useState<[number, number, number]>([0, 0, 0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dragState, setDragState] = useState<DragState>({
    type: null,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
    startBoxX: 0,
    startBoxY: 0,
  });
  const [toolbarPos, setToolbarPos] = useState<ToolbarPosition>({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragStateRef = useRef<DragState>(dragState);
  dragStateRef.current = dragState;

  // Focus and select input when editing starts
  useEffect(() => {
    if (editing && inputRef.current) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [editing?.x, editing?.y, editing?.isNew]);

  // Calculate toolbar position (centered above or below textbox, clamped to container)
  useEffect(() => {
    if (!editing || !containerRef.current) return;

    const toolbarWidth = 520;
    const toolbarHeight = 44;
    const boxLeft = editing.x * scale;
    const boxTop = editing.y * scale;
    const boxWidth = editing.width * scale;
    const boxHeight = editing.height * scale;

    const containerWidth = containerRef.current.clientWidth || 800;

    let x = boxLeft + boxWidth / 2 - toolbarWidth / 2;
    x = Math.max(8, Math.min(x, containerWidth - toolbarWidth - 8));

    let y = boxTop - toolbarHeight - 24;
    if (y < 8) {
      y = boxTop + boxHeight + 14;
    }

    setToolbarPos({ x, y });
  }, [editing?.x, editing?.y, editing?.width, editing?.height, scale]);

  // CSS Font family lookup
  const getCssFontFamily = (family: "sans" | "serif" | "mono") => {
    switch (family) {
      case "serif":
        return '"Times New Roman", Times, Georgia, "Liberation Serif", serif';
      case "mono":
        return '"Courier New", Courier, "Liberation Mono", monospace';
      case "sans":
      default:
        return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    }
  };

  // Handle click on existing text block
  const handleBlockClick = (block: TextBlock, e: React.MouseEvent) => {
    e.stopPropagation();

    // Auto-detect font family, bold, and italic from block
    let detectedFamily: "sans" | "serif" | "mono" = block.font_family || "sans";
    if (!block.font_family) {
      const fn = (block.font_name || "").toLowerCase();
      if (fn.includes("courier") || fn.includes("mono") || fn.includes("consolas")) {
        detectedFamily = "mono";
      } else if (fn.includes("times") || fn.includes("serif") || fn.includes("georgia") || fn.includes("cambria")) {
        detectedFamily = "serif";
      }
    }

    const fnLower = (block.font_name || "").toLowerCase();
    const detectedBold =
      block.is_bold ?? (fnLower.includes("bold") || fnLower.includes("black") || fnLower.includes("heavy"));
    const detectedItalic =
      block.is_italic ?? (fnLower.includes("italic") || fnLower.includes("oblique") || fnLower.includes("slant"));

    const initialWidth = Math.max(block.width, 50);
    const initialHeight = Math.max(block.height, 22);

    // Anchor the editor to the text baseline: position the editor box so that
    // the CSS baseline of the textarea lands exactly on origin_y.
    const rawSize = block.font_size || 12;
    const fontSize1dp = Math.round(rawSize * 10) / 10;
    const ascent = rawSize * 0.8;
    const anchorDx = (block.origin_x ?? block.x) - block.x;
    const anchorDy = (block.origin_y ?? block.y) - block.y - ascent;

    setEditing({
      isNew: false,
      block,
      x: block.x,
      y: block.y,
      width: initialWidth,
      height: initialHeight,
      anchorDx,
      anchorDy,
      originalText: block.text,
      fontSize: fontSize1dp,
      fontName: block.font_name || "helv",
      fontFamily: detectedFamily,
      isBold: detectedBold,
      isItalic: detectedItalic,
      color: block.color || [0, 0, 0],
      isTransparentBg: true,
    });

    setTextValue(block.text);
    setFontSize(fontSize1dp);
    setFontFamily(detectedFamily);
    setIsBold(detectedBold);
    setIsItalic(detectedItalic);
    setIsTransparentBg(true);
    setSelectedColor(block.color || [0, 0, 0]);
    setError(null);
    onAddTextModeChange?.(false);
  };

  // Handle click anywhere on the page
  const handleLayerClick = (e: React.MouseEvent) => {
    // If currently editing, clicking outside exits edit mode
    if (editing) {
      handleCancel();
      return;
    }

    // Only allow creating a new text box when Add Text mode is active
    if (!isAddTextMode || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / scale;
    const clickY = (e.clientY - rect.top) / scale;

    setEditing({
      isNew: true,
      x: Math.round(clickX),
      y: Math.round(clickY),
      width: 180,
      height: 40,
      anchorDx: 0,
      anchorDy: 0,
      originalText: "",
      fontSize: 14,
      fontName: "helv",
      fontFamily: "sans",
      isBold: false,
      isItalic: false,
      color: [0, 0, 0],
      isTransparentBg: true,
    });

    setTextValue("");
    setFontSize(14);
    setFontFamily("sans");
    setIsBold(false);
    setIsItalic(false);
    setIsTransparentBg(true);
    setSelectedColor([0, 0, 0]);
    setError(null);
    onAddTextModeChange?.(false);
  };

  const startDrag = (clientX: number, clientY: number, type: DragType) => {
    if (!editing) return;
    setDragState({
      type,
      startX: clientX,
      startY: clientY,
      startWidth: editing.width,
      startHeight: editing.height,
      startBoxX: editing.x,
      startBoxY: editing.y,
    });
  };

  // Mouse down on textbox handle - start drag or resize
  const handleMouseDown = (e: React.MouseEvent, type: DragType) => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    startDrag(e.clientX, e.clientY, type);
  };

  // Touch start on textbox handle - start drag or resize on mobile/tablets
  const handleTouchStart = (e: React.TouchEvent, type: DragType) => {
    if (!editing || e.touches.length === 0) return;
    e.stopPropagation();
    startDrag(e.touches[0].clientX, e.touches[0].clientY, type);
  };

  // Mouse and Touch move/up listeners for dragging & 8-point resizing
  useEffect(() => {
    if (!dragState.type) return;

    document.body.style.userSelect = "none";

    const handlePointerMove = (clientX: number, clientY: number) => {
      const current = dragStateRef.current;
      if (!current.type) return;

      const deltaX = (clientX - current.startX) / scale;
      const deltaY = (clientY - current.startY) / scale;

      if (current.type === "move") {
        setEditing((prev) =>
          prev
            ? {
                ...prev,
                x: Math.max(0, Math.round(current.startBoxX + deltaX)),
                y: Math.max(0, Math.round(current.startBoxY + deltaY)),
              }
            : null
        );
      } else {
        let newWidth = current.startWidth;
        let newHeight = current.startHeight;
        let newX = current.startBoxX;
        let newY = current.startBoxY;

        const MIN_W = 30;
        const MIN_H = 16;

        switch (current.type) {
          // Edges
          case "resize-e":
            newWidth = Math.max(MIN_W, Math.round(current.startWidth + deltaX));
            break;
          case "resize-w":
            newWidth = Math.max(MIN_W, Math.round(current.startWidth - deltaX));
            newX = Math.max(0, Math.round(current.startBoxX + current.startWidth - newWidth));
            break;
          case "resize-s":
            newHeight = Math.max(MIN_H, Math.round(current.startHeight + deltaY));
            break;
          case "resize-n":
            newHeight = Math.max(MIN_H, Math.round(current.startHeight - deltaY));
            newY = Math.max(0, Math.round(current.startBoxY + current.startHeight - newHeight));
            break;

          // Corners
          case "resize-se":
            newWidth = Math.max(MIN_W, Math.round(current.startWidth + deltaX));
            newHeight = Math.max(MIN_H, Math.round(current.startHeight + deltaY));
            break;
          case "resize-sw":
            newWidth = Math.max(MIN_W, Math.round(current.startWidth - deltaX));
            newHeight = Math.max(MIN_H, Math.round(current.startHeight + deltaY));
            newX = Math.max(0, Math.round(current.startBoxX + current.startWidth - newWidth));
            break;
          case "resize-ne":
            newWidth = Math.max(MIN_W, Math.round(current.startWidth + deltaX));
            newHeight = Math.max(MIN_H, Math.round(current.startHeight - deltaY));
            newY = Math.max(0, Math.round(current.startBoxY + current.startHeight - newHeight));
            break;
          case "resize-nw":
            newWidth = Math.max(MIN_W, Math.round(current.startWidth - deltaX));
            newHeight = Math.max(MIN_H, Math.round(current.startHeight - deltaY));
            newX = Math.max(0, Math.round(current.startBoxX + current.startWidth - newWidth));
            newY = Math.max(0, Math.round(current.startBoxY + current.startHeight - newHeight));
            break;
        }

        setEditing((prev) =>
          prev
            ? {
                ...prev,
                x: newX,
                y: newY,
                width: newWidth,
                height: newHeight,
              }
            : null
        );
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      handlePointerMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handlePointerUp = () => {
      document.body.style.userSelect = "";
      setDragState({
        type: null,
        startX: 0,
        startY: 0,
        startWidth: 0,
        startHeight: 0,
        startBoxX: 0,
        startBoxY: 0,
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handlePointerUp);
    window.addEventListener("touchcancel", handlePointerUp);

    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handlePointerUp);
      window.removeEventListener("touchcancel", handlePointerUp);
    };
  }, [dragState.type, scale]);

  const handleSave = async () => {
    if (!editing || !textValue.trim()) return;

    setSaving(true);
    setError(null);

    try {
      if (editing.isNew) {
        await api.addText(pdfId, {
          page: pageNumber - 1,
          x: editing.x,
          y: editing.y + fontSize,
          text: textValue,
          font_size: fontSize,
          font_name: editing.fontName,
          font_family: fontFamily,
          is_bold: isBold,
          is_italic: isItalic,
          color: selectedColor,
          bg_color: isTransparentBg ? null : [255, 255, 255],
        });
      } else {
        await api.editText(pdfId, {
          page: pageNumber - 1,
          x: editing.x,
          y: editing.y,
          width: editing.width,
          height: editing.height,
          old_text: editing.originalText,
          new_text: textValue,
          font_size: fontSize,
          font_name: editing.fontName,
          font_family: fontFamily,
          is_bold: isBold,
          is_italic: isItalic,
          color: selectedColor,
          bg_color: isTransparentBg ? null : [255, 255, 255],
          orig_x: editing.block?.x,
          orig_y: editing.block?.y,
          orig_width: editing.block?.width,
          orig_height: editing.block?.height,
          origin_x: editing.block?.origin_x,
          origin_y: editing.block?.origin_y,
        });
      }

      setEditing(null);
      onEditComplete?.();
    } catch (err: any) {
      console.error("Text edit failed:", err);
      setError(err?.message || "Gagal menyimpan edit text");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setError(null);
  };

  const handleDelete = async () => {
    if (!editing || editing.isNew) return;

    setSaving(true);
    setError(null);

    try {
      await api.deleteText(pdfId, {
        page: pageNumber - 1,
        x: editing.block?.x ?? editing.x,
        y: editing.block?.y ?? editing.y,
        width: editing.block?.width ?? editing.width,
        height: editing.block?.height ?? editing.height,
        old_text: editing.originalText,
      });

      setEditing(null);
      onEditComplete?.();
    } catch (err: any) {
      console.error("Text delete failed:", err);
      setError(err?.message || "Gagal menghapus text");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  const getColorStyle = (color: [number, number, number]) => {
    return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  };

  return (
    <div
      ref={containerRef}
      onClick={handleLayerClick}
      className={`absolute inset-0 ${isAddTextMode ? "cursor-crosshair" : "cursor-default"}`}
    >
      {/* Existing Text Blocks - subtle outlines with hover highlight & badge */}
      {!editing &&
        blocks.map((block, i) => (
          <div
            key={`${block.page}-${i}-${block.x}-${block.y}`}
            className="group absolute cursor-pointer pointer-events-auto border border-dashed border-blue-300/60 hover:border-blue-500 hover:bg-blue-500/15 rounded-xs transition-colors z-10"
            style={{
              left: `${block.x * scale}px`,
              top: `${block.y * scale}px`,
              width: `${Math.max(block.width * scale, 16)}px`,
              height: `${Math.max(block.height * scale, 12)}px`,
            }}
            onClick={(e) => handleBlockClick(block, e)}
            title={`Klik untuk edit: "${block.text}" (${block.font_name})`}
          >
            {/* Small edit badge on hover */}
            <div className="absolute -top-5 left-0 items-center gap-1 hidden group-hover:flex pointer-events-none z-20">
              <span className="text-[10px] font-medium text-blue-600 bg-white/95 border border-blue-200 shadow-sm px-1.5 py-0.5 rounded flex items-center gap-1 whitespace-nowrap">
                <Type size={10} />
                Edit ({block.font_family || "sans"})
              </span>
            </div>
          </div>
        ))}

      {/* In-place Editable Textbox & Floating Toolbar */}
      {editing && (
        <>
          {/* Floating Toolbar */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute z-50 bg-white rounded-lg shadow-xl border border-gray-200 px-3 py-1.5 flex items-center gap-2 select-none max-w-[95vw] overflow-x-auto"
            style={{
              left: `${toolbarPos.x}px`,
              top: `${toolbarPos.y}px`,
            }}
          >
            {/* Font Family Selector */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-gray-500 font-medium">Font:</span>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as "sans" | "serif" | "mono")}
                className="text-xs border border-gray-300 rounded px-1.5 py-0.5 font-medium bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                title="Pilih jenis font"
              >
                <option value="sans">Sans-Serif (Helvetica/Arial)</option>
                <option value="serif">Serif (Times New Roman)</option>
                <option value="mono">Monospace (Courier)</option>
              </select>
            </div>

            {/* Bold & Italic Style Toggles */}
            <div className="flex items-center gap-0.5 pl-1.5 border-l border-gray-200">
              <button
                type="button"
                onClick={() => setIsBold(!isBold)}
                className={`p-1 rounded text-xs font-bold transition-colors ${
                  isBold ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
                title="Tebal (Bold)"
              >
                <Bold size={13} />
              </button>
              <button
                type="button"
                onClick={() => setIsItalic(!isItalic)}
                className={`p-1 rounded text-xs italic transition-colors ${
                  isItalic ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
                title="Miring (Italic)"
              >
                <Italic size={13} />
              </button>
            </div>

            {/* Font Size Controls */}
            <div className="flex items-center gap-1 pl-1.5 border-l border-gray-200">
              <span className="text-[11px] text-gray-500 font-medium">Ukuran:</span>
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.max(6, s - 1))}
                className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30"
                disabled={fontSize <= 6}
                title="Kecilkan font"
              >
                <Minus size={12} />
              </button>
              <span className="text-xs font-semibold text-gray-800 w-5 text-center tabular-nums">
                {fontSize}
              </span>
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.min(96, s + 1))}
                className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30"
                disabled={fontSize >= 96}
                title="Besarkan font"
              >
                <Plus size={12} />
              </button>
            </div>

            {/* Background Style Toggle (Transparent vs White) */}
            <div className="flex items-center gap-1 pl-1.5 border-l border-gray-200">
              <span className="text-[11px] text-gray-500 font-medium">Latar:</span>
              <button
                type="button"
                onClick={() => setIsTransparentBg(!isTransparentBg)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                  isTransparentBg
                    ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                    : "bg-gray-50 text-gray-700 border-gray-300"
                }`}
                title={isTransparentBg ? "Latar belakang transparan" : "Latar belakang putih padat"}
              >
                {isTransparentBg ? "Transparan" : "Putih"}
              </button>
            </div>

            {/* Color Swatches */}
            <div className="flex items-center gap-1 pl-1.5 border-l border-gray-200">
              {PRESET_COLORS.map((c) => {
                const isSelected =
                  selectedColor[0] === c.value[0] &&
                  selectedColor[1] === c.value[1] &&
                  selectedColor[2] === c.value[2];
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => setSelectedColor(c.value)}
                    className={`w-4 h-4 rounded-full border transition-all ${
                      isSelected
                        ? "ring-2 ring-blue-500 ring-offset-1 scale-110 border-transparent"
                        : "border-gray-300 hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.hex }}
                    title={c.label}
                  />
                );
              })}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1 pl-1.5 border-l border-gray-200">
              {/* Delete Button - only for existing text blocks */}
              {!editing.isNew && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  title="Hapus teks ini"
                >
                  <Trash2 size={15} />
                </button>
              )}
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                title="Batal (Esc)"
              >
                <X size={15} />
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !textValue.trim()}
                className="px-2 py-1 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 shadow-xs transition-colors"
                title="Simpan (Ctrl+Enter)"
              >
                {saving ? (
                  <>
                    <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Check size={12} />
                    <span>Simpan</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* The Editable Resizable Textbox */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute z-40 select-none"
            style={{
              left: `${(editing.x + (editing.anchorDx || 0)) * scale}px`,
              top: `${(editing.y + (editing.anchorDy || 0)) * scale}px`,
              width: `${editing.width * scale}px`,
              height: `${editing.height * scale}px`,
            }}
          >
            {/* Opaque cover: hides original glyphs behind the editor while typing.
                Only for existing blocks; save semantics (transparent/white bg) unchanged. */}
            {!editing.isNew && <div className="absolute inset-0 bg-white" aria-hidden />}

            {/* Move Handle - Top Center */}
            <div
              className="absolute -top-6 left-1/2 -translate-x-1/2 cursor-grab active:cursor-grabbing bg-blue-600 text-white px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 hover:bg-blue-700 shadow-md z-50 whitespace-nowrap touch-none"
              onMouseDown={(e) => handleMouseDown(e, "move")}
              onTouchStart={(e) => handleTouchStart(e, "move")}
              title="Tahan & geser untuk memindahkan posisi teks"
            >
              <Move size={11} />
              <span>Pindah</span>
            </div>

            {/* Textarea container with transparent background */}
            <div
              className={`w-full h-full border-2 border-blue-500 rounded-xs transition-colors ${
                isTransparentBg ? "bg-transparent" : "bg-white shadow-sm"
              }`}
            >
              <textarea
                ref={inputRef}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                placeholder="Ketik teks di sini..."
                className="w-full h-full bg-transparent resize-none outline-none"
                style={{
                  fontSize: `${fontSize * scale}px`,
                  fontFamily: getCssFontFamily(fontFamily),
                  fontWeight: isBold ? 700 : 400,
                  fontStyle: isItalic ? "italic" : "normal",
                  color: getColorStyle(selectedColor),
                  padding: 0,
                  lineHeight: 1,
                }}
              />
            </div>

            {/* 8-Point Resize Handles (Touch & Mouse enabled) */}
            {/* Corners */}
            <div
              className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-blue-600 border-2 border-white rounded-xs cursor-nw-resize hover:scale-125 transition-transform shadow-xs z-50 touch-none"
              onMouseDown={(e) => handleMouseDown(e, "resize-nw")}
              onTouchStart={(e) => handleTouchStart(e, "resize-nw")}
              title="Ubah ukuran sudut kiri atas"
            />
            <div
              className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-600 border-2 border-white rounded-xs cursor-ne-resize hover:scale-125 transition-transform shadow-xs z-50 touch-none"
              onMouseDown={(e) => handleMouseDown(e, "resize-ne")}
              onTouchStart={(e) => handleTouchStart(e, "resize-ne")}
              title="Ubah ukuran sudut kanan atas"
            />
            <div
              className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-blue-600 border-2 border-white rounded-xs cursor-sw-resize hover:scale-125 transition-transform shadow-xs z-50 touch-none"
              onMouseDown={(e) => handleMouseDown(e, "resize-sw")}
              onTouchStart={(e) => handleTouchStart(e, "resize-sw")}
              title="Ubah ukuran sudut kiri bawah"
            />
            <div
              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-600 border-2 border-white rounded-xs cursor-se-resize hover:scale-125 transition-transform shadow-xs z-50 touch-none"
              onMouseDown={(e) => handleMouseDown(e, "resize-se")}
              onTouchStart={(e) => handleTouchStart(e, "resize-se")}
              title="Ubah ukuran sudut kanan bawah"
            />

            {/* Edges */}
            <div
              className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-2.5 bg-blue-600 border border-white rounded-xs cursor-n-resize hover:scale-125 transition-transform shadow-xs z-50 touch-none"
              onMouseDown={(e) => handleMouseDown(e, "resize-n")}
              onTouchStart={(e) => handleTouchStart(e, "resize-n")}
              title="Ubah tinggi atas"
            />
            <div
              className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-2.5 bg-blue-600 border border-white rounded-xs cursor-s-resize hover:scale-125 transition-transform shadow-xs z-50 touch-none"
              onMouseDown={(e) => handleMouseDown(e, "resize-s")}
              onTouchStart={(e) => handleTouchStart(e, "resize-s")}
              title="Ubah tinggi bawah"
            />
            <div
              className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-2.5 h-4 bg-blue-600 border border-white rounded-xs cursor-w-resize hover:scale-125 transition-transform shadow-xs z-50 touch-none"
              onMouseDown={(e) => handleMouseDown(e, "resize-w")}
              onTouchStart={(e) => handleTouchStart(e, "resize-w")}
              title="Ubah lebar kiri"
            />
            <div
              className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-2.5 h-4 bg-blue-600 border border-white rounded-xs cursor-e-resize hover:scale-125 transition-transform shadow-xs z-50 touch-none"
              onMouseDown={(e) => handleMouseDown(e, "resize-e")}
              onTouchStart={(e) => handleTouchStart(e, "resize-e")}
              title="Ubah lebar kanan"
            />

            {/* Size & Font Indicator */}
            <div className="absolute -bottom-5 left-0 text-[9px] text-gray-500 bg-white/90 border border-gray-200 px-1 rounded shadow-xs select-none pointer-events-none whitespace-nowrap flex items-center gap-1">
              <span>{Math.round(editing.width)} × {Math.round(editing.height)} pt</span>
              <span>•</span>
              <span className="capitalize">{fontFamily}</span>
              {isBold && <span>• B</span>}
              {isItalic && <span>• I</span>}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute z-50 bottom-4 left-1/2 -translate-x-1/2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 shadow-lg flex items-center gap-2"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Add Text Mode Hint */}
      {isAddTextMode && !editing && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg pointer-events-none select-none">
          Klik di mana saja pada halaman untuk menambahkan teks
        </div>
      )}
    </div>
  );
}
