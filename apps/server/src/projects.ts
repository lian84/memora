import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { isProjectIcon, type ProjectConfig, type ProjectRecord, type ProjectStatus } from '@memora/shared';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REASONING_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const PROVIDERS = new Set(['openrouter', 'opencode-go']);
const DEFAULT_INCLUDE = ['**/*.md', 'sources/**/*.txt'];

export class ProjectError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ProjectError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('apikey') || normalized.includes('password') || normalized.includes('secret') || normalized.includes('credential');
}

function containsSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => isSecretKey(key) || containsSecretKey(child));
}

function safePattern(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200 || value.includes('\0') || value.includes('..') || path.isAbsolute(value)) return null;
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(segment => segment === '..')) return null;
  return normalized;
}

function legacyConfig(id: string, timestamp: number): ProjectConfig {
  return {
    version: 1,
    id,
    name: id,
    description: '',
    status: 'active',
    prompt: '',
    showArchivedSessions: false,
    defaults: {},
    retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
    sources: { include: [...DEFAULT_INCLUDE], exclude: [] },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function globToRegex(pattern: string): RegExp {
  let result = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index++;
        if (pattern[index + 1] === '/') {
          index++;
          result += '(?:.*/)?';
        } else {
          result += '.*';
        }
      } else {
        result += '[^/]*';
      }
    } else if (char === '?') {
      result += '[^/]';
    } else {
      result += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`^${result}$`);
}

export class ProjectStore {
  private readonly projectsDir: string;
  private readonly warn: (message: string) => void;

  constructor(dataDir: string, warn: (message: string) => void = () => {}) {
    this.projectsDir = path.join(dataDir, 'projects');
    this.warn = warn;
  }

  async list(): Promise<ProjectRecord[]> {
    let entries;
    try {
      entries = await fs.readdir(this.projectsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const projects: ProjectRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SLUG_PATTERN.test(entry.name)) continue;
      const project = await this.get(entry.name);
      if (project) projects.push(project);
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }

  async get(id: string): Promise<ProjectRecord | null> {
    if (!SLUG_PATTERN.test(id)) throw new ProjectError('invalid_project_id', 'ID progetto non valido');
    const directory = path.join(this.projectsDir, id);
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    } catch {
      return null;
    }

    const configPath = path.join(directory, 'project.json');
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = this.validate(JSON.parse(content), id);
      return { ...config, source: 'file' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.warn(`project.json ignored for ${id}: invalid configuration`);
      }
    }

