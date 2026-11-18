import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { isProjectIcon, type ProjectIcon, type ProjectSection } from '@memora/shared';
import type { ProjectStore } from './projects.js';

const SECTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class ProjectSectionError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ProjectSectionError';
  }
}

interface SectionFile {
  version: 1;
  sections: ProjectSection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new ProjectSectionError('invalid_section_name', 'Nome sezione non valido');
  const name = value.trim();
  if (!name || name.length > 80 || name.includes('\0')) throw new ProjectSectionError('invalid_section_name', 'Nome sezione non valido');
  return name;
}

function cleanIcon(value: unknown, fallback: ProjectIcon = 'folder'): ProjectIcon {
  if (value === undefined) return fallback;
  if (!isProjectIcon(value)) throw new ProjectSectionError('invalid_section_icon', 'Icona sezione non valida');
  return value;
}

function validateSection(value: unknown): ProjectSection {
  if (!isRecord(value)) throw new ProjectSectionError('invalid_section', 'Sezione non valida');
  if (typeof value.id !== 'string' || !SECTION_ID.test(value.id)) throw new ProjectSectionError('invalid_section_id', 'ID sezione non valido');
  const name = cleanName(value.name);
  const icon = cleanIcon(value.icon);
  if (typeof value.order !== 'number' || !Number.isFinite(value.order)) throw new ProjectSectionError('invalid_section_order', 'Ordine sezione non valido');
  if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') throw new ProjectSectionError('invalid_section', 'Sezione non valida');
  return { id: value.id, name, icon, order: value.order, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

/** Sezioni della sidebar: configurazione utente, non contenuto dei progetti. */
export class ProjectSectionStore {
  private readonly filePath: string;
  private readonly warn: (message: string) => void;

  constructor(dataDir: string, warn: (message: string) => void = () => {}) {
    this.filePath = path.join(dataDir, 'config', 'project-sections.json');
    this.warn = warn;
  }

  async list(): Promise<ProjectSection[]> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.sections)) throw new Error('invalid file');
      const sections = parsed.sections.map(validateSection);
      return sections.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'it'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.warn(`project-sections.json ignored: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async get(id: string): Promise<ProjectSection | null> {
    if (!SECTION_ID.test(id)) return null;
    return (await this.list()).find(section => section.id === id) ?? null;
  }

  async create(input: unknown): Promise<ProjectSection> {
    if (!isRecord(input)) throw new ProjectSectionError('invalid_section', 'Dati sezione non validi');
    const name = cleanName(input.name);
    const sections = await this.list();
    if (sections.some(section => section.name.toLocaleLowerCase('it') === name.toLocaleLowerCase('it'))) {
      throw new ProjectSectionError('section_already_exists', 'Esiste già una sezione con questo nome', 409);
    }
    const requestedId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : slugify(name);
    const id = requestedId || `sezione-${Date.now().toString(36)}`;
    if (!SECTION_ID.test(id)) throw new ProjectSectionError('invalid_section_id', 'ID sezione non valido');
    if (sections.some(section => section.id === id)) throw new ProjectSectionError('section_already_exists', 'ID sezione già esistente', 409);
    const now = Date.now();
    const next: ProjectSection = {
      id,
      name,
      icon: cleanIcon(input.icon),
      order: sections.reduce((max, section) => Math.max(max, section.order), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.write([...sections, next]);
    return next;
  }

  async update(id: string, patch: unknown): Promise<ProjectSection> {
    if (!SECTION_ID.test(id)) throw new ProjectSectionError('invalid_section_id', 'ID sezione non valido');
    if (!isRecord(patch)) throw new ProjectSectionError('invalid_section_patch', 'Patch sezione non valida');
    const allowed = new Set(['name', 'icon', 'order']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new ProjectSectionError('unknown_section_field', `Campo sezione non modificabile: ${key}`);
    const sections = await this.list();
    const index = sections.findIndex(section => section.id === id);
    if (index < 0) throw new ProjectSectionError('section_not_found', 'Sezione non trovata', 404);
    const current = sections[index]!;
    const name = patch.name === undefined ? current.name : cleanName(patch.name);
    if (sections.some(section => section.id !== id && section.name.toLocaleLowerCase('it') === name.toLocaleLowerCase('it'))) {
      throw new ProjectSectionError('section_already_exists', 'Esiste già una sezione con questo nome', 409);
    }
    const order = patch.order === undefined
      ? current.order
      : typeof patch.order === 'number' && Number.isFinite(patch.order) ? patch.order : (() => { throw new ProjectSectionError('invalid_section_order', 'Ordine sezione non valido'); })();
    const next: ProjectSection = {
      ...current,
      name,
      icon: patch.icon === undefined ? current.icon : cleanIcon(patch.icon),
      order,
      updatedAt: Date.now(),
    };
    sections[index] = next;
    await this.write(sections);
    return next;
  }

  async remove(id: string): Promise<void> {
    if (!SECTION_ID.test(id)) throw new ProjectSectionError('invalid_section_id', 'ID sezione non valido');
    const sections = await this.list();
    if (!sections.some(section => section.id === id)) throw new ProjectSectionError('section_not_found', 'Sezione non trovata', 404);
    await this.write(sections.filter(section => section.id !== id));
  }

  private async write(sections: ProjectSection[]): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const body: SectionFile = { version: 1, sections };
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.filePath);
  }
}

export function registerProjectSectionRoutes(app: FastifyInstance, deps: { sections: ProjectSectionStore; projects: ProjectStore }): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof ProjectSectionError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    throw error;
  };

  app.get('/api/project-sections', async (_request, reply) => {
    return reply.send({ sections: await deps.sections.list() });
  });

  app.post<{ Body: unknown }>('/api/project-sections', async (request, reply) => {
    try {
      return reply.status(201).send({ section: await deps.sections.create(request.body) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/project-sections/:id', async (request, reply) => {
    try {
      return reply.send({ section: await deps.sections.update(request.params.id, request.body) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/project-sections/:id', async (request, reply) => {
    try {
      const projects = await deps.projects.list();
      if (projects.some(project => project.sectionId === request.params.id)) {
        return reply.status(409).send({ error: 'section_not_empty', message: 'Sposta prima i progetti di questa sezione.' });
      }
      await deps.sections.remove(request.params.id);
      return reply.send({ id: request.params.id, deleted: true });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
