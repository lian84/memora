import type { ProviderId, ReasoningLevel } from './providers.js';

export type ProjectStatus = 'active' | 'archived';

export const PROJECT_ICON_NAMES = [
  'folder',
  'briefcase',
  'home',
  'book',
  'rocket',
  'code',
  'flask',
  'palette',
  'globe',
  'heart',
  'users',
  'star',
  'music',
  'camera',
  'gamepad',
  'leaf',
  'lightbulb',
  'calculator',
  'terminal',
  'megaphone',
] as const;

export type ProjectIcon = typeof PROJECT_ICON_NAMES[number];

export function isProjectIcon(value: unknown): value is ProjectIcon {
  return typeof value === 'string' && (PROJECT_ICON_NAMES as readonly string[]).includes(value);
}

export interface ProjectSection {
  id: string;
  name: string;
  icon: ProjectIcon;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectDefaults {
  provider?: ProviderId;
  model?: string;
  reasoningLevel?: ReasoningLevel;
}

export interface ProjectRetrievalConfig {
  includeGlobal: boolean;
  includeProjectMemory: boolean;
  includeProjectSources: boolean;
}

export interface ProjectSourcesConfig {
  include: string[];
  exclude: string[];
}

export interface ProjectConfig {
  version: 1;
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  prompt: string;
  defaults: ProjectDefaults;
  /** Sezione della sidebar; assente = Senza sezione. */
  sectionId?: string;
  icon?: ProjectIcon;
  retrieval: ProjectRetrievalConfig;
  sources: ProjectSourcesConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectRecord extends ProjectConfig {
  /** file = project.json presente; legacy = solo directory/Markdown. */
  source: 'file' | 'legacy';
  warning?: string;
}

export type ProjectFileKind = 'markdown' | 'text' | 'html' | 'pdf' | 'word' | 'xlsx' | 'pptx' | 'image' | 'other';

export interface ProjectFileInfo {
  path: string;
  name: string;
  directory: string;
  extension: string;
  kind: ProjectFileKind;
  size: number;
  modifiedAt: number;
}

export interface ProjectFileList {
  files: ProjectFileInfo[];
  directories: string[];
}

export interface ProjectFilePreview {
  kind: ProjectFileKind;
  html?: string;
  spreadsheet?: SpreadsheetPreview;
}

export type ChatAttachmentKind = 'image' | 'text' | 'html' | 'pdf' | 'word' | 'other';

export interface ChatAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
  /** Percorso nel progetto quando l’allegato è archiviato tra i file del progetto. */
  projectPath?: string;
}

/** Contenuto transitorio passato al modello; non viene restituito alla UI. */
export interface ChatAttachmentContext extends ChatAttachment {
  text?: string;
  imageData?: string;
}

export function classifyProjectFile(filename: string): ProjectFileKind {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (['txt', 'csv', 'json', 'log'].includes(extension)) return 'text';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'word';
  if (extension === 'xlsx' || extension === 'xls') return 'xlsx';
  if (extension === 'pptx' || extension === 'ppt') return 'pptx';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension)) return 'image';
  return 'other';
}

export interface SessionContextSettings {
  includeGlobalMemory: boolean;
  includeProjectMemory: boolean;
  includeProjectSources: boolean;
}

export const DEFAULT_SESSION_CONTEXT: SessionContextSettings = {
  includeGlobalMemory: true,
  includeProjectMemory: true,
  includeProjectSources: true,
};

export type ArtifactKind = 'markdown' | 'html' | 'svg' | 'text' | 'json' | 'csv' | 'code' | 'pdf' | 'docx' | 'xlsx' | 'pptx';

export function isOfficeArtifactKind(kind: ArtifactKind): kind is 'docx' | 'xlsx' | 'pptx' {
  return kind === 'docx' || kind === 'xlsx' || kind === 'pptx';
}

export interface ChatArtifact {
  id: string;
  sessionId: string;
  name: string;
  kind: ArtifactKind;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  version: number;
  /** Messaggio utente/assistente che ha originato l'artefatto. */
  sourceMessageId?: string;
  /** Timestamp del messaggio sorgente, se disponibile. */
  sourceTimestamp?: number;
  /** Turno logico sorgente, per future associazioni. */
  sourceTurnId?: string;
}

export interface SpreadsheetCell {
  value: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  background?: string;
  color?: string;
  numberFormat?: string;
}

export interface SpreadsheetSheet {
  name: string;
  rows: SpreadsheetCell[][];
  columns?: number[];
  merges?: string[];
}

export interface SpreadsheetPreview {
  kind: 'xlsx';
  sheets: SpreadsheetSheet[];
  truncated?: boolean;
}

export interface ArtifactVersion {
  artifactId: string;
  version: number;
  name: string;
  kind: ArtifactKind;
  mimeType: string;
  size: number;
  updatedAt: number;
  current: boolean;
}