    if (!(await this.hasMarkdown(directory))) return null;
    const timestamp = await this.timestamp(directory);
    return { ...legacyConfig(id, timestamp), source: 'legacy', warning: 'project.json assente: configurazione legacy' };
  }

  async create(input: unknown): Promise<ProjectRecord> {
    if (!isRecord(input)) throw new ProjectError('invalid_project', 'Dati progetto non validi');
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!SLUG_PATTERN.test(id)) throw new ProjectError('invalid_project_id', 'ID progetto non valido');
    const directory = path.join(this.projectsDir, id);
    try { await fs.lstat(directory); throw new ProjectError('project_already_exists', 'Progetto già esistente', 409); }
    catch (error) { if (error instanceof ProjectError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : id;
    const description = typeof input.description === 'string' ? input.description : '';
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    const showArchivedSessions = input.showArchivedSessions === true;
    if (input.sectionId !== undefined && input.sectionId !== null && (typeof input.sectionId !== 'string' || !SLUG_PATTERN.test(input.sectionId))) throw new ProjectError('invalid_project_section', 'Sezione progetto non valida');
    if (input.icon !== undefined && input.icon !== null && !isProjectIcon(input.icon)) throw new ProjectError('invalid_project_icon', 'Icona progetto non valida');
    const sectionId = typeof input.sectionId === 'string' && input.sectionId.trim() ? input.sectionId.trim() : undefined;
    const icon = isProjectIcon(input.icon) ? input.icon : undefined;
    const now = Date.now();
    const config: ProjectConfig = {
      version: 1, id, name, description, status: 'active', prompt, showArchivedSessions, defaults: {},
      ...(sectionId ? { sectionId } : {}),
      ...(icon ? { icon } : {}),
      retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
      sources: { include: ['memory.md', 'sources/**/*.md', 'sources/**/*.txt'], exclude: [] },
      createdAt: now, updatedAt: now,
    };
    this.validate(config, id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(directory, 'memory.md'), `# ${name}

## Note
`, { mode: 0o600, flag: 'wx' });
    try {
      await this.write(config);
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { ...config, source: 'file' };
  }

  async update(id: string, patch: unknown): Promise<ProjectRecord> {
    const current = await this.get(id);
    if (!current) throw new ProjectError('project_not_found', 'Progetto non trovato', 404);
    if (!isRecord(patch)) throw new ProjectError('invalid_project_patch', 'Patch progetto non valida');
    const allowed = new Set(['name', 'description', 'prompt', 'status', 'showArchivedSessions', 'defaults', 'retrieval', 'sources', 'sectionId', 'icon']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new ProjectError('unknown_project_field', `Campo progetto non modificabile: ${key}`);
    if (containsSecretKey(patch)) throw new ProjectError('project_secret_forbidden', 'La patch non può contenere segreti');
    if (patch.sectionId !== undefined && patch.sectionId !== null && (typeof patch.sectionId !== 'string' || !SLUG_PATTERN.test(patch.sectionId))) throw new ProjectError('invalid_project_section', 'Sezione progetto non valida');
    if (patch.icon !== undefined && patch.icon !== null && !isProjectIcon(patch.icon)) throw new ProjectError('invalid_project_icon', 'Icona progetto non valida');
    const { source, warning, ...currentConfig } = current;
    void source;
    void warning;
    const merged = {
      ...currentConfig,
      ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
      ...(typeof patch.description === 'string' ? { description: patch.description } : {}),
      ...(typeof patch.prompt === 'string' ? { prompt: patch.prompt } : {}),
      ...(typeof patch.status === 'string' ? { status: patch.status } : {}),
      ...(typeof patch.showArchivedSessions === 'boolean' ? { showArchivedSessions: patch.showArchivedSessions } : {}),
      ...(isRecord(patch.defaults) ? { defaults: { ...current.defaults, ...patch.defaults } } : {}),
      ...(isRecord(patch.retrieval) ? { retrieval: { ...current.retrieval, ...patch.retrieval } } : {}),
      ...(isRecord(patch.sources) ? { sources: { ...current.sources, ...patch.sources } } : {}),
      ...(patch.sectionId === null ? { sectionId: undefined } : typeof patch.sectionId === 'string' ? { sectionId: patch.sectionId.trim() || undefined } : {}),
      ...(patch.icon === null ? { icon: undefined } : isProjectIcon(patch.icon) ? { icon: patch.icon } : {}),
      updatedAt: Date.now(),
    };
    const config = this.validate(merged, id);
    await this.write(config);
    return { ...config, source: 'file' };
  }

  async purge(id: string, confirm: string): Promise<{ id: string; trashPath: string }> {
    if (confirm !== id) throw new ProjectError('invalid_project_confirmation', 'Conferma progetto non valida');
    const project = await this.get(id);
    if (!project) throw new ProjectError('project_not_found', 'Progetto non trovato', 404);
    const directory = path.join(this.projectsDir, id);
    const trashRoot = path.join(path.dirname(this.projectsDir), '.trash', 'projects');
    await fs.mkdir(trashRoot, { recursive: true, mode: 0o700 });
    const trashPath = path.join(trashRoot, `${id}-${Date.now()}`);
    await fs.rename(directory, trashPath);
    return { id, trashPath };
  }

  async migrateLegacy(apply = false): Promise<{ total: number; migrated: number; skipped: number }> {
    const projects = await this.list();
    const legacy = projects.filter(project => project.source === 'legacy');
    if (apply) {
      for (const project of legacy) {
        const config: ProjectConfig = {
          version: 1,
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          prompt: project.prompt,
          showArchivedSessions: project.showArchivedSessions === true,
          defaults: project.defaults,
          retrieval: project.retrieval,
          sources: project.sources,
          createdAt: project.createdAt,
          updatedAt: Date.now(),
        };
        await this.write(config);
      }
    }
    return { total: projects.length, migrated: apply ? legacy.length : 0, skipped: projects.length - legacy.length };
  }

  private validate(value: unknown, expectedId: string): ProjectConfig {
    if (!isRecord(value)) throw new ProjectError('invalid_project', 'project.json deve essere un oggetto');
    if (containsSecretKey(value)) throw new ProjectError('project_secret_forbidden', 'project.json non può contenere segreti');
    if (value.version !== 1) throw new ProjectError('unsupported_project_version', 'Versione project.json non supportata');
    if (value.id !== expectedId || typeof value.id !== 'string' || !SLUG_PATTERN.test(value.id)) {
      throw new ProjectError('project_id_mismatch', 'ID progetto non coerente con la directory');
    }
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) throw new ProjectError('invalid_project_name', 'Nome progetto non valido');
    if (typeof value.description !== 'string' || value.description.length > 500) throw new ProjectError('invalid_project_description', 'Descrizione progetto non valida');
    if (value.status !== 'active' && value.status !== 'archived') throw new ProjectError('invalid_project_status', 'Stato progetto non valido');
    if (value.showArchivedSessions !== undefined && typeof value.showArchivedSessions !== 'boolean') throw new ProjectError('invalid_project_show_archived', 'Impostazione chat archiviate non valida');
    if (typeof value.prompt !== 'string' || value.prompt.length > 8000) throw new ProjectError('invalid_project_prompt', 'Prompt progetto non valido');
    if (value.sectionId !== undefined && (typeof value.sectionId !== 'string' || !SLUG_PATTERN.test(value.sectionId))) throw new ProjectError('invalid_project_section', 'Sezione progetto non valida');
    if (value.icon !== undefined && !isProjectIcon(value.icon)) throw new ProjectError('invalid_project_icon', 'Icona progetto non valida');

    const defaults = isRecord(value.defaults) ? value.defaults : {};
    if (defaults.provider !== undefined && (typeof defaults.provider !== 'string' || !PROVIDERS.has(defaults.provider))) throw new ProjectError('invalid_project_provider', 'Provider progetto non valido');
    if (defaults.model !== undefined && (typeof defaults.model !== 'string' || defaults.model.length > 160)) throw new ProjectError('invalid_project_model', 'Modello progetto non valido');
    if (defaults.reasoningLevel !== undefined && (typeof defaults.reasoningLevel !== 'string' || !REASONING_LEVELS.has(defaults.reasoningLevel))) throw new ProjectError('invalid_project_reasoning', 'Reasoning progetto non valido');
    if ((defaults.provider === undefined) !== (defaults.model === undefined)) throw new ProjectError('invalid_project_defaults', 'Provider e modello progetto devono essere impostati insieme');

    const retrieval = isRecord(value.retrieval) ? value.retrieval : {};
    for (const key of ['includeGlobal', 'includeProjectMemory', 'includeProjectSources'] as const) {
      if (retrieval[key] !== undefined && typeof retrieval[key] !== 'boolean') throw new ProjectError('invalid_project_retrieval', 'Configurazione retrieval progetto non valida');
    }

    const sources = isRecord(value.sources) ? value.sources : {};
    const include = Array.isArray(sources.include) ? sources.include : DEFAULT_INCLUDE;
    const exclude = Array.isArray(sources.exclude) ? sources.exclude : [];
    if (include.length > 50 || exclude.length > 50) throw new ProjectError('invalid_project_sources', 'Troppi pattern sorgente');
    const normalizedInclude = include.map(safePattern);
    const normalizedExclude = exclude.map(safePattern);
    if (normalizedInclude.some(pattern => pattern === null) || normalizedExclude.some(pattern => pattern === null)) {
      throw new ProjectError('invalid_project_sources', 'Pattern sorgente non valido');
    }

    const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
    const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt;
    return {
      version: 1,
      id: value.id,
      name: value.name.trim(),
      description: value.description.trim(),
      status: value.status as ProjectStatus,
      prompt: value.prompt,
      showArchivedSessions: value.showArchivedSessions === true,
      ...(typeof value.sectionId === 'string' ? { sectionId: value.sectionId } : {}),
      ...(isProjectIcon(value.icon) ? { icon: value.icon } : {}),
      defaults: {
        ...(typeof defaults.provider === 'string' ? { provider: defaults.provider as ProjectConfig['defaults']['provider'] } : {}),
        ...(typeof defaults.model === 'string' ? { model: defaults.model } : {}),
        ...(typeof defaults.reasoningLevel === 'string' ? { reasoningLevel: defaults.reasoningLevel as ProjectConfig['defaults']['reasoningLevel'] } : {}),
      },
      retrieval: {
        includeGlobal: retrieval.includeGlobal !== false,
        includeProjectMemory: retrieval.includeProjectMemory !== false,
        includeProjectSources: retrieval.includeProjectSources !== false,
      },
      sources: { include: normalizedInclude as string[], exclude: normalizedExclude as string[] },
      createdAt,
      updatedAt,
    };
  }

  private async hasMarkdown(directory: string, depth = 0): Promise<boolean> {
    if (depth > 4) return false;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { return false; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name.endsWith('.md')) return true;
      if (entry.isDirectory() && await this.hasMarkdown(path.join(directory, entry.name), depth + 1)) return true;
    }
    return false;
  }

  private async timestamp(directory: string): Promise<number> {
    try {
      const stat = await fs.stat(path.join(directory, 'memory.md'));
      return stat.mtimeMs;
    } catch {
      try { return (await fs.stat(directory)).mtimeMs; } catch { return Date.now(); }
    }
  }

  /** Applica include/exclude del progetto a un path relativo al progetto. */
  async matchesSource(projectId: string, relativePath: string): Promise<boolean> {
    if (relativePath.replaceAll('\\', '/').startsWith(`projects/${projectId}/files/`)) return false;
    const project = await this.get(projectId);
    if (!project) return false;
    if (project.source === 'legacy') return relativePath.endsWith('.md') || (relativePath.endsWith('.txt') && relativePath.split('/')[2] === 'sources');
    const local = relativePath.replaceAll('\\', '/').replace(/^projects\/[^/]+\//, '');
    const include = project.sources.include.length > 0 ? project.sources.include : DEFAULT_INCLUDE;
    return include.some(pattern => globToRegex(pattern).test(local))
      && !project.sources.exclude.some(pattern => globToRegex(pattern).test(local));
  }

  private async write(config: ProjectConfig): Promise<void> {
    this.validate(config, config.id);
    const directory = path.join(this.projectsDir, config.id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, 'project.json');
    const temp = path.join(directory, `.project.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, target);
    await fs.chmod(target, 0o600);
  }
}

export function registerProjectRoutes(app: FastifyInstance, deps: { projects: ProjectStore; sections?: { get(id: string): Promise<unknown | null> } }): void {
  const assertSection = async (value: unknown): Promise<void> => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value !== 'string' || !deps.sections) return;
    if (!(await deps.sections.get(value))) throw new ProjectError('project_section_not_found', 'Sezione del progetto non trovata');
  };
  app.get('/api/projects', async (_request, reply) => {
    try {
      return reply.send({ projects: await deps.projects.list() });
    } catch {
      return reply.status(500).send({ error: 'projects_list_failed' });
    }
  });

  app.post<{ Body: unknown }>('/api/projects', async (request, reply) => {
    try {
      if (isRecord(request.body)) await assertSection(request.body.sectionId);
      return reply.status(201).send({ project: await deps.projects.create(request.body) });
    } catch (error) {
      if (error instanceof ProjectError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return reply.status(500).send({ error: 'project_create_failed' });
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/projects/:id', async (request, reply) => {
    try {
      if (isRecord(request.body)) await assertSection(request.body.sectionId);
      return reply.send({ project: await deps.projects.update(request.params.id, request.body) });
    } catch (error) {
      if (error instanceof ProjectError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return reply.status(500).send({ error: 'project_update_failed' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    try {
      const project = await deps.projects.get(request.params.id);
      return project ? reply.send({ project }) : reply.status(404).send({ error: 'project_not_found' });
    } catch (error) {
      if (error instanceof ProjectError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return reply.status(500).send({ error: 'project_read_failed' });
    }
  });
}
