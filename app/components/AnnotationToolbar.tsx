"use client";

import {
  Pen,
  Type,
  Highlighter,
  StickyNote,
  Stamp,
  PenTool,
} from "lucide-react";
import { AnnotationType } from "@/types/annotation";

interface AnnotationToolbarProps {
  activeTool: AnnotationType | null;
  onSelectTool: (tool: AnnotationType | null) => void;
  onOpenSignature?: () => void;
  color?: string;
  onColorChange?: (color: string) => void;
  onClearAll?: () => void;
}

const COLORS = [
  { value: "#000000", label: "Black" },
  { value: "#ef4444", label: "Red" },
  { value: "#22c55e", label: "Green" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#eab308", label: "Yellow" },
  { value: "#a855f7", label: "Purple" },
];

const STAMPS = [
  { text: "APPROVED", color: "#16a34a" },
  { text: "DRAFT", color: "#ea580c" },
  { text: "CONFIDENTIAL", color: "#dc2626" },
  { text: "REVIEWED", color: "#2563eb" },
  { text: "VOID", color: "#64748b" },
];

export default function AnnotationToolbar({
  activeTool,
  onSelectTool,
  onOpenSignature,
  color = "#000000",
  onColorChange,
  onClearAll,
}: AnnotationToolbarProps) {
  const tools = [
    { type: AnnotationType.FREEHAND, icon: Pen, label: "Draw / Pen" },
    { type: AnnotationType.TEXT_BOX, icon: Type, label: "Text Box" },
    { type: AnnotationType.HIGHLIGHT, icon: Highlighter, label: "Highlight Area" },
    { type: AnnotationType.STICKY_NOTE, icon: StickyNote, label: "Sticky Note" },
    { type: AnnotationType.STAMP, icon: Stamp, label: "Stamp" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white border-b shadow-xs">
      {/* Tool Selection */}
      <div className="flex items-center gap-1 pr-3 border-r">
        {tools.map(({ type, icon: Icon, label }) => {
          const isActive = activeTool === type;
          return (
            <button
              key={type}
              onClick={() => onSelectTool(isActive ? null : type)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              title={label}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}

        {/* Signature Button */}
        {onOpenSignature && (
          <button
            onClick={onOpenSignature}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            title="Create Digital Signature"
          >
            <PenTool size={15} className="text-purple-600" />
            <span className="hidden sm:inline">Signature</span>
          </button>
        )}
      </div>

      {/* Color Swatches */}
      {activeTool && activeTool !== AnnotationType.HIGHLIGHT && (
        <div className="flex items-center gap-1.5 px-2 border-r">
          <span className="text-xs text-gray-500 font-medium">Color:</span>
          {COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => onColorChange?.(c.value)}
              className={`w-5 h-5 rounded-full border transition-all ${
                color === c.value ? "scale-115 ring-2 ring-blue-500 ring-offset-1" : "hover:scale-105"
              }`}
              style={{ backgroundColor: c.value }}
              title={c.label}
            />
          ))}
        </div>
      )}

      {/* Stamp Presets */}
      {activeTool === AnnotationType.STAMP && (
        <div className="flex items-center gap-1 px-2 border-r">
          <span className="text-xs text-gray-500 font-medium">Preset:</span>
          {STAMPS.map((stamp) => (
            <button
              key={stamp.text}
              onClick={() => onColorChange?.(stamp.color)}
              className="px-2 py-0.5 text-[11px] font-bold rounded border transition-colors hover:bg-gray-50"
              style={{ borderColor: stamp.color, color: stamp.color }}
            >
              {stamp.text}
            </button>
          ))}
        </div>
      )}

      {/* Right Controls */}
      <div className="ml-auto flex items-center gap-2">
        {onClearAll && (
          <button
            onClick={onClearAll}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
            title="Clear all annotations"
          >
            Clear All
          </button>
        )}
        {activeTool && (
          <button
            onClick={() => onSelectTool(null)}
            className="text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-md transition-colors"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
