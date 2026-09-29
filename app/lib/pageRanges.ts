// Pure parser for page-range input like "1,3,5-7,10".
// Returns 1-based, sorted, deduplicated page numbers. Never touches React state.

export interface PageRangeResult {
  pages: number[];
  error: string | null;
}

export function parsePageRanges(value: string, totalPages: number): PageRangeResult {
  const pages = new Set<number>();
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);

  if (parts.length === 0) return { pages: [], error: null };

  for (const part of parts) {
    if (part.includes("-")) {
      const [rawStart, rawEnd] = part.split("-").map((s) => s.trim());
      const start = parseInt(rawStart, 10);
      const end = parseInt(rawEnd, 10);
      if (isNaN(start) || isNaN(end)) return { pages: [], error: "Rentang harus berupa angka" };
      if (start < 1 || end > totalPages) return { pages: [], error: `Halaman harus 1–${totalPages}` };
      if (start > end) return { pages: [], error: "Awal rentang harus ≤ akhir rentang" };
      for (let i = start; i <= end; i++) pages.add(i);
    } else {
      const p = parseInt(part, 10);
      if (isNaN(p)) return { pages: [], error: `"${part}" bukan nomor halaman` };
      if (p < 1 || p > totalPages) return { pages: [], error: `Halaman harus 1–${totalPages}` };
      pages.add(p);
    }
  }

  return { pages: Array.from(pages).sort((a, b) => a - b), error: null };
}
