"use client";

import { useRef, useState } from "react";
import {
  Combine,
  Scissors,
  Minimize2,
  ImagePlus,
  Images,
  Droplets,
  Hash,
  Lock,
  KeyRound,
  Loader2,
} from "lucide-react";
import { api, downloadBlob } from "@/lib/api";
import { parsePageRanges } from "@/lib/pageRanges";

interface ToolsPanelProps {
  pdfId: string;
  filename: string;
  totalPages: number;
  onChanged: () => void; // refresh PDF bytes after in-place modifications
  notify: (text: string, type?: "success" | "error" | "info") => void;
}

const inputCls =
  "w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-400";
const labelCls = "text-xs font-medium text-gray-600";
const btnCls =
  "px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center gap-2";

function Card({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: React.ComponentType<{ size?: number | string }>;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Icon size={20} />
        </div>
        <div>
          <h3 className="font-bold text-sm text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ActionButton({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled || busy} className={btnCls}>
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

const fmtSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export default function ToolsPanel({ pdfId, filename, totalPages, onChanged, notify }: ToolsPanelProps) {
  const baseName = filename.replace(/\.pdf$/i, "") || "document";
  const [busy, setBusy] = useState<string | null>(null);

  // Merge
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  // Split
  const [splitRange, setSplitRange] = useState("");

  // Compress
  const [compressLevel, setCompressLevel] = useState<"low" | "medium" | "high">("medium");
  const [compressInfo, setCompressInfo] = useState<string | null>(null);

  // Images → PDF
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const imagesInputRef = useRef<HTMLInputElement>(null);

  // Export images
  const [exportDpi, setExportDpi] = useState(150);

  // Watermark
  const [wmText, setWmText] = useState("DRAFT");
  const [wmOpacity, setWmOpacity] = useState(0.15);
  const [wmSize, setWmSize] = useState(48);
  const [wmAngle, setWmAngle] = useState(-45);

  // Page numbers
  const [pnPosition, setPnPosition] = useState("bottom-center");
  const [pnStart, setPnStart] = useState(1);
  const [pnSize, setPnSize] = useState(10);

  // Protect / Unlock
  const [protectPw, setProtectPw] = useState("");
  const [unlockFile, setUnlockFile] = useState<File | null>(null);
  const [unlockPw, setUnlockPw] = useState("");
  const unlockInputRef = useRef<HTMLInputElement>(null);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } catch (err: any) {
      notify(err?.message || "Operasi gagal", "error");
    } finally {
      setBusy(null);
    }
  };

  const splitParsed = parsePageRanges(splitRange, totalPages);

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h2 className="text-lg font-bold text-gray-900">Tools PDF</h2>
          <p className="text-sm text-gray-500">
            Operasi dokumen ala Nitro / Adobe Acrobat untuk <span className="font-medium text-gray-700">{filename}</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* 1. Merge PDF */}
          <Card icon={Combine} title="Gabung PDF (Merge)" desc="Satukan beberapa file PDF menjadi satu dokumen.">
            <label className={labelCls}>Pilih minimal 2 file PDF</label>
            <input
              ref={mergeInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              onChange={(e) => setMergeFiles(Array.from(e.target.files || []))}
              className="text-xs text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 file:border file:border-blue-200 file:rounded-lg hover:file:bg-blue-100"
            />
            {mergeFiles.length > 0 && (
              <p className="text-xs text-gray-500">{mergeFiles.length} file dipilih</p>
            )}
            <ActionButton
              busy={busy === "merge"}
              disabled={mergeFiles.length < 2}
              onClick={() =>
                run("merge", async () => {
                  const blob = await api.mergePDFs(mergeFiles);
                  downloadBlob(blob, `${baseName}_merged.pdf`);
                  setMergeFiles([]);
                  if (mergeInputRef.current) mergeInputRef.current.value = "";
                  notify("PDF berhasil digabungkan!");
                })
              }
            >
              Gabung & Download
            </ActionButton>
          </Card>

          {/* 2. Split / Extract */}
          <Card icon={Scissors} title="Pisah / Ekstrak Halaman" desc="Ambil halaman tertentu menjadi file PDF baru.">
            <label className={labelCls}>Halaman (cth. 1,3,5-7)</label>
            <input
              value={splitRange}
              onChange={(e) => setSplitRange(e.target.value)}
              placeholder={`1-${totalPages}`}
              className={inputCls}
            />
            {splitParsed.error ? (
              <p className="text-xs text-red-500">{splitParsed.error}</p>
            ) : (
              splitParsed.pages.length > 0 && (
                <p className="text-xs text-gray-500">
                  {splitParsed.pages.length} halaman: {splitParsed.pages.slice(0, 8).join(", ")}
                  {splitParsed.pages.length > 8 && "..."}
                </p>
              )
            )}
            <ActionButton
              busy={busy === "split"}
              disabled={splitParsed.pages.length === 0 || !!splitParsed.error}
              onClick={() =>
                run("split", async () => {
                  const blob = await api.splitPDF(pdfId, splitParsed.pages);
                  downloadBlob(blob, `${baseName}_split.pdf`);
                  setSplitRange("");
                  notify("Halaman berhasil diekstrak!");
                })
              }
            >
              Ekstrak & Download
            </ActionButton>
          </Card>

          {/* 3. Compress */}
          <Card icon={Minimize2} title="Kompres PDF" desc="Perkecil ukuran file dengan menurunkan kualitas gambar.">
            <label className={labelCls}>Tingkat kompresi</label>
            <select
              value={compressLevel}
              onChange={(e) => setCompressLevel(e.target.value as "low" | "medium" | "high")}
              className={inputCls}
            >
              <option value="low">Ringan (kualitas tetap baik)</option>
              <option value="medium">Standar</option>
              <option value="high">Maksimal (file terkecil)</option>
            </select>
            {compressInfo && <p className="text-xs text-emerald-600 font-medium">{compressInfo}</p>}
            <ActionButton
              busy={busy === "compress"}
              onClick={() =>
                run("compress", async () => {
                  const r = await api.compressPDF(pdfId, compressLevel);
                  setCompressInfo(`Ukuran ${fmtSize(r.original_size)} → ${fmtSize(r.compressed_size)} (hemat ${r.saved_pct}%)`);
                  onChanged();
                  notify("PDF berhasil dikompres!");
                })
              }
            >
              Kompres Dokumen
            </ActionButton>
          </Card>

          {/* 4. Images → PDF */}
          <Card icon={ImagePlus} title="Gambar → PDF" desc="Susun beberapa gambar menjadi satu file PDF.">
            <label className={labelCls}>Pilih gambar (JPG/PNG)</label>
            <input
              ref={imagesInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setImageFiles(Array.from(e.target.files || []))}
              className="text-xs text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 file:border file:border-blue-200 file:rounded-lg hover:file:bg-blue-100"
            />
            {imageFiles.length > 0 && (
              <p className="text-xs text-gray-500">{imageFiles.length} gambar dipilih</p>
            )}
            <ActionButton
              busy={busy === "img2pdf"}
              disabled={imageFiles.length === 0}
              onClick={() =>
                run("img2pdf", async () => {
                  const blob = await api.imagesToPDF(imageFiles);
                  downloadBlob(blob, `${baseName}_dari-gambar.pdf`);
                  setImageFiles([]);
                  if (imagesInputRef.current) imagesInputRef.current.value = "";
                  notify("PDF dari gambar berhasil dibuat!");
                })
              }
            >
              Buat PDF & Download
            </ActionButton>
          </Card>

          {/* 5. Export images */}
          <Card icon={Images} title="Ekspor → Gambar (ZIP)" desc="Simpan setiap halaman sebagai file gambar.">
            <label className={labelCls}>Resolusi</label>
            <select value={exportDpi} onChange={(e) => setExportDpi(Number(e.target.value))} className={inputCls}>
              <option value={72}>72 DPI (cepat, kecil)</option>
              <option value={150}>150 DPI (standar)</option>
              <option value={300}>300 DPI (cetak)</option>
            </select>
            <ActionButton
              busy={busy === "exportimg"}
              onClick={() =>
                run("exportimg", async () => {
                  const blob = await api.exportImages(pdfId, exportDpi);
                  downloadBlob(blob, `${baseName}_images.zip`);
                  notify("Gambar halaman berhasil diekspor!");
                })
              }
            >
              Ekspor & Download ZIP
            </ActionButton>
          </Card>

          {/* 6. Watermark */}
          <Card icon={Droplets} title="Watermark" desc="Tambahkan teks watermark diagonal di semua halaman.">
            <label className={labelCls}>Teks watermark</label>
            <input value={wmText} onChange={(e) => setWmText(e.target.value)} className={inputCls} placeholder="DRAFT / RAHASIA" />
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>Ukuran</label>
                <input type="number" min={8} max={200} value={wmSize} onChange={(e) => setWmSize(Number(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Sudut°</label>
                <input type="number" min={-90} max={90} value={wmAngle} onChange={(e) => setWmAngle(Number(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Opasitas</label>
                <input type="number" min={0.05} max={0.8} step={0.05} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} className={inputCls} />
              </div>
            </div>
            <ActionButton
              busy={busy === "watermark"}
              disabled={!wmText.trim()}
              onClick={() =>
                run("watermark", async () => {
                  await api.addWatermark(pdfId, { text: wmText.trim(), opacity: wmOpacity, font_size: wmSize, angle: wmAngle });
                  onChanged();
                  notify("Watermark berhasil ditambahkan!");
                })
              }
            >
              Terapkan Watermark
            </ActionButton>
          </Card>

          {/* 7. Page numbers */}
          <Card icon={Hash} title="Nomor Halaman" desc="Sisipkan nomor halaman otomatis ke dokumen.">
            <label className={labelCls}>Posisi</label>
            <select value={pnPosition} onChange={(e) => setPnPosition(e.target.value)} className={inputCls}>
              <option value="bottom-center">Bawah tengah</option>
              <option value="bottom-right">Bawah kanan</option>
              <option value="bottom-left">Bawah kiri</option>
              <option value="top-center">Atas tengah</option>
              <option value="top-right">Atas kanan</option>
              <option value="top-left">Atas kiri</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Mulai dari</label>
                <input type="number" min={0} value={pnStart} onChange={(e) => setPnStart(Number(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Ukuran font</label>
                <input type="number" min={6} max={48} value={pnSize} onChange={(e) => setPnSize(Number(e.target.value))} className={inputCls} />
              </div>
            </div>
            <ActionButton
              busy={busy === "pagenum"}
              onClick={() =>
                run("pagenum", async () => {
                  await api.addPageNumbers(pdfId, { position: pnPosition, start: pnStart, font_size: pnSize });
                  onChanged();
                  notify("Nomor halaman berhasil ditambahkan!");
                })
              }
            >
              Terapkan Nomor Halaman
            </ActionButton>
          </Card>

          {/* 8. Protect */}
          <Card icon={Lock} title="Proteksi Password" desc="Kunci dokumen dengan password.">
            <label className={labelCls}>Password</label>
            <input
              type="password"
              value={protectPw}
              onChange={(e) => setProtectPw(e.target.value)}
              className={inputCls}
              placeholder="Minimal 4 karakter"
              autoComplete="new-password"
            />
            <ActionButton
              busy={busy === "protect"}
              disabled={protectPw.length < 4}
              onClick={() =>
                run("protect", async () => {
                  await api.protectPDF(pdfId, protectPw);
                  setProtectPw("");
                  onChanged();
                  notify("Dokumen berhasil diproteksi password!");
                })
              }
            >
              Kunci Dokumen
            </ActionButton>
          </Card>

          {/* 9. Unlock */}
          <Card icon={KeyRound} title="Buka Kunci (Unlock)" desc="Hapus proteksi password dari file PDF.">
            <label className={labelCls}>File PDF terkunci</label>
            <input
              ref={unlockInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setUnlockFile(e.target.files?.[0] || null)}
              className="text-xs text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 file:border file:border-blue-200 file:rounded-lg hover:file:bg-blue-100"
            />
            <label className={labelCls}>Password</label>
            <input
              type="password"
              value={unlockPw}
              onChange={(e) => setUnlockPw(e.target.value)}
              className={inputCls}
              placeholder="Password dokumen"
              autoComplete="current-password"
            />
            <ActionButton
              busy={busy === "unlock"}
              disabled={!unlockFile || !unlockPw}
              onClick={() =>
                run("unlock", async () => {
                  const blob = await api.unlockPDF(unlockFile!, unlockPw);
                  downloadBlob(blob, `${unlockFile!.name.replace(/\.pdf$/i, "")}_unlocked.pdf`);
                  setUnlockFile(null);
                  setUnlockPw("");
                  if (unlockInputRef.current) unlockInputRef.current.value = "";
                  notify("Proteksi berhasil dibuka!");
                })
              }
            >
              Buka & Download
            </ActionButton>
          </Card>
        </div>
      </div>
    </div>
  );
}
