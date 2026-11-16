import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { classifyProjectFile, type ProjectFileInfo, type ProjectFileList, type ProjectFilePreview } from '@memora/shared';
import { readXlsxPreview } from '@memora/agent';
import { renderDocxPreviewHtml } from './docx-preview.js';
import type { ProjectStore } from './projects.js';

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_FILES = 500;
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export class ProjectFileError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

export function projectRoot(dataDir: string, projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw new ProjectFileError('invalid_project_id', 'ID progetto non valido');
  return path.join(dataDir, 'projects', projectId);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelativePath(input: string): string {
  const normalized = input.replaceAll('\\', '/').trim();
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new ProjectFileError('invalid_project_file_path', 'Percorso file non valido');
  }
  return normalized;
}

/** Risolve un file dentro un progetto senza seguire symlink. */
export async function resolveProjectFilePath(dataDir: string, projectId: string, input: string): Promise<{ absolutePath: string; relativePath: string; stat: Awaited<ReturnType<typeof fs.lstat>> }> {
  const root = projectRoot(dataDir, projectId);
  const relativePath = normalizeRelativePath(input);
  const segments = relativePath.split('/');
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ProjectFileError('project_file_forbidden', 'Il percorso attraversa un symlink o un file non valido', 403);
    } catch (error) {
      if (error instanceof ProjectFileError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ProjectFileError('project_file_not_found', 'File non trovato', 404);
      throw error;
    }
  }
  const absolutePath = path.resolve(root, ...segments);
  if (!isInside(root, absolutePath)) throw new ProjectFileError('project_file_forbidden', 'Il file esce dal progetto', 403);
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    throw new ProjectFileError('project_file_not_found', 'File non trovato', 404);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new ProjectFileError('project_file_forbidden', 'Il file non è valido', 403);
  if (stat.size > MAX_FILE_BYTES) throw new ProjectFileError('project_file_too_large', 'File troppo grande per l’anteprima', 413);
  return { absolutePath, relativePath, stat };
}

async function listDirectory(root: string, current: string, depth: number, files: ProjectFileInfo[], directories: string[]): Promise<void> {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  for (const entry of entries) {
    if (files.length >= MAX_FILES || entry.name.startsWith('.')) continue;
    const absolutePath = path.join(current, entry.name);
    const relative = path.relative(root, absolutePath).replaceAll(path.sep, '/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      directories.push(relative);
      await listDirectory(root, absolutePath, depth + 1, files, directories);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = await fs.lstat(absolutePath);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const extension = path.extname(entry.name).toLowerCase().slice(1);
      files.push({
        path: relative,
        name: entry.name,
        directory: path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative),
        extension,
        kind: classifyProjectFile(entry.name),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    } catch {
      // Un file illeggibile non blocca il resto della cartella.
    }
  }
}

export async function listProjectFiles(dataDir: string, projectId: string): Promise<ProjectFileList> {
  const root = projectRoot(dataDir, projectId);
  const files: ProjectFileInfo[] = [];
  const directories: string[] = [];
  await listDirectory(root, root, 0, files, directories);
  return { files, directories };
}

function safeProjectFilename(input: string): string {
  const base = path.basename(input.normalize('NFKC')).trim();
  if (!base || base.length > 160 || base.includes('\0')) throw new ProjectFileError('invalid_project_file_name', 'Nome file non valido');
  const safe = base.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '_');
  if (!safe || !path.extname(safe)) throw new ProjectFileError('invalid_project_file_name', 'Il file deve avere un’estensione');
  if (!MIME_TYPES[path.extname(safe).slice(1).toLowerCase()]) throw new ProjectFileError('unsupported_project_file_type', 'Tipo di file non supportato');
  return safe;
}

