import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactKind, ArtifactVersion, ChatArtifact } from '@memora/shared';

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{8,80}$/;
const MAX_TEXT_ARTIFACT_BYTES = 200_000;
const MAX_BINARY_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_OFFICE_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

const EXTENSIONS: Record<ArtifactKind, string> = {
  markdown: '.md',
  html: '.html',
  svg: '.svg',
  text: '.txt',
  json: '.json',
  csv: '.csv',
  code: '.txt',
  pdf: '.pdf',
  docx: '.docx',
  xlsx: '.xlsx',
  pptx: '.pptx',
};

const MIME_TYPES: Record<ArtifactKind, string> = {
  markdown: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
  text: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  code: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const KIND_BY_EXTENSION: Record<string, ArtifactKind> = {
  md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', svg: 'svg',
  txt: 'text', json: 'json', csv: 'csv', js: 'code', ts: 'code', py: 'code',
  sql: 'code', sh: 'code', css: 'code', pdf: 'pdf',
  docx: 'docx', xlsx: 'xlsx', pptx: 'pptx',
};

export class ArtifactError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ArtifactError';
  }
}

function safeName(input: string, kind: ArtifactKind): string {
  const base = path.basename(input.normalize('NFKC')).trim();
  if (!base || base.length > 160 || base.includes('\0')) throw new ArtifactError('invalid_artifact_name', 'Nome artefatto non valido');
  let safe = base.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '_');
  if (!path.extname(safe)) safe += EXTENSIONS[kind];
  return safe;
}

function kindFromFilename(filename: string): ArtifactKind {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return KIND_BY_EXTENSION[extension] ?? 'text';
}

export interface ArtifactSource {
  messageId?: string;
  turnId?: string;
  timestamp?: number;
}

export class ArtifactStore {
  constructor(private readonly dataDir: string) {}

  private directory(sessionId: string): string {
    if (!SESSION_ID.test(sessionId)) throw new ArtifactError('invalid_session_id', 'ID sessione non valido');
    return path.join(this.dataDir, 'artifacts', sessionId);
  }

  private async toInfo(sessionId: string, filename: string, size: number, timestamp: number): Promise<ChatArtifact> {
    const id = filename.split('__')[0] ?? filename;
    const name = filename.includes('__') ? filename.slice(filename.indexOf('__') + 2) : filename;
    const kind = kindFromFilename(name);
    let version = 1;
    try {
      const archived = await fs.readdir(path.join(this.directory(sessionId), '.versions', id));
      version += archived.filter(item => item.startsWith('v')).length;
    } catch {
      // Prima versione: nessuna directory storico.
    }
    const source = await this.readSource(sessionId, id);
    return {
      id, sessionId, name, kind, mimeType: MIME_TYPES[kind], size, createdAt: timestamp, updatedAt: timestamp, version,
      ...(source.messageId ? { sourceMessageId: source.messageId } : {}),
      ...(source.turnId ? { sourceTurnId: source.turnId } : {}),
      ...(source.timestamp !== undefined ? { sourceTimestamp: source.timestamp } : {}),
    };
  }

