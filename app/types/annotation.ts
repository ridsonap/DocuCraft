// Annotation types for DocuCraft

export enum AnnotationType {
  FREEHAND = "freehand",
  TEXT_BOX = "text_box",
  HIGHLIGHT = "highlight",
  STICKY_NOTE = "sticky_note",
  STAMP = "stamp",
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

export interface StampAnnotation extends BaseAnnotation {
  type: AnnotationType.STAMP;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: [number, number, number];
}

export type Annotation =
  | FreehandAnnotation
  | TextBoxAnnotation
  | HighlightAnnotation
  | StickyNoteAnnotation
  | StampAnnotation;

// API payload types (for sending to backend)
export interface FreehandPayload {
  type: AnnotationType.FREEHAND;
  page: number;
  points: Point[];
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

export interface StampPayload {
  type: AnnotationType.STAMP;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  color?: [number, number, number];
}

export type AnnotationPayload =
  | FreehandPayload
  | TextBoxPayload
  | HighlightPayload
  | StickyNotePayload
  | StampPayload;
