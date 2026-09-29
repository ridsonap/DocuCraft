"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { parsePageRanges } from "@/lib/pageRanges";

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

  // Pure parse — no setState during render
  const { pages, error } = parsePageRanges(input, totalPages);

  const handleSubmit = () => {
    if (pages.length === 0 || error) return;
    // Selection state is 0-indexed, input is 1-based
    onSelect(pages.map((p) => p - 1));
    onClose();
  };

  const preview =
    pages.length === 0
      ? "Belum ada halaman dipilih"
      : pages.length > 10
        ? `${pages.length} halaman dipilih (${pages.slice(0, 5).join(", ")}...)`
        : `${pages.length} halaman: ${pages.join(", ")}`;

  return (
    <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200 shadow-lg">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="cth. 1,3,5-7,10"
        className="w-44 h-8 px-3 text-sm bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-400"
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onClose();
        }}
        autoFocus
      />
      <button
        onClick={handleSubmit}
        disabled={pages.length === 0 || !!error}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Check size={12} />
        Pilih
      </button>
      <button
        onClick={onClose}
        className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
        title="Tutup"
      >
        ✕
      </button>

      {/* Preview / Error */}
      <div className="ml-1 text-xs text-gray-600 min-w-[120px]">
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : (
          <span className="truncate">{preview}</span>
        )}
      </div>
    </div>
  );
}
