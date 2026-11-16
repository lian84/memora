import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { classifyProjectFile, type ChatAttachment, type ChatAttachmentContext } from '@memora/shared';

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ATTACHMENT_ID = /^[A-Za-z0-9_-]{8,80}$/;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

const MIME_TYPES: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  log: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export class ChatAttachmentError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ChatAttachmentError';
  }
}

function extensionOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? '';
}

function mimeTypeOf(filename: string): string {
  return MIME_TYPES[extensionOf(filename)] ?? 'application/octet-stream';
}

function kindOf(filename: string): ChatAttachment['kind'] {
  const kind = classifyProjectFile(filename);
  if (kind === 'markdown') return 'text';
  if (kind === 'image' || kind === 'html' || kind === 'pdf' || kind === 'word') return kind;
  return kind === 'text' ? 'text' : 'other';
}

function safeFilename(input: string): string {
  const raw = path.basename(input).normalize('NFKC').trim();
  if (!raw || raw.length > 180 || raw.includes('\0')) throw new ChatAttachmentError('invalid_attachment_name', 'Nome allegato non valido');
  const safe = raw.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '_');
  if (!safe || !extensionOf(safe)) throw new ChatAttachmentError('invalid_attachment_name', 'L’allegato deve avere un’estensione');
  if (!MIME_TYPES[extensionOf(safe)]) throw new ChatAttachmentError('unsupported_attachment_type', 'Tipo di allegato non supportato');
  return safe;
}

function capText(text: string): string {
  const normalized = text.replaceAll('\0', '').trim();
  return normalized.length > MAX_TEXT_CHARS
    ? `${normalized.slice(0, MAX_TEXT_CHARS)}\n\n[contenuto troncato a ${MAX_TEXT_CHARS} caratteri]`
    : normalized;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractWordText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export class ChatAttachmentStore {
  constructor(private readonly dataDir: string) {}

  private directory(sessionId: string): string {
    if (!SESSION_ID.test(sessionId)) throw new ChatAttachmentError('invalid_session_id', 'ID sessione non valido');
    return path.join(this.dataDir, 'chat-attachments', sessionId);
  }

  async save(sessionId: string, input: { filename: string; data: Buffer }): Promise<ChatAttachment> {
    if (input.data.byteLength === 0) throw new ChatAttachmentError('empty_attachment', 'Allegato vuoto');
    if (input.data.byteLength > MAX_ATTACHMENT_BYTES) throw new ChatAttachmentError('attachment_too_large', 'Allegato troppo grande', 413);
    const filename = safeFilename(input.filename);
    const id = crypto.randomUUID();
    const directory = this.directory(sessionId);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(directory, `${id}__${filename}`), input.data, { mode: 0o600, flag: 'wx' });
    return { id, filename, mimeType: mimeTypeOf(filename), size: input.data.byteLength, kind: kindOf(filename) };
  }

  async get(sessionId: string, id: string): Promise<ChatAttachment & { buffer: Buffer }> {
    if (!ATTACHMENT_ID.test(id)) throw new ChatAttachmentError('invalid_attachment_id', 'ID allegato non valido');
    const directory = this.directory(sessionId);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      throw new ChatAttachmentError('attachment_not_found', 'Allegato non trovato', 404);
    }
    const prefix = `${id}__`;
    const entry = entries.find(candidate => candidate.isFile() && candidate.name.startsWith(prefix));
    if (!entry) throw new ChatAttachmentError('attachment_not_found', 'Allegato non trovato', 404);
    const absolutePath = path.join(directory, entry.name);
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) {
      throw new ChatAttachmentError('attachment_forbidden', 'Allegato non valido', 403);
    }
    const buffer = await fs.readFile(absolutePath);
    const filename = entry.name.slice(prefix.length);
    return { id, filename, mimeType: mimeTypeOf(filename), size: buffer.byteLength, kind: kindOf(filename), buffer };
  }

  async remove(sessionId: string, id: string): Promise<void> {
    if (!ATTACHMENT_ID.test(id)) throw new ChatAttachmentError('invalid_attachment_id', 'ID allegato non valido');
    const directory = this.directory(sessionId);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const prefix = `${id}__`;
    const entry = entries.find(candidate => candidate.isFile() && candidate.name.startsWith(prefix));
    if (entry) await fs.unlink(path.join(directory, entry.name));
  }

  async removeSession(sessionId: string): Promise<void> {
    const directory = this.directory(sessionId);
    await fs.rm(directory, { recursive: true, force: true });
  }

  async loadMany(sessionId: string, ids: string[]): Promise<Array<ChatAttachment & { buffer: Buffer }>> {
    const unique = [...new Set(ids)];
    if (unique.length > 8) throw new ChatAttachmentError('too_many_attachments', 'Massimo 8 allegati per messaggio');
    return Promise.all(unique.map(id => this.get(sessionId, id)));
  }

  async toModelContext(attachment: ChatAttachment & { buffer: Buffer }): Promise<ChatAttachmentContext> {
    const base = { id: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size, kind: attachment.kind };
    if (attachment.kind === 'image') {
      return { ...base, imageData: attachment.buffer.toString('base64') };
    }
    try {
      if (attachment.kind === 'pdf') return { ...base, text: capText(await extractPdfText(attachment.buffer)) };
      if (attachment.kind === 'word') return { ...base, text: capText(await extractWordText(attachment.buffer)) };
      if (attachment.kind === 'text' || attachment.kind === 'html') return { ...base, text: capText(attachment.buffer.toString('utf8')) };
    } catch {
      return { ...base, text: '[contenuto non estraibile dall’allegato]' };
    }
    return { ...base, text: `[allegato ${attachment.filename}: anteprima non supportata nel contesto testuale]` };
  }
}
