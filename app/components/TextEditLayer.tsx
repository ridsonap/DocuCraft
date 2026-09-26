"use client";

import { useState, useRef, useEffect } from "react";
import { TextBlock } from "@/types/pdf";
import { api } from "@/lib/api";
import { Check, X, Plus, Type, Palette } from "lucide-react";

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
  originalText: string;
  fontSize: number;
  fontName: string;
  color: [number, number, number];
}

const PRESET_COLORS: { label: string; value: [number, number, number]; hex: string }[] = [
  { label: "Black", value: [0, 0, 0], hex: "#000000" },
  { label: "Dark Gray", value: [75, 85, 99], hex: "#4b5563" },
  { label: "Blue", value: [37, 99, 235], hex: "#2563eb" },
  { label: "Red", value: [220, 38, 38], hex: "#dc2626" },
  { label: "Green", value: [22, 163, 74], hex: "#16a34a" },
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
  const [selectedColor, setSelectedColor] = useState<[number, number, number]>([0, 0, 0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus and select input on editing start
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Click on existing text block to edit
  const handleBlockClick = (block: TextBlock, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing({
      isNew: false,
      block,
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      originalText: block.text,
      fontSize: block.font_size || 12,
      fontName: block.font_name || "helv",
      color: block.color || [0, 0, 0],
    });
    setTextValue(block.text);
    setFontSize(block.font_size || 12);
    setSelectedColor(block.color || [0, 0, 0]);
    setError(null);
  };

  // Click on background in Add Text Mode
  const handleLayerClick = (e: React.MouseEvent) => {
    if (!isAddTextMode || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / scale;
    const clickY = (e.clientY - rect.top) / scale;

    setEditing({
      isNew: true,
      x: Math.round(clickX),
      y: Math.round(clickY),
      width: 150,
      height: 30,
      originalText: "",
      fontSize: 12,
      fontName: "helv",
      color: [0, 0, 0],
    });
    setTextValue("");
    setFontSize(12);
    setSelectedColor([0, 0, 0]);
    setError(null);
    onAddTextModeChange?.(false);
  };

  const handleSave = async () => {
    if (!editing || !textValue.trim()) return;

    setSaving(true);
    setError(null);

    try {
      if (editing.isNew) {
        // Add new text
        await api.addText(pdfId, {
          page: pageNumber - 1,
          x: editing.x,
          y: editing.y + fontSize, // Baseline adjustment
          text: textValue,
          font_size: fontSize,
          font_name: editing.fontName,
          color: selectedColor,
        });
      } else {
        // Edit existing text block
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
          color: selectedColor,
        });
      }

      setEditing(null);
      onEditComplete?.();
    } catch (err: any) {
      console.error("Text edit failed:", err);
      setError(err?.message || "Failed to save text edit");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={handleLayerClick}
      className={`absolute inset-0 ${
        isAddTextMode ? "cursor-crosshair pointer-events-auto" : "pointer-events-none"
      }`}
    >
      {/* Existing Text Blocks (Clickable overlays) */}
      {!editing &&
        blocks.map((block, i) => (
          <div
            key={`${block.page}-${i}-${block.x}-${block.y}`}
            className="absolute cursor-pointer pointer-events-auto border border-dashed border-transparent hover:border-blue-500 hover:bg-blue-500/15 rounded-xs transition-colors"
            style={{
              left: `${block.x * scale}px`,
              top: `${block.y * scale}px`,
              width: `${Math.max(block.width * scale, 10)}px`,
              height: `${Math.max(block.height * scale, 12)}px`,
            }}
            onClick={(e) => handleBlockClick(block, e)}
            title={`Click to edit: "${block.text}"`}
          />
        ))}

      {/* In-place or Floating Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4 pointer-events-auto">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
              <span className="font-semibold text-sm text-gray-800 flex items-center gap-1.5">
                <Type size={16} className="text-blue-600" />
                {editing.isNew ? "Add New Text" : "Edit Text in PDF"}
              </span>
              <button
                onClick={handleCancel}
                className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-200"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3">
              {!editing.isNew && editing.originalText && (
                <div>
                  <div className="text-xs font-medium text-gray-400 mb-1">Original Text:</div>
                  <div className="text-xs bg-gray-50 text-gray-700 p-2 rounded border font-mono truncate">
                    {editing.originalText}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  {editing.isNew ? "Enter Text:" : "Replacement Text:"}
                </label>
                <textarea
                  ref={inputRef}
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={3}
                  className="w-full border rounded-lg p-2.5 text-sm font-sans focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Type text here..."
                />
              </div>

              {/* Formatting bar */}
              <div className="flex items-center justify-between gap-3 pt-1">
                {/* Font Size */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium">Size:</span>
                  <select
                    value={fontSize}
                    onChange={(e) => setFontSize(parseFloat(e.target.value))}
                    className="border rounded px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    {[9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
                      <option key={s} value={s}>
                        {s} pt
                      </option>
                    ))}
                  </select>
                </div>

                {/* Color swatches */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium">Color:</span>
                  <div className="flex items-center gap-1">
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
                          className={`w-5 h-5 rounded-full border transition-all ${
                            isSelected ? "ring-2 ring-blue-500 ring-offset-1 scale-110" : ""
                          }`}
                          style={{ backgroundColor: c.hex }}
                          title={c.label}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              {error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 bg-gray-50 border-t">
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="px-3.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !textValue.trim()}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                {saving ? (
                  <>
                    <div className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    Apply Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
