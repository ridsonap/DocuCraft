// API client for DocuCraft backend

const API_BASE = process.env.NEXT_PUBLIC_API_URL !== undefined 
  ? process.env.NEXT_PUBLIC_API_URL 
  : (typeof window !== 'undefined' ? '' : 'http://127.0.0.1:8000');

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const fullUrl = `${API_BASE}${url}`;
  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      const errText = await res.text().catch(() => '');
      if (errText) errorDetail = errText;
    }
    throw new Error(errorDetail);
  }

  return res.json();
}

export const api = {
  // Upload
  uploadPDF: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetchJSON<{ id: string; filename: string; page_count: number; size: number }>(
      '/api/pdf/upload',
      { method: 'POST', body: formData }
    );
  },

  // Fetch binary PDF bytes
  fetchPDFBytes: async (pdfId: string): Promise<ArrayBuffer> => {
    const res = await fetch(`${API_BASE}/api/pdf/${pdfId}/download`);
    if (!res.ok) {
      throw new Error(`Failed to load PDF file: HTTP ${res.status}`);
    }
    return res.arrayBuffer();
  },

  // Text extraction
  extractText: async (pdfId: string, page?: number) => {
    const url = page !== undefined
      ? `/api/pdf/${pdfId}/extract-text?page=${page}`
      : `/api/pdf/${pdfId}/extract-text`;
    return fetchJSON<{ blocks: import('@/types/pdf').TextBlock[]; count: number }>(url);
  },

  // Text editing
  editText: async (pdfId: string, payload: import('@/types/pdf').TextEditPayload) => {
    return fetchJSON<{ success: boolean; message: string }>(
      `/api/pdf/${pdfId}/edit-text`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
  },

  // Add text directly to page
  addText: async (pdfId: string, payload: import('@/types/pdf').TextAddPayload) => {
    return fetchJSON<{ success: boolean; message: string }>(
      `/api/pdf/${pdfId}/add-text`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
  },

  // Delete text from page
  deleteText: async (pdfId: string, payload: import('@/types/pdf').TextDeletePayload) => {
    return fetchJSON<{ success: boolean; message: string }>(
      `/api/pdf/${pdfId}/delete-text`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
  },

  // OCR
  detectScannedPages: async (pdfId: string) => {
    return fetchJSON<{ scanned_pages: { page: number; reason: string; image_count: number }[]; total_pages: number }>(
      `/api/pdf/${pdfId}/ocr-detect`
    );
  },

  performOCR: async (pdfId: string, page?: number) => {
    const url = page !== undefined
      ? `/api/pdf/${pdfId}/ocr?page=${page}`
      : `/api/pdf/${pdfId}/ocr`;
    return fetchJSON<{ pages: import('@/types/pdf').OCRResult[]; total_pages_processed: number }>(url, { method: 'POST' });
  },

  // Page operations
  getThumbnails: async (pdfId: string, size = 160) => {
    return fetchJSON<{ pages: import('@/types/pdf').PageThumbnail[]; page_count: number }>(
      `/api/pdf/${pdfId}/pages?size=${size}`
    );
  },

  rotatePages: async (pdfId: string, pages: number[], degrees: 90 | 180 | 270) => {
    return fetchJSON<{ success: boolean; rotated_pages: number[]; degrees: number }>(
      `/api/pdf/${pdfId}/rotate?degrees=${degrees}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pages) }
    );
  },

  deletePages: async (pdfId: string, pages: number[]) => {
    return fetchJSON<{ success: boolean; deleted: number; page_count: number }>(
      `/api/pdf/${pdfId}/delete-pages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pages) }
    );
  },

  reorderPages: async (pdfId: string, newOrder: number[]) => {
    return fetchJSON<{ success: boolean; new_order: number[] }>(
      `/api/pdf/${pdfId}/reorder`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newOrder) }
    );
  },

  insertBlankPage: async (pdfId: string, afterPage?: number) => {
    const url = afterPage !== undefined
      ? `/api/pdf/${pdfId}/insert-blank-page?after_page=${afterPage}`
      : `/api/pdf/${pdfId}/insert-blank-page`;
    return fetchJSON<{ success: boolean; page_count: number; inserted_at: number }>(url, { method: 'POST' });
  },

  // Annotations
  addAnnotation: async (pdfId: string, annotation: import('@/types/annotation').AnnotationPayload) => {
    return fetchJSON<{ id: string; annotation: any }>(
      `/api/pdf/${pdfId}/annotations`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(annotation) }
    );
  },

  getAnnotations: async (pdfId: string) => {
    return fetchJSON<{ annotations: Record<string, import('@/types/annotation').Annotation> }>(
      `/api/pdf/${pdfId}/annotations`
    );
  },

  updateAnnotation: async (pdfId: string, annotId: string, payload: Partial<import('@/types/annotation').Annotation>) => {
    return fetchJSON<{ id: string; annotation: any }>(
      `/api/pdf/${pdfId}/annotations/${annotId}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
  },

  deleteAnnotation: async (pdfId: string, annotId: string) => {
    return fetchJSON<{ success: boolean }>(
      `/api/pdf/${pdfId}/annotations/${annotId}`,
      { method: 'DELETE' }
    );
  },

  clearAnnotations: async (pdfId: string) => {
    return fetchJSON<{ success: boolean }>(
      `/api/pdf/${pdfId}/annotations`,
      { method: 'DELETE' }
    );
  },

  exportWithAnnotations: async (pdfId: string) => {
    const response = await fetch(`${API_BASE}/api/pdf/${pdfId}/export-annotations`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Export with annotations failed');
    return response.blob();
  },

  // Download
  downloadPDF: (pdfId: string, filename?: string) => {
    const param = filename ? `?filename=${encodeURIComponent(filename)}` : '';
    const downloadUrl = `${API_BASE}/api/pdf/${pdfId}/download${param}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  // Health check
  checkHealth: async () => {
    return fetchJSON<{ status: string; service?: string }>('/api/pdf/health');
  },
};
