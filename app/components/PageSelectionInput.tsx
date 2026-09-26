"use client";

import { useState } from "react";
import { Check } from "lucide-react";

interface PageSelectionInputProps {
  totalPages: number;
  onSelect: (pages: number[]) => void;
  onClose: () => void;
}

export default function PageSelectionInput({
  totalPages,
  onSelect,
  onClose,
}: PageSelectionInputProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parseInput = (value: string): number[] => {
    const pages = new Set<number>();
    const parts = value.split(",").map((s) => s.trim());

    for (const part of parts) {
      if (!part) continue;

      if (part.includes("-")) {
        const rangeParts = part.split("-").map((s) => s.trim());
        if (rangeParts.length !== 2) {
          setError("Invalid range format");
          return [];
        }
        const start = parseInt(rangeParts[0], 10);
        const end = parseInt(rangeParts[1], 10);

        if (isNaN(start) || isNaN(end)) {
          setError("Range must be numbers");
          return [];
        }
        if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
          setError(`Pages must be 1-${totalPages}`);
          return [];
        }
        if (start > end) {
          setError("Start must be <= end");
          return [];
        }

        // Convert to 0-indexed
        for (let i = start - 1; i <= end - 1; i++) {
          pages.add(i);
        }
      } else {
        const page = parseInt(part, 10);
        if (isNaN(page)) {
          setError("Invalid number");
          return [];
        }
        if (page < 1 || page > totalPages) {
          setError(`Pages must be 1-${totalPages}`);
          return [];
        }
        pages.add(page - 1); // Convert to 0-indexed
      }
    }

    return Array.from(pages).sort((a, b) => a - b);
  };

  const handleSubmit = () => {
    if (!input.trim()) return;

    const pages = parseInput(input);
    if (pages.length > 0) {
      onSelect(pages);
      onClose();
    }
  };

  const handleChange = (value: string) => {
    setInput(value);
    setError(null);
  };

  const getPreview = (): string => {
    if (!input.trim()) return "";
    const pages = parseInput(input);
    if (pages.length === 0 && error) return "";
    if (pages.length === 0) return "No pages selected";
    if (pages.length > 10) {
      return `${pages.length} pages selected (${pages.slice(0, 5).map(p => p + 1).join(", ")}...)`;
    }
    return `${pages.length} page(s): ${pages.map(p => p + 1).join(", ")}`;
  };

  return (
    <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-700 shadow-lg">
      <input
        type="text"
        value={input}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="e.g. 1,3,5-7,10"
        className="w-44 h-8 px-3 text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400"
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onClose();
        }}
        autoFocus
      />
      <button
        onClick={handleSubmit}
        disabled={!input.trim() || !!error}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Check size={12} />
        Select
      </button>
      <button
        onClick={onClose}
        className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        title="Close"
      >
        ✕
      </button>

      {/* Preview / Error */}
      <div className="ml-1 text-xs text-gray-600 dark:text-gray-300 min-w-[120px]">
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : (
          <span className="truncate">{getPreview()}</span>
        )}
      </div>
    </div>
  );
}
