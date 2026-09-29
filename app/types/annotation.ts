// Annotation types for DocuCraft

export enum AnnotationType {
  FREEHAND = "freehand",
  TEXT_BOX = "text_box",
  HIGHLIGHT = "highlight",
  STICKY_NOTE = "sticky_note",
  IMAGE = "image",
}

export interface Point {
  x: number;
  y: number;
}

export interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  page: number;
}

export interface FreehandAnnotation extends BaseAnnotation {
  type: AnnotationType.FREEHAND;
  points: Point[];
  strokes?: Point[][];
  stroke_color: [number, number, number];
  stroke_width: number;
  opacity: number;
}

export interface TextBoxAnnotation extends BaseAnnotation {
  type: AnnotationType.TEXT_BOX;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  font_size: number;
  font_name: string;
  text_color: [number, number, number];
  background_color: [number, number, number];
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: AnnotationType.HIGHLIGHT;
  x: number;
  y: number;
  width: number;
  height: number;
  color: [number, number, number];
}

export interface StickyNoteAnnotation extends BaseAnnotation {
  type: AnnotationType.STICKY_NOTE;
  x: number;
  y: number;
  text: string;
  icon: string;
  color: string;
}

export interface ImageAnnotation extends BaseAnnotation {
  type: AnnotationType.IMAGE;
  x: number;
  y: number;
  width: number;
  height: number;
  data_url: string;
}

export type Annotation =
  | FreehandAnnotation
  | TextBoxAnnotation
  | HighlightAnnotation
  | StickyNoteAnnotation
  | ImageAnnotation;

// API payload types (for sending to backend)
export interface FreehandPayload {
  type: AnnotationType.FREEHAND;
  page: number;
  points: Point[];
  strokes?: Point[][];
  stroke_color: [number, number, number];
  stroke_width?: number;
  opacity?: number;
}

export interface TextBoxPayload {
  type: AnnotationType.TEXT_BOX;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  font_size?: number;
  font_name?: string;
  text_color?: [number, number, number];
  background_color?: [number, number, number];
}

export interface HighlightPayload {
  type: AnnotationType.HIGHLIGHT;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: [number, number, number];
}

export interface StickyNotePayload {
  type: AnnotationType.STICKY_NOTE;
  page: number;
  x: number;
  y: number;
  text: string;
  icon?: string;
  color?: string;
}

export interface ImagePayload {
  type: AnnotationType.IMAGE;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  data_url: string;
}

export type AnnotationPayload =
  | FreehandPayload
  | TextBoxPayload
  | HighlightPayload
  | StickyNotePayload
  | ImagePayload;
