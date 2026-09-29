"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import PDFViewer from "@/components/PDFViewer";
import TextEditLayer from "@/components/TextEditLayer";
import PageOrganizer from "@/components/PageOrganizer";
import AnnotationToolbar from "@/components/AnnotationToolbar";
import AnnotationLayer from "@/components/AnnotationLayer";
import SignatureCanvas from "@/components/SignatureCanvas";
import ToolsPanel from "@/components/ToolsPanel";
import { api, downloadBlob } from "@/lib/api";
import { TextBlock } from "@/types/pdf";
import { Annotation, AnnotationType } from "@/types/annotation";
import {
  FileUp,
  Type,
  Layers,
  ScanSearch,
  Download,
  Edit3,
  PenTool,
  CheckCircle2,
  AlertCircle,
  Plus,
  Copy,
  FileCheck,
  RefreshCw,
  Sparkles,
  Wrench,
} from "lucide-react";

type Tab = "edit" | "organize" | "annotate" | "ocr" | "tools";

export default function HomePage() {
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("document.pdf");
  const [fileSize, setFileSize] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<Tab>("edit");
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  // Text edit state
  const [isAddTextMode, setIsAddTextMode] = useState(false);

  // Annotation state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeTool, setActiveTool] = useState<AnnotationType | null>(null);
  const [activeColor, setActiveColor] = useState("#ef4444");
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  // OCR state
  const [ocrResults, setOcrResults] = useState<any>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ text, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
  };

  // Reload PDF binary bytes from backend
  const reloadPDF = useCallback(async (targetPdfId = pdfId) => {
    if (!targetPdfId) return;
    try {
      const buffer = await api.fetchPDFBytes(targetPdfId);
      setPdfData(buffer);

      // Also reload text blocks for current page
      const textData = await api.extractText(targetPdfId, currentPage - 1);
      setTextBlocks(textData.blocks || []);
    } catch (err) {
      console.error("Failed to reload PDF:", err);
    }
  }, [pdfId, currentPage]);

  // Load annotations and text blocks when PDF or page changes
  useEffect(() => {
    if (!pdfId) return;

    // Fetch annotations
    api.getAnnotations(pdfId)
      .then((data) => {
        const annotList = Object.entries(data.annotations || {}).map(([id, annot]) => ({
          ...annot,
          id,
        })) as Annotation[];
        setAnnotations(annotList);
      })
      .catch(console.error);

    // Fetch text blocks for editing
    if (activeTab === "edit") {
      api.extractText(pdfId, currentPage - 1)
        .then((data) => {
          setTextBlocks(data.blocks || []);
        })
        .catch(console.error);
    }
  }, [pdfId, currentPage, activeTab]);

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const data = await file.arrayBuffer();
      const result = await api.uploadPDF(file);

      setPdfData(data);
      setPdfId(result.id);
      setFilename(result.filename);
      setFileSize(result.size || file.size);
      setTotalPages(result.page_count);
      setCurrentPage(1);
      setAnnotations([]);
      setOcrResults(null);
      setActiveTab("edit");
      showToast(`Berhasil memuat ${result.filename} (${result.page_count} halaman)`);
    } catch (err: any) {
      console.error("Upload failed:", err);
      showToast(err?.message || "Gagal mengunggah PDF. Pastikan backend aktif!", "error");
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Refresh PDF bytes after an in-place tool modified the document
  const handleToolsChanged = async () => {
    await reloadPDF();
  };

  // Handle edit completion
  const handleEditComplete = async () => {
    showToast("Teks berhasil diperbarui pada PDF!");
    await reloadPDF();
  };

  // Handle page organizer update
  const handleOrganizerUpdate = async () => {
    if (!pdfId) return;
    try {
      const buffer = await api.fetchPDFBytes(pdfId);
      setPdfData(buffer);
      const thumbs = await api.getThumbnails(pdfId, 100);
      setTotalPages(thumbs.page_count);
      if (currentPage > thumbs.page_count) {
        setCurrentPage(Math.max(1, thumbs.page_count));
      }
    } catch (err) {
      console.error("Failed to sync after organizer update:", err);
    }
  };

  // Run OCR
  const handleOCRScan = async (pageOnly: boolean = false) => {
    if (!pdfId) return;

    setOcrLoading(true);
    setOcrError(null);
    try {
      const targetPage = pageOnly ? currentPage - 1 : undefined;
      const results = await api.performOCR(pdfId, targetPage);
      setOcrResults(results);
      const pageCount = results.pages?.length ?? 0;
      showToast(`OCR selesai memproses ${pageCount} halaman!`);
    } catch (err: any) {
      console.error("OCR failed:", err);
      setOcrError(
        err?.message ||
          "Gagal menjalankan OCR. Tesseract OCR belum terpasang di sistem. Pasang Tesseract atau jalankan via Docker."
      );
      showToast("OCR gagal dijalankan", "error");
    } finally {
      setOcrLoading(false);
    }
  };

  // Export with annotations
  const handleExportWithAnnotations = async () => {
    if (!pdfId) return;

    try {
      showToast("Menyiapkan ekspor anotasi...", "info");
      const blob = await api.exportWithAnnotations(pdfId);
      const cleanName = filename.replace(/\.pdf$/i, "");
      downloadBlob(blob, `${cleanName}_annotated.pdf`);
      showToast("PDF dengan anotasi berhasil diekspor!");
    } catch (err) {
      console.error("Export failed:", err);
      showToast("Gagal mengekspor PDF anotasi", "error");
    }
  };

  // Signature save
  const handleSignatureSave = async (strokes: { x: number; y: number }[][]) => {
    if (!pdfId || strokes.length === 0) return;

    try {
      const payload = {
        type: AnnotationType.FREEHAND as const,
        page: currentPage - 1,
        points: strokes.flat(),
        strokes,
        stroke_color: [0, 0, 0] as [number, number, number],
        stroke_width: 2.5,
        opacity: 1.0,
      };

      const result = await api.addAnnotation(pdfId, payload);
      const newAnnotation: Annotation = {
        ...result.annotation,
        id: result.id,
      } as Annotation;

      setAnnotations([...annotations, newAnnotation]);
      setShowSignatureModal(false);
      showToast("Tanda tangan berhasil dibubuhkan!");
    } catch (err) {
      console.error("Failed to save signature:", err);
      showToast("Gagal menyimpan tanda tangan", "error");
    }
  };

  // Clear all annotations
  const handleClearAllAnnotations = async () => {
    if (!pdfId || annotations.length === 0) return;
    if (!confirm("Hapus semua anotasi pada dokumen ini?")) return;

    try {
      await api.clearAnnotations(pdfId);
      setAnnotations([]);
      showToast("Semua anotasi dibersihkan");
    } catch (err) {
      console.error("Failed to clear annotations:", err);
    }
  };

  // Copy OCR text
  const handleCopyOCRText = () => {
    if (!ocrResults) return;
    const pages = ocrResults.pages || [];
    const full = pages.map((p: any) => `--- Halaman ${p.page + 1} ---\n${p.full_text}`).join("\n\n");
    navigator.clipboard.writeText(full).then(
      () => {
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
        showToast("Teks hasil OCR berhasil disalin!");
      },
      () => showToast("Gagal menyalin ke clipboard", "error")
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="h-screen flex flex-col bg-slate-100 text-slate-800 font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg border text-sm font-medium animate-in slide-in-from-top duration-200 bg-white">
          {toastMessage.type === "success" && <CheckCircle2 size={18} className="text-emerald-500" />}
          {toastMessage.type === "error" && <AlertCircle size={18} className="text-red-500" />}
          {toastMessage.type === "info" && <Sparkles size={18} className="text-blue-500" />}
          <span className="text-gray-800">{toastMessage.text}</span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between shadow-xs z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
            <Edit3 size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-gray-900 tracking-tight">DocuCraft</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                Pro
              </span>
            </div>
            {pdfId && (
              <div className="text-xs text-gray-500 flex items-center gap-2">
                <span className="font-medium text-gray-700 truncate max-w-xs">{filename}</span>
                <span>•</span>
                <span>{totalPages} Hal</span>
                <span>•</span>
                <span>{formatFileSize(fileSize)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2">
          {!pdfId ? (
            <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg shadow-xs transition-colors">
              <FileUp size={16} />
              Unggah PDF
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          ) : (
            <>
              {/* Replace / Upload another */}
              <label
                className="cursor-pointer hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 border border-gray-300 rounded-lg transition-colors"
                title="Ganti file PDF"
              >
                <FileUp size={14} />
                Ganti File
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {/* Download original / edited PDF */}
              <button
                onClick={() => api.downloadPDF(pdfId, filename)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs transition-colors"
                title="Download file PDF hasil edit"
              >
                <Download size={14} />
                Download PDF
              </button>

              {/* Export with annotations */}
              {annotations.length > 0 && (
                <button
                  onClick={handleExportWithAnnotations}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-xs transition-colors"
                  title="Ekspor PDF lengkap dengan gambar, stempel, dan tanda tangan"
                >
                  <FileCheck size={14} />
                  Ekspor Beranotasi ({annotations.length})
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      {pdfId ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Vertical Tab Navigation */}
          <nav className="w-16 sm:w-20 bg-slate-900 text-slate-300 flex flex-col py-3 border-r border-slate-800 z-10 shrink-0">
            <div className="space-y-1 px-1">
              {/* Edit Tab */}
              <button
                onClick={() => setActiveTab("edit")}
                className={`w-full flex flex-col items-center justify-center py-3 px-1 rounded-xl transition-all ${
                  activeTab === "edit"
                    ? "bg-blue-600 text-white shadow-md font-medium"
                    : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
                title="Edit Teks Langsung"
              >
                <Type size={20} className="mb-1" />
                <span className="text-[11px] leading-tight text-center">Edit Teks</span>
              </button>

              {/* Organize Tab */}
              <button
                onClick={() => setActiveTab("organize")}
                className={`w-full flex flex-col items-center justify-center py-3 px-1 rounded-xl transition-all ${
                  activeTab === "organize"
                    ? "bg-blue-600 text-white shadow-md font-medium"
                    : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
                title="Atur Urutan & Rotasi Halaman"
              >
                <Layers size={20} className="mb-1" />
                <span className="text-[11px] leading-tight text-center">Halaman</span>
              </button>

              {/* Annotate Tab */}
              <button
                onClick={() => setActiveTab("annotate")}
                className={`w-full flex flex-col items-center justify-center py-3 px-1 rounded-xl transition-all ${
                  activeTab === "annotate"
                    ? "bg-blue-600 text-white shadow-md font-medium"
                    : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
                title="Anotasi, Gambar, dan Tanda Tangan"
              >
                <PenTool size={20} className="mb-1" />
                <span className="text-[11px] leading-tight text-center">Anotasi</span>
              </button>

              {/* OCR Tab */}
              <button
                onClick={() => setActiveTab("ocr")}
                className={`w-full flex flex-col items-center justify-center py-3 px-1 rounded-xl transition-all ${
                  activeTab === "ocr"
                    ? "bg-blue-600 text-white shadow-md font-medium"
                    : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
                title="Scan Teks Gambar (OCR)"
              >
                <ScanSearch size={20} className="mb-1" />
                <span className="text-[11px] leading-tight text-center">OCR</span>
              </button>

              {/* Tools Tab */}
              <button
                onClick={() => setActiveTab("tools")}
                className={`w-full flex flex-col items-center justify-center py-3 px-1 rounded-xl transition-all ${
                  activeTab === "tools"
                    ? "bg-blue-600 text-white shadow-md font-medium"
                    : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
                title="Merge, Split, Kompres, Watermark, dan lainnya"
              >
                <Wrench size={20} className="mb-1" />
                <span className="text-[11px] leading-tight text-center">Tools</span>
              </button>
            </div>

            <div className="mt-auto px-2">
              <button
                onClick={() => reloadPDF()}
                className="w-full py-2 flex flex-col items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                title="Muat Ulang PDF"
              >
                <RefreshCw size={16} />
                <span className="text-[9px] mt-1">Refresh</span>
              </button>
            </div>
          </nav>

          {/* Tab Content Body */}
          <main className="flex-1 flex flex-col overflow-hidden relative">
            {/* 1. Edit Tab */}
            {activeTab === "edit" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Secondary toolbar for text editing */}
                <div className="px-4 py-2 bg-white border-b flex items-center justify-between text-xs text-gray-600">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">Mode Edit Teks:</span>
                    <span className="text-gray-500">
                      Klik teks mana saja pada halaman untuk mengubahnya secara langsung.
                    </span>
                  </div>

                  <button
                    onClick={() => setIsAddTextMode(!isAddTextMode)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                      isAddTextMode
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                    }`}
                  >
                    <Plus size={14} />
                    {isAddTextMode ? "Batal Tambah Teks" : "+ Tambah Teks Baru"}
                  </button>
                </div>

                <div className="flex-1 relative overflow-hidden">
                  <PDFViewer
                    pdfData={pdfData}
                    currentPage={currentPage}
                    scale={scale}
                    onPageChange={(p) => setCurrentPage(p)}
                    onScaleChange={(s) => setScale(s)}
                  >
                    <TextEditLayer
                      pdfId={pdfId}
                      pageNumber={currentPage}
                      scale={scale}
                      blocks={textBlocks}
                      onEditComplete={handleEditComplete}
                      isAddTextMode={isAddTextMode}
                      onAddTextModeChange={setIsAddTextMode}
                    />
                  </PDFViewer>
                </div>
              </div>
            )}

            {/* 2. Organize Pages Tab */}
            {activeTab === "organize" && (
              <PageOrganizer
                pdfId={pdfId}
                onUpdate={handleOrganizerUpdate}
              />
            )}

            {/* 3. Annotations & Signatures Tab */}
            {activeTab === "annotate" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Annotation Tool Bar */}
                <AnnotationToolbar
                  activeTool={activeTool}
                  onSelectTool={setActiveTool}
                  onOpenSignature={() => setShowSignatureModal(true)}
                  color={activeColor}
                  onColorChange={setActiveColor}
                  onClearAll={annotations.length > 0 ? handleClearAllAnnotations : undefined}
                />

                <div className="flex-1 relative overflow-hidden">
                  <PDFViewer
                    pdfData={pdfData}
                    currentPage={currentPage}
                    scale={scale}
                    onPageChange={(p) => setCurrentPage(p)}
                    onScaleChange={(s) => setScale(s)}
                  >
                    <AnnotationLayer
                      pdfId={pdfId}
                      pageNumber={currentPage}
                      scale={scale}
                      activeTool={activeTool}
                      activeColor={activeColor}
                      annotations={annotations}
                      onAnnotationsChange={setAnnotations}
                    />
                  </PDFViewer>
                </div>
              </div>
            )}

            {/* 4. OCR Scanner Tab */}
            {activeTab === "ocr" && (
              <div className="flex-1 overflow-auto p-6 md:p-8 flex flex-col items-center justify-start">
                <div className="w-full max-w-3xl bg-white rounded-2xl shadow-sm border border-gray-200 p-6 md:p-8">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 shrink-0">
                      <ScanSearch size={28} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">OCR Scanner (Ekstraksi Teks Gambar)</h2>
                      <p className="text-sm text-gray-600 mt-0.5">
                        Pindai dokumen yang berbentuk gambar atau hasil scan agar teksnya dapat dicari dan disalin.
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-3 p-4 bg-slate-50 rounded-xl border mb-6">
                    <button
                      onClick={() => handleOCRScan(true)}
                      disabled={ocrLoading}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2 shadow-xs transition-colors"
                    >
                      {ocrLoading ? <RefreshCw size={14} className="animate-spin" /> : <ScanSearch size={14} />}
                      Scan Halaman Aktif ({currentPage})
                    </button>

                    <button
                      onClick={() => handleOCRScan(false)}
                      disabled={ocrLoading}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2 shadow-xs transition-colors"
                    >
                      {ocrLoading ? <RefreshCw size={14} className="animate-spin" /> : <ScanSearch size={14} />}
                      Scan Semua Halaman ({totalPages})
                    </button>
                  </div>

                  {/* Error Notification */}
                  {ocrError && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 mb-6 flex items-start gap-3">
                      <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold mb-1">Pemberitahuan OCR Engine:</div>
                        <div>{ocrError}</div>
                        <div className="mt-2 text-amber-700">
                          Tips: Jalankan <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">brew install tesseract</code> di macOS atau deploy menggunakan Dockerfile yang telah disertakan.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Results Display */}
                  {ocrResults && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b pb-3">
                        <span className="font-semibold text-sm text-gray-800">
                          Hasil Ekstraksi Teks ({ocrResults.pages?.length ?? 0} Halaman Diproses)
                        </span>

                        <button
                          onClick={handleCopyOCRText}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200"
                        >
                          <Copy size={13} />
                          {copiedText ? "Tersalin!" : "Salin Semua Teks"}
                        </button>
                      </div>

                      <div className="space-y-4 max-h-[500px] overflow-auto pr-1">
                        {(ocrResults.pages || []).map((p: any) => (
                          <div key={p.page} className="border rounded-xl p-4 bg-gray-50/50">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-gray-700 bg-white px-2 py-0.5 rounded border">
                                Halaman {p.page + 1}
                              </span>
                              <span className="text-xs text-gray-500 font-mono">
                                {p.word_count || 0} kata ditemukan
                              </span>
                            </div>
                            <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans bg-white p-3 rounded-lg border leading-relaxed">
                              {p.full_text || "(Tidak ada teks yang terdeteksi)"}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 5. Tools Tab */}
            {activeTab === "tools" && (
              <ToolsPanel
                pdfId={pdfId}
                filename={filename}
                totalPages={totalPages}
                onChanged={handleToolsChanged}
                notify={showToast}
              />
            )}
          </main>
        </div>
      ) : (
        /* Empty Welcome State: Upload prompt */
        <main className="flex-1 flex items-center justify-center p-6 bg-slate-50">
          <div className="text-center max-w-lg bg-white p-10 rounded-3xl shadow-sm border border-gray-200">
            <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xs">
              <FileUp size={36} />
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              DocuCraft PDF Editor
            </h2>
            <p className="text-gray-600 text-sm mb-8 leading-relaxed">
              Edit teks langsung, atur dan putar halaman, bubuhkan tanda tangan digital, buat catatan, dan scan OCR dalam satu aplikasi web cepat & modern.
            </p>

            <label className="cursor-pointer inline-flex items-center gap-2.5 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl shadow-md transition-all hover:shadow-lg active:scale-98">
              <FileUp size={18} />
              Pilih Dokumen PDF
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <div className="grid grid-cols-3 gap-4 mt-10 pt-8 border-t border-gray-100 text-left">
              <div>
                <div className="font-semibold text-xs text-gray-800 mb-1">✍️ In-Place Text</div>
                <div className="text-[11px] text-gray-500">Edit teks asli langsung pada dokumen.</div>
              </div>
              <div>
                <div className="font-semibold text-xs text-gray-800 mb-1">📑 Atur Halaman</div>
                <div className="text-[11px] text-gray-500">Drag-drop reorder, putar 90°, hapus.</div>
              </div>
              <div>
                <div className="font-semibold text-xs text-gray-800 mb-1">🖋️ Tanda Tangan</div>
                <div className="text-[11px] text-gray-500">Gambar tanda tangan & ekspor vector PDF.</div>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* Signature Modal */}
      {showSignatureModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <PenTool size={18} className="text-blue-600" />
                Buat Tanda Tangan Digital
              </h3>
            </div>
            <SignatureCanvas
              onSave={handleSignatureSave}
              onCancel={() => setShowSignatureModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