  async save(sessionId: string, input: { name: string; kind: ArtifactKind; content: string | Buffer; source?: ArtifactSource }): Promise<ChatArtifact> {
    if (!Object.prototype.hasOwnProperty.call(EXTENSIONS, input.kind)) throw new ArtifactError('invalid_artifact_kind', 'Tipo artefatto non valido');
    const buffer = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) throw new ArtifactError('empty_artifact', 'Artefatto vuoto');
    const maxBytes = input.kind === 'pdf'
      ? MAX_BINARY_ARTIFACT_BYTES
      : input.kind === 'docx' || input.kind === 'xlsx' || input.kind === 'pptx'
        ? MAX_OFFICE_ARTIFACT_BYTES
        : MAX_TEXT_ARTIFACT_BYTES;
    if (buffer.byteLength > maxBytes) throw new ArtifactError('artifact_too_large', 'Artefatto troppo grande', 413);
    const name = safeName(input.name, input.kind);
    const directory = this.directory(sessionId);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((): import('node:fs').Dirent[] => []);
    const existing = entries.find(entry => entry.isFile() && entry.name.endsWith(`__${name}`));
    if (existing) {
      const absolutePath = path.join(directory, existing.name);
      const existingBuffer = await fs.readFile(absolutePath);
      if (crypto.createHash('sha256').update(existingBuffer).digest('hex') === crypto.createHash('sha256').update(buffer).digest('hex')) {
        if (input.source) await this.writeSourceIfMissing(sessionId, existing.name.split('__')[0]!, input.source);
        return this.toInfo(sessionId, existing.name, existingBuffer.byteLength, Date.now());
      }
      const id = existing.name.split('__')[0]!;
      const versionsDir = path.join(directory, '.versions', id);
      await fs.mkdir(versionsDir, { recursive: true, mode: 0o700 });
      const archived = await fs.readdir(versionsDir).catch((): string[] => []);
      const nextVersion = archived.filter(item => item.startsWith('v')).length + 1;
      await fs.copyFile(absolutePath, path.join(versionsDir, `v${nextVersion}__${name}`));
      const temporary = `${absolutePath}.tmp-${crypto.randomUUID()}`;
      await fs.writeFile(temporary, buffer, { mode: 0o600 });
      await fs.rename(temporary, absolutePath);
      await fs.rm(this.previewPath(sessionId, id), { force: true });
      if (input.source) await this.writeSourceIfMissing(sessionId, id, input.source);
      const stat = await fs.stat(absolutePath);
      return this.toInfo(sessionId, existing.name, stat.size, stat.birthtimeMs || stat.mtimeMs);
    }
    const id = crypto.randomUUID();
    const absolutePath = path.join(directory, `${id}__${name}`);
    await fs.writeFile(absolutePath, buffer, { mode: 0o600, flag: 'wx' });
    if (input.source) await this.writeSource(sessionId, id, input.source);
    const stat = await fs.stat(absolutePath);
    return this.toInfo(sessionId, path.basename(absolutePath), stat.size, stat.birthtimeMs || stat.mtimeMs);
  }

  async list(sessionId: string): Promise<ChatArtifact[]> {
    const directory = this.directory(sessionId);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const result: ChatArtifact[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      try {
        const stat = await fs.stat(path.join(directory, entry.name));
        result.push(await this.toInfo(sessionId, entry.name, stat.size, stat.birthtimeMs || stat.mtimeMs));
      } catch {
        // Un artefatto illeggibile non blocca gli altri.
      }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(sessionId: string, artifactId: string): Promise<ChatArtifact & { buffer: Buffer }> {
    if (!ARTIFACT_ID.test(artifactId)) throw new ArtifactError('invalid_artifact_id', 'ID artefatto non valido');
    const directory = this.directory(sessionId);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { throw new ArtifactError('artifact_not_found', 'Artefatto non trovato', 404); }
    const entry = entries.find(candidate => candidate.isFile() && candidate.name.startsWith(`${artifactId}__`));
    if (!entry) throw new ArtifactError('artifact_not_found', 'Artefatto non trovato', 404);
    const absolutePath = path.join(directory, entry.name);
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ArtifactError('artifact_forbidden', 'Artefatto non valido', 403);
    const buffer = await fs.readFile(absolutePath);
    return { ...await this.toInfo(sessionId, entry.name, stat.size, stat.birthtimeMs || stat.mtimeMs), buffer };
  }

  async listVersions(sessionId: string, artifactId: string): Promise<ArtifactVersion[]> {
    const current = await this.get(sessionId, artifactId);
    const versions: ArtifactVersion[] = [];
    const versionsDir = path.join(this.directory(sessionId), '.versions', artifactId);
    try {
      const entries = await fs.readdir(versionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = entry.name.match(/^v(\d+)__(.+)$/);
        if (!match) continue;
        const stat = await fs.stat(path.join(versionsDir, entry.name));
        const kind = kindFromFilename(match[2]!);
        versions.push({
          artifactId, version: Number(match[1]), name: match[2]!, kind,
          mimeType: MIME_TYPES[kind], size: stat.size,
          updatedAt: stat.mtimeMs, current: false,
        });
      }
    } catch {
      // Nessuna versione archiviata.
    }
    versions.push({
      artifactId: current.id, version: current.version, name: current.name,
      kind: current.kind, mimeType: current.mimeType, size: current.size,
      updatedAt: current.updatedAt, current: true,
    });
    return versions.sort((a, b) => a.version - b.version);
  }

  async getVersion(sessionId: string, artifactId: string, version: number): Promise<ArtifactVersion & { buffer: Buffer }> {
    if (!Number.isInteger(version) || version < 1) throw new ArtifactError('invalid_artifact_version', 'Versione artefatto non valida');
    const current = await this.get(sessionId, artifactId);
    if (version === current.version) {
      return {
        artifactId: current.id, version: current.version, name: current.name,
        kind: current.kind, mimeType: current.mimeType, size: current.size,
        updatedAt: current.updatedAt, current: true, buffer: current.buffer,
      };
    }
    const versionsDir = path.join(this.directory(sessionId), '.versions', artifactId);
    let entries;
    try { entries = await fs.readdir(versionsDir, { withFileTypes: true }); }
    catch { throw new ArtifactError('artifact_version_not_found', 'Versione artefatto non trovata', 404); }
    const entry = entries.find(candidate => candidate.isFile() && candidate.name.startsWith(`v${version}__`));
    if (!entry) throw new ArtifactError('artifact_version_not_found', 'Versione artefatto non trovata', 404);
    const absolutePath = path.join(versionsDir, entry.name);
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ArtifactError('artifact_version_forbidden', 'Versione artefatto non valida', 403);
    const name = entry.name.slice(`v${version}__`.length);
    const kind = kindFromFilename(name);
    return {
      artifactId, version, name, kind, mimeType: MIME_TYPES[kind], size: stat.size,
      updatedAt: stat.mtimeMs, current: false, buffer: await fs.readFile(absolutePath),
    };
  }

  /** Associa gli artefatti creati durante un turno al messaggio sorgente. */
  async assignSource(sessionId: string, input: { messageId?: string; turnId?: string; timestamp?: number; since: number }): Promise<void> {
    if (!input.messageId && !input.turnId) return;
    let entries;
    try { entries = await fs.readdir(this.directory(sessionId), { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const id = entry.name.split('__')[0];
      if (!id) continue;
      const absolutePath = path.join(this.directory(sessionId), entry.name);
      let stat;
      try { stat = await fs.stat(absolutePath); } catch { continue; }
      const createdAt = stat.birthtimeMs || stat.mtimeMs;
      if (createdAt < input.since && stat.mtimeMs < input.since) continue;
      const existing = await this.readSource(sessionId, id);
      if (existing.messageId || existing.turnId) continue;
      await this.writeSource(sessionId, id, { messageId: input.messageId, turnId: input.turnId, timestamp: input.timestamp });
    }
  }

  private sourcePath(sessionId: string, artifactId: string): string {
    if (!ARTIFACT_ID.test(artifactId)) throw new ArtifactError('invalid_artifact_id', 'ID artefatto non valido');
    return path.join(this.directory(sessionId), '.meta', `${artifactId}.json`);
  }

  private async readSource(sessionId: string, artifactId: string): Promise<ArtifactSource> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.sourcePath(sessionId, artifactId), 'utf8')) as Partial<ArtifactSource>;
      return {
        ...(typeof parsed.messageId === 'string' && parsed.messageId.length <= 200 ? { messageId: parsed.messageId } : {}),
        ...(typeof parsed.turnId === 'string' && parsed.turnId.length <= 200 ? { turnId: parsed.turnId } : {}),
        ...(typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp) ? { timestamp: parsed.timestamp } : {}),
      };
    } catch {
      return {};
    }
  }

  private async writeSourceIfMissing(sessionId: string, artifactId: string, source: ArtifactSource): Promise<void> {
    const existing = await this.readSource(sessionId, artifactId);
    if (existing.messageId || existing.turnId) return;
    await this.writeSource(sessionId, artifactId, source);
  }

  private async writeSource(sessionId: string, artifactId: string, source: ArtifactSource): Promise<void> {
    const target = this.sourcePath(sessionId, artifactId);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp-${crypto.randomUUID()}`;
    await fs.writeFile(temporary, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, target);
  }

  private previewPath(sessionId: string, artifactId: string): string {
    if (!ARTIFACT_ID.test(artifactId)) throw new ArtifactError('invalid_artifact_id', 'ID artefatto non valido');
    return path.join(this.directory(sessionId), '.previews', `${artifactId}.html`);
  }

  /** Salva la preview HTML di un artefatto binario (es. PPTX generato). */
  async savePreview(sessionId: string, artifactId: string, html: string): Promise<void> {
    if (typeof html !== 'string') throw new ArtifactError('invalid_artifact_preview', 'Preview artefatto non valida');
    const buffer = Buffer.from(html, 'utf8');
    if (buffer.byteLength === 0) throw new ArtifactError('empty_artifact_preview', 'Preview artefatto vuota');
    if (buffer.byteLength > MAX_PREVIEW_BYTES) throw new ArtifactError('artifact_preview_too_large', 'Preview artefatto troppo grande', 413);
    const target = this.previewPath(sessionId, artifactId);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp-${crypto.randomUUID()}`;
    await fs.writeFile(temporary, buffer, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  }

  async getPreview(sessionId: string, artifactId: string): Promise<string | null> {
    const target = this.previewPath(sessionId, artifactId);
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_PREVIEW_BYTES) throw new ArtifactError('artifact_preview_forbidden', 'Preview artefatto non valida', 403);
      return await fs.readFile(target, 'utf8');
    } catch (error) {
      if (error instanceof ArtifactError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(sessionId: string, artifactId: string): Promise<void> {
    if (!ARTIFACT_ID.test(artifactId)) throw new ArtifactError('invalid_artifact_id', 'ID artefatto non valido');
    const directory = this.directory(sessionId);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { throw new ArtifactError('artifact_not_found', 'Artefatto non trovato', 404); }
    const entry = entries.find(candidate => candidate.isFile() && candidate.name.startsWith(`${artifactId}__`));
    if (!entry) throw new ArtifactError('artifact_not_found', 'Artefatto non trovato', 404);
    const absolutePath = path.join(directory, entry.name);
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ArtifactError('artifact_forbidden', 'Artefatto non valido', 403);
    await fs.unlink(absolutePath);
    await fs.rm(path.join(directory, '.versions', artifactId), { recursive: true, force: true });
    await fs.rm(this.previewPath(sessionId, artifactId), { force: true });
    await fs.rm(this.sourcePath(sessionId, artifactId), { force: true });
  }

  async removeSession(sessionId: string): Promise<void> {
    await fs.rm(this.directory(sessionId), { recursive: true, force: true });
  }
}
