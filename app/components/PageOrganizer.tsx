"use client";

import { useState, useEffect, useCallback } from "react";
import { PageThumbnail } from "@/types/pdf";
import { api } from "@/lib/api";
import {
  RotateCw,
  Trash2,
  GripVertical,
  Check,
  Plus,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Layers,
} from "lucide-react";

interface PageOrganizerProps {
  pdfId: string;
  onUpdate?: () => void;
}

export default function PageOrganizer({ pdfId, onUpdate }: PageOrganizerProps) {
  const [pages, setPages] = useState<PageThumbnail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [draggedPage, setDraggedPage] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };

  // Load thumbnails
  const loadThumbnails = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getThumbnails(pdfId, 180);
      setPages(data.pages);
    } catch (err) {
      console.error("Failed to load thumbnails:", err);
    } finally {
      setLoading(false);
    }
  }, [pdfId]);

  useEffect(() => {
    loadThumbnails();
  }, [loadThumbnails]);

  // Selection toggle
  const toggleSelect = (pageNum: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selected);
    if (newSelected.has(pageNum)) {
      newSelected.delete(pageNum);
    } else {
      newSelected.add(pageNum);
    }
    setSelected(newSelected);
  };

  const selectAll = () => {
    if (selected.size === pages.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pages.map((p) => p.page)));
    }
  };

  // Drag and drop reorder
  const handleDragStart = (pageNum: number) => {
    setDraggedPage(pageNum);
  };

  const handleDragOver = (e: React.DragEvent, targetPage: number) => {
    e.preventDefault();
    if (draggedPage === null || draggedPage === targetPage) return;

    const newPages = [...pages];
    const draggedIdx = newPages.findIndex((p) => p.page === draggedPage);
    const targetIdx = newPages.findIndex((p) => p.page === targetPage);

    if (draggedIdx === -1 || targetIdx === -1) return;

    const [removed] = newPages.splice(draggedIdx, 1);
    newPages.splice(targetIdx, 0, removed);

    setPages(newPages);
  };

  const handleDragEnd = async () => {
    if (draggedPage === null) return;

    const newOrder = pages.map((p) => p.page);
    setDraggedPage(null);
    setActionLoading(true);

    try {
      await api.reorderPages(pdfId, newOrder);
      showNotification("Pages reordered successfully");
      await loadThumbnails();
      onUpdate?.();
    } catch (err) {
      console.error("Failed to reorder:", err);
      await loadThumbnails();
    } finally {
      setActionLoading(false);
    }
  };

  // Move page single step
  const movePage = async (index: number, direction: -1 | 1, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= pages.length) return;

    const newPages = [...pages];
    const [moved] = newPages.splice(index, 1);
    newPages.splice(targetIdx, 0, moved);
    setPages(newPages);

    const newOrder = newPages.map((p) => p.page);
    setActionLoading(true);
    try {
      await api.reorderPages(pdfId, newOrder);
      await loadThumbnails();
      onUpdate?.();
    } catch (err) {
      console.error("Failed to move page:", err);
      await loadThumbnails();
    } finally {
      setActionLoading(false);
    }
  };

  // Rotate selected pages
  const handleRotate = async (degrees: 90 | 180 | 270) => {
    const targetPages = selected.size > 0 ? Array.from(selected) : pages.map((p) => p.page);
    if (targetPages.length === 0) return;

    setActionLoading(true);
    try {
      await api.rotatePages(pdfId, targetPages, degrees);
      showNotification(`Rotated ${targetPages.length} page(s) by ${degrees}°`);
      await loadThumbnails();
      onUpdate?.();
    } catch (err) {
      console.error("Failed to rotate:", err);
    } finally {
      setActionLoading(false);
    }
  };

  // Rotate single page
  const handleRotateSingle = async (pageNum: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(true);
    try {
      await api.rotatePages(pdfId, [pageNum], 90);
      await loadThumbnails();
      onUpdate?.();
    } catch (err) {
      console.error("Failed to rotate page:", err);
    } finally {
      setActionLoading(false);
    }
  };

  // Delete selected pages
  const handleDelete = async () => {
    if (selected.size === 0) return;
    if (selected.size >= pages.length) {
      alert("Cannot delete all pages from the document.");
      return;
    }
    if (!confirm(`Are you sure you want to delete ${selected.size} selected page(s)?`)) return;

    setActionLoading(true);
    try {
      await api.deletePages(pdfId, Array.from(selected));
      setSelected(new Set());
      showNotification(`Deleted ${selected.size} page(s)`);
      await loadThumbnails();
      onUpdate?.();
    } catch (err) {
      console.error("Failed to delete pages:", err);
    } finally {
      setActionLoading(false);
    }
  };

  // Delete single page
  const handleDeleteSingle = async (pageNum: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (pages.length <= 1) {
      alert("Cannot delete the only page in the document.");
      return;
    }
    if (!confirm(`Delete page ${pageNum + 1}?`)) return;

    setActionLoading(true);
    try {
      await api.deletePages(pdfId, [pageNum]);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(pageNum);
        return next;
      });
      await loadThumbnails();
      onUpdate?.();
    } catch (err) {
      console.error("Failed to delete page:", err);
    } finally {
      setActionLoading(false);
    }
  };

  // Insert blank page
  const handleInsertBlank = async () => {
    setActionLoading(true);
    try {
      const lastPageIdx = pages.length > 0 ? pages[pages.length - 1].page : undefined;
      await api.insertBlankPage(pdfId, lastPageIdx);
      showNotification("Blank page added to document");
      await loadThumbnails();
      onUpdate?.();
    } catch (err) {
      console.error("Failed to insert blank page:", err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <div className="animate-spin h-8 w-8 border-3 border-blue-600 border-t-transparent rounded-full mb-3" />
        <span className="text-sm font-medium">Loading page thumbnails...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 select-none">
      {/* Top Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-white border-b shadow-xs">
        {/* Left: Selection summary & Select All */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full">
            {selected.size > 0 ? `${selected.size} of ${pages.length} selected` : `${pages.length} Pages`}
          </span>

          <button
            onClick={selectAll}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
          >
            {selected.size === pages.length ? "Deselect All" : "Select All"}
          </button>
        </div>

        {/* Center Notification */}
        {message && (
          <div className="text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 animate-in fade-in">
            {message}
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleInsertBlank}
            disabled={actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
            title="Add a new blank page at the end"
          >
            <Plus size={15} />
            Add Page
          </button>

          <div className="h-5 w-px bg-gray-300 mx-1" />

          {/* Rotate buttons */}
          <button
            onClick={() => handleRotate(90)}
            disabled={actionLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
            title="Rotate 90° Clockwise"
          >
            <RotateCw size={14} />
            Rotate 90°
          </button>
          <button
            onClick={() => handleRotate(180)}
            disabled={actionLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
            title="Rotate 180°"
          >
            <RotateCw size={14} className="rotate-90" />
            180°
          </button>

          {/* Delete Button */}
          {selected.size > 0 && (
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors shadow-xs"
              title="Delete Selected Pages"
            >
              <Trash2 size={14} />
              Delete ({selected.size})
            </button>
          )}

          <button
            onClick={loadThumbnails}
            disabled={actionLoading}
            className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors ml-1"
            title="Refresh thumbnails"
          >
            <RefreshCw size={15} className={actionLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Pages Grid Container */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5 max-w-7xl mx-auto">
          {pages.map((page, idx) => {
            const isSelected = selected.has(page.page);
            const isDragged = draggedPage === page.page;

            return (
              <div
                key={page.page}
                draggable
                onDragStart={() => handleDragStart(page.page)}
                onDragOver={(e) => handleDragOver(e, page.page)}
                onDragEnd={handleDragEnd}
                onClick={(e) => toggleSelect(page.page, e)}
                className={`group relative flex flex-col bg-white rounded-xl shadow-xs border-2 transition-all cursor-pointer overflow-hidden ${
                  isSelected
                    ? "border-blue-600 ring-2 ring-blue-500/20 shadow-md"
                    : "border-gray-200 hover:border-gray-400 hover:shadow-md"
                } ${isDragged ? "opacity-35 scale-95" : ""}`}
              >
                {/* Drag Grip Handle */}
                <div
                  className="absolute top-2 left-2 z-10 p-1 bg-white/90 rounded-md shadow-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>

                {/* Selection Check Indicator */}
                <div
                  className={`absolute top-2 right-2 z-10 w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                    isSelected
                      ? "bg-blue-600 text-white"
                      : "border border-gray-300 bg-white/80 opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {isSelected && <Check size={13} strokeWidth={3} />}
                </div>

                {/* Thumbnail Image Container */}
                <div className="relative aspect-[3/4] w-full bg-gray-50 flex items-center justify-center p-3 overflow-hidden">
                  <img
                    src={page.thumbnail}
                    alt={`Page ${idx + 1}`}
                    className="max-h-full max-w-full object-contain shadow-xs border border-gray-100 rounded-xs"
                    draggable={false}
                  />

                  {/* Hover Quick Actions */}
                  <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                    <button
                      onClick={(e) => movePage(idx, -1, e)}
                      disabled={idx === 0}
                      className="p-1.5 bg-white text-gray-700 rounded-full hover:bg-gray-100 disabled:opacity-30 shadow-md"
                      title="Move Page Left"
                    >
                      <ArrowLeft size={13} />
                    </button>
                    <button
                      onClick={(e) => handleRotateSingle(page.page, e)}
                      className="p-1.5 bg-white text-gray-700 rounded-full hover:bg-gray-100 shadow-md"
                      title="Rotate Page 90°"
                    >
                      <RotateCw size={13} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteSingle(page.page, e)}
                      className="p-1.5 bg-white text-red-600 rounded-full hover:bg-red-50 shadow-md"
                      title="Delete Page"
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      onClick={(e) => movePage(idx, 1, e)}
                      disabled={idx === pages.length - 1}
                      className="p-1.5 bg-white text-gray-700 rounded-full hover:bg-gray-100 disabled:opacity-30 shadow-md"
                      title="Move Page Right"
                    >
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>

                {/* Footer: Page Number */}
                <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs font-semibold text-gray-600">
                  <span>Page {idx + 1}</span>
                  <span className="text-[10px] text-gray-400 font-normal">
                    {page.width} × {page.height}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
