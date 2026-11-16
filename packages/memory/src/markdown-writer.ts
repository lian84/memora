import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  deriveLegacyMemoryRecord,
  extractMemoryMetadata,
  formatMemoryMetadata,
  stripMemoryMetadataComment,
  type MemoryRecord,
} from './memory-metadata.js';

export const ALLOWED_MEMORY_ROOTS = ['memory', 'projects', 'journal'] as const;
export const SOURCE_MEMORY_ROOTS = ['memory', 'projects', 'journal', 'documents'] as const;

export interface MemoryTargetOptions {
  allowedRoots?: readonly string[];
  extensions?: readonly string[];
}

export interface ValidatedMemoryTarget {
  absolutePath: string;
  relativePath: string;
}

export interface MarkdownWriteResult {
  absolutePath: string;
  relativePath: string;
  changed: boolean;
  skippedDuplicate: boolean;
}

export class MemoryWriterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MemoryWriterError';
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Normalizza un path relativo e garantisce che resti nelle root Markdown ammesse. */
export async function validateMemoryTargetPath(
  dataDir: string,
  input: string,
  options: MemoryTargetOptions = {},
): Promise<ValidatedMemoryTarget> {
  const normalized = input.replaceAll('\\', '/').trim();
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) {
    throw new MemoryWriterError('invalid_target_path', 'La destinazione deve essere un path relativo');
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new MemoryWriterError('invalid_target_path', 'La destinazione contiene un path traversal');
  }
  const allowedRoots = options.allowedRoots ?? ALLOWED_MEMORY_ROOTS;
  if (!allowedRoots.includes(segments[0] ?? '')) {
    throw new MemoryWriterError('invalid_target_path', 'Destinazione non consentita');
  }
  const extension = path.extname(normalized).toLowerCase();
  const extensions = options.extensions ?? ['.md'];
  if (!extensions.includes(extension)) {
    throw new MemoryWriterError('invalid_target_path', `La destinazione deve avere estensione ${extensions.join(' o ')}`);
  }

  const dataRoot = path.resolve(dataDir);
  const absolutePath = path.resolve(dataRoot, ...segments);
  if (!isInside(dataRoot, absolutePath) || absolutePath === dataRoot) {
    throw new MemoryWriterError('invalid_target_path', 'La destinazione esce da MEMORA_DATA_DIR');
  }

  const dataRootReal = await fs.realpath(dataRoot);
  let current = dataRoot;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new MemoryWriterError('invalid_target_path', 'La destinazione attraversa un symlink o un file non valido');
      }
      const real = await fs.realpath(current);
      if (!isInside(dataRootReal, real)) {
        throw new MemoryWriterError('invalid_target_path', 'La destinazione esce da MEMORA_DATA_DIR');
      }
    } catch (error) {
      if (error instanceof MemoryWriterError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }

  try {
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new MemoryWriterError('invalid_target_path', 'La destinazione non può essere un symlink o una directory');
    }
    const fileReal = await fs.realpath(absolutePath);
    if (!isInside(dataRootReal, fileReal)) {
      throw new MemoryWriterError('invalid_target_path', 'Il file di destinazione esce da MEMORA_DATA_DIR');
    }
  } catch (error) {
    if (error instanceof MemoryWriterError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  return {
    absolutePath,
    relativePath: segments.join('/'),
  };
}

function documentTitle(relativePath: string): string {
  if (relativePath === 'memory/profile.md') return 'Profilo';
  if (relativePath === 'memory/preferences.md') return 'Preferenze';
  if (relativePath === 'memory/decisions.md') return 'Decisioni';
  if (relativePath.startsWith('projects/')) return 'Memoria progetto';
  if (relativePath.startsWith('journal/')) return 'Journal';
  return 'Memoria';
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sameBullet(line: string, text: string): boolean {
  const normalized = stripMemoryMetadataComment(line).replace(/^\s*[-*+]\s+/, '');
  return normalizeLine(normalized).toLocaleLowerCase('it-IT') === normalizeLine(text).toLocaleLowerCase('it-IT');
}

function annotateBullet(text: string, metadata?: MemoryRecord): string {
  return metadata ? `- ${text} ${formatMemoryMetadata(metadata)}` : `- ${text}`;
}

function addToHeadingSection(content: string, heading: string, text: string, metadata?: MemoryRecord): { content: string; changed: boolean } {
  const safeHeading = normalizeLine(heading.replaceAll('#', ' ')) || 'Note';
  const safeText = normalizeLine(text);
  const headingLine = `## ${safeHeading}`;
  const headingKey = headingLine.toLocaleLowerCase('it-IT');
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const headingIndex = lines.findIndex((line) => line.trim().toLocaleLowerCase('it-IT') === headingKey);

  if (headingIndex < 0) {
    const base = content.trimEnd();
    return {
      content: `${base}${base ? '\n\n' : ''}${headingLine}\n\n${annotateBullet(safeText, metadata)}\n`,
      changed: true,
    };
  }

  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index++) {
    if (/^#{1,2}\s+/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  const sectionLines = lines.slice(headingIndex + 1, sectionEnd);
  if (sectionLines.some((line) => sameBullet(line, safeText))) {
    return { content, changed: false };
  }

  while (sectionLines.length > 0 && sectionLines[sectionLines.length - 1]?.trim() === '') {
    sectionLines.pop();
  }

  const rebuilt = [...lines.slice(0, headingIndex + 1)];
  if (sectionLines.length === 0 || sectionLines[0]?.trim() !== '') rebuilt.push('');
  rebuilt.push(...sectionLines);

  const lastSectionLine = sectionLines[sectionLines.length - 1];
  if (lastSectionLine && !/^\s*[-*+]\s+/.test(lastSectionLine)) rebuilt.push('');
  rebuilt.push(annotateBullet(safeText, metadata), '');

  const after = lines.slice(sectionEnd);
  while (after.length > 0 && after[0]?.trim() === '') after.shift();
  if (after.length > 0) rebuilt.push(...after);

  return {
    content: `${rebuilt.join('\n').replace(/\n+$/, '')}\n`,
    changed: true,
  };
}

/** Scrittura atomica di un file già validato. */
export async function writeFileAtomically(
  absolutePath: string,
  content: string,
  mode = 0o600,
): Promise<void> {
  const directory = path.dirname(absolutePath);
  const tempPath = path.join(directory, `.${path.basename(absolutePath)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(tempPath, content, { mode, flag: 'wx', encoding: 'utf-8' });
    await fs.rename(tempPath, absolutePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

/** Find exact Markdown bullet lines outside fenced code blocks. */
export function matchingMemoryBulletLines(content: string, currentText: string): number[] {
  let fence: { char: string; length: number } | undefined;
  const matches: number[] = [];
  for (const [index, line] of content.split('\n').entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { char: marker[0]!, length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (!fence && /^\s*[-*+]\s+/.test(line) && stripMemoryMetadataComment(line).replace(/^\s*[-*+]\s+/, '').replace(/\r$/, '') === currentText) matches.push(index);
  }
  return matches;
}

/** Replace exactly one previously reviewed bullet; ambiguous or changed input fails closed. */
export async function replaceMemoryBullet(
  dataDir: string,
  targetPath: string,
  currentText: string,
  proposedText: string,
  metadata?: { previous?: MemoryRecord; next: MemoryRecord },
): Promise<MarkdownWriteResult> {
  const target = await validateMemoryTargetPath(dataDir, targetPath);
  const existing = await fs.readFile(target.absolutePath, 'utf-8');
  const lines = existing.split('\n');
  const matching = matchingMemoryBulletLines(existing, currentText);
  if (matching.length !== 1) throw new MemoryWriterError('memory_changed', 'La memoria originale è assente, cambiata o ambigua: revisionare nuovamente');
  const item = { index: matching[0]!, line: lines[matching[0]!]! };
  const prefix = item.line.match(/^(\s*[-*+]\s+)/)![1]!;
  const safeText = normalizeLine(proposedText);
  if (!safeText) throw new MemoryWriterError('invalid_candidate', 'Il testo proposto non può essere vuoto');
  if (!metadata) {
    const replacement = `${prefix}${safeText}${item.line.endsWith('\r') ? '\r' : ''}`;
    if (item.line === replacement) return { ...target, changed: false, skippedDuplicate: true };
    lines[item.index] = replacement;
    await writeFileAtomically(target.absolutePath, lines.join('\n'));
    return { ...target, changed: true, skippedDuplicate: false };
  }

  const lineEnding = item.line.endsWith('\r') ? '\r' : '';
  const existingRecord = extractMemoryMetadata(item.line)[0];
  const previous = metadata.previous ?? existingRecord
    ?? deriveLegacyMemoryRecord(target.relativePath, currentText, metadata.next.createdAt);
  const superseded: MemoryRecord = {
    ...previous,
    status: 'superseded',
    supersededBy: metadata.next.versionId,
    updatedAt: metadata.next.updatedAt,
  };
  const oldText = stripMemoryMetadataComment(item.line).replace(/^\s*[-*+]\s+/, '').replace(/\r$/, '');
  const supersededLine = `${prefix}${oldText} ${formatMemoryMetadata(superseded)}${lineEnding}`;
  const nextLine = `${prefix}${safeText} ${formatMemoryMetadata(metadata.next)}${lineEnding}`;
  if (lines[item.index] === supersededLine && lines[item.index + 1] === nextLine) {
    return { ...target, changed: false, skippedDuplicate: true };
  }
  lines.splice(item.index, 1, supersededLine, nextLine);
  await writeFileAtomically(target.absolutePath, lines.join('\n'));
  return { ...target, changed: true, skippedDuplicate: false };
}

/** Scrive o aggiorna un file Markdown con scrittura atomica. */
export async function writeMemoryMarkdown(
  dataDir: string,
  targetPath: string,
  heading: string,
  text: string,
  metadata?: MemoryRecord,
): Promise<MarkdownWriteResult> {
  const target = await validateMemoryTargetPath(dataDir, targetPath);

  let existing = '';
  try {
    existing = await fs.readFile(target.absolutePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const base = existing || `# ${documentTitle(target.relativePath)}\n`;
  const updated = addToHeadingSection(base, heading, text, metadata);
  if (!updated.changed) {
    return {
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      changed: false,
      skippedDuplicate: true,
    };
  }

  const directory = path.dirname(target.absolutePath);
  await fs.mkdir(directory, { recursive: true });
  const dataRootReal = await fs.realpath(path.resolve(dataDir));
  const directoryReal = await fs.realpath(directory);
  if (!isInside(dataRootReal, directoryReal)) {
    throw new MemoryWriterError('invalid_target_path', 'La destinazione esce da MEMORA_DATA_DIR');
  }
  await writeFileAtomically(target.absolutePath, updated.content, 0o600);

  return {
    absolutePath: target.absolutePath,
    relativePath: target.relativePath,
    changed: true,
    skippedDuplicate: false,
  };
}
