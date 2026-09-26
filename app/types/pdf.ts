// Types for DocuCraft PDF Editor

export interface TextBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_name: string;
  font_size: number;
  color: [number, number, number]; // RGB 0-255
  page: number;
}

export interface PageThumbnail {
  page: number;
  thumbnail: string; // base64 data URL
  width: number;
  height: number;
}

export interface PDFDocument {
  id: string;
  filename: string;
  page_count: number;
  size?: number;
}

export interface OCRBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OCRResult {
  page: number;
  blocks: OCRBlock[];
  full_text: string;
  word_count: number;
}

export interface TextEditPayload {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  old_text: string;
  new_text: string;
  font_size?: number;
  font_name?: string;
  color?: [number, number, number];
}

export interface TextAddPayload {
  page: number;
  x: number;
  y: number;
  text: string;
  font_size?: number;
  font_name?: string;
  color?: [number, number, number];
}

export interface PDFPageRenderProps {
  pdfId: string;
  pageNumber: number;
  scale: number;
}