/** Archivia un allegato nella cartella files/ del progetto, senza indicizzarlo. */
export async function importProjectFile(dataDir: string, projectId: string, filename: string, buffer: Buffer): Promise<ProjectFileInfo> {
  if (buffer.byteLength === 0) throw new ProjectFileError('empty_project_file', 'File vuoto');
  if (buffer.byteLength > MAX_FILE_BYTES) throw new ProjectFileError('project_file_too_large', 'File troppo grande', 413);
  const root = projectRoot(dataDir, projectId);
  const filesDir = path.join(root, 'files');
  await fs.mkdir(filesDir, { recursive: true, mode: 0o700 });
  const safe = safeProjectFilename(filename);
  const extension = path.extname(safe);
  const stem = safe.slice(0, -extension.length) || 'file';
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? safe : `${stem}-${attempt}${extension}`;
    const absolutePath = path.join(filesDir, candidate);
    try {
      const existing = await fs.readFile(absolutePath);
      if (crypto.createHash('sha256').update(existing).digest('hex') === hash) {
        const stat = await fs.stat(absolutePath);
        return { path: `files/${candidate}`, name: candidate, directory: 'files', extension: extension.slice(1).toLowerCase(), kind: classifyProjectFile(candidate), size: stat.size, modifiedAt: stat.mtimeMs };
      }
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.writeFile(absolutePath, buffer, { mode: 0o600, flag: 'wx' });
    const stat = await fs.stat(absolutePath);
    return { path: `files/${candidate}`, name: candidate, directory: 'files', extension: extension.slice(1).toLowerCase(), kind: classifyProjectFile(candidate), size: stat.size, modifiedAt: stat.mtimeMs };
  }
  throw new ProjectFileError('project_file_name_exhausted', 'Impossibile scegliere un nome file');
}

export function projectFileMimeType(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

export async function readProjectFile(dataDir: string, projectId: string, relativePath: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const { absolutePath, relativePath: normalized } = await resolveProjectFilePath(dataDir, projectId, relativePath);
  const buffer = await fs.readFile(absolutePath);
  return { buffer, mimeType: projectFileMimeType(normalized), filename: path.basename(normalized) };
}

export async function previewProjectFile(dataDir: string, projectId: string, relativePath: string): Promise<ProjectFilePreview> {
  const { absolutePath, relativePath: normalized } = await resolveProjectFilePath(dataDir, projectId, relativePath);
  const kind = classifyProjectFile(normalized);
  if (kind === 'pptx') {
    throw new ProjectFileError('preview_not_supported', 'I PPTX caricati non hanno anteprima: puoi scaricare il file', 415);
  }
  const buffer = await fs.readFile(absolutePath);
  if (kind === 'word') {
    return { kind: 'word', html: await renderDocxPreviewHtml(buffer) };
  }
  if (kind === 'xlsx') {
    try {
      return { kind: 'xlsx', spreadsheet: await readXlsxPreview(buffer) };
    } catch {
      throw new ProjectFileError('invalid_xlsx_preview', 'Il foglio Excel non può essere letto', 422);
    }
  }
  throw new ProjectFileError('unsupported_preview', 'Anteprima non supportata per questo tipo di file');
}

function sendFileError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProjectFileError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  return reply.status(500).send({ error: 'project_file_failed' });
}

interface ProjectFileDependencies {
  dataDir: string;
  projects: ProjectStore;
}

export function registerProjectFileRoutes(app: FastifyInstance, deps: ProjectFileDependencies): void {
  app.get<{ Params: { id: string } }>('/api/projects/:id/files', async (request, reply) => {
    try {
      if (!(await deps.projects.get(request.params.id))) return reply.status(404).send({ error: 'project_not_found' });
      const result = await listProjectFiles(deps.dataDir, request.params.id);
      return reply.send(result);
    } catch (error) {
      return sendFileError(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/projects/:id/files/content', async (request, reply) => {
    try {
      if (!(await deps.projects.get(request.params.id))) return reply.status(404).send({ error: 'project_not_found' });
      if (!request.query.path) return reply.status(400).send({ error: 'missing_project_file_path' });
      const file = await readProjectFile(deps.dataDir, request.params.id, request.query.path);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, max-age=60');
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
      if (file.mimeType.startsWith('text/html') || file.mimeType === 'image/svg+xml') {
        reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;");
      }
      return reply.type(file.mimeType).send(file.buffer);
    } catch (error) {
      return sendFileError(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/projects/:id/files/preview', async (request, reply) => {
    try {
      if (!(await deps.projects.get(request.params.id))) return reply.status(404).send({ error: 'project_not_found' });
      if (!request.query.path) return reply.status(400).send({ error: 'missing_project_file_path' });
      const preview = await previewProjectFile(deps.dataDir, request.params.id, request.query.path);
      return reply.send(preview);
    } catch (error) {
      return sendFileError(reply, error);
    }
  });
}
