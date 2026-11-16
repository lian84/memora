import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  MemoryCandidate,
  MemoryCandidateMatch,
  MemoryCandidateStatus,
  MemoryTurnInput,
  AssistantMemoryProposal,
} from '@memora/shared';
import { MemoryCandidateStore } from './candidate-store.js';
import type { MemoryCurator } from './curator.js';
import {
  MemoryWriterError,
  validateMemoryTargetPath,
  matchingMemoryBulletLines,
  replaceMemoryBullet,
  writeMemoryMarkdown,
} from './markdown-writer.js';
import { deriveLegacyMemoryRecord, extractMemoryMetadata, type MemoryRecord } from './memory-metadata.js';

interface MemorySearchResultLike {
  relativePath: string;
  heading: string | null;
  content: string;
  score: number;
}

interface MemorySearchProvider {
  search(query: string, options?: { topK?: number; maxChars?: number; category?: string; projectId?: string }): Promise<MemorySearchResultLike[]>;
  searchScoped?(query: string, options?: { topK?: number; maxChars?: number; category?: string; projectId?: string; includeGlobal?: boolean }): Promise<MemorySearchResultLike[]>;
  reindex(): Promise<void>;
}

export interface MemoryWriterConfig {
  dataDir: string;
  memoryService: MemorySearchProvider;
  /** Abilita l'estrazione automatica conservativa oltre alle richieste esplicite. */
  automaticExtraction?: boolean;
  curator?: MemoryCurator;
  now?: () => number;
  idFactory?: () => string;
}

interface CandidateProposal {
  text: string;
  rationale: string;
  origin: 'explicit' | 'automatic';
  priority: 'high' | 'normal';
}

interface InferredMetadata {
  category: string;
  project?: string;
  projectId?: string;
  heading: string;
  targetPath: string;
}

interface ExistingMemoryAnalysis {
  status: 'pending' | 'conflict';
  duplicateOf?: MemoryCandidateMatch;
  conflictsWith?: MemoryCandidateMatch;
}

export interface CandidateUpdate {
  proposedText?: string;
  targetPath?: string;
  category?: string;
  project?: string;
  heading?: string;
}

const STOPWORDS = new Set([
  'a', 'ad', 'al', 'alla', 'alle', 'agli', 'allo', 'anche', 'che', 'chi', 'ci', 'con', 'da', 'dal', 'dalla',
  'delle', 'dello', 'dei', 'degli', 'di', 'e', 'ed', 'è', 'ha', 'hai', 'hanno', 'ho', 'i', 'il', 'in', 'io',
  'la', 'le', 'lo', 'ma', 'mi', 'ne', 'nel', 'nella', 'noi', 'non', 'o', 'per', 'più', 'può', 'qual', 'quale',
  'questa', 'questo', 'se', 'si', 'sono', 'su', 'sul', 'sulla', 'tra', 'tu', 'un', 'una', 'uno', 'usa', 'usare',
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'are', 'was', 'were', 'use', 'using',
]);

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { label: 'api key', pattern: /\bapi[\s_-]?key\b/i },
  { label: 'password', pattern: /\b(?:password|passwd|pwd)\b/i },
  { label: 'secret', pattern: /\b(?:client[\s_-]?secret|secret)\b/i },
  { label: 'token', pattern: /\b(?:bearer\s+token|access[\s_-]?token|refresh[\s_-]?token|token)\b/i },
  { label: 'credentials', pattern: /\b(?:credenziali|credentials?|credentiali)\b/i },
  { label: 'cookie', pattern: /\bcookie\b/i },
  { label: 'OpenRouter key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { label: 'GitHub token', pattern: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('it-IT')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function similarity(a: Set<string>, b: Set<string>): { jaccard: number; shared: number } {
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared++;
  }
  const union = new Set([...a, ...b]).size;
  return { jaccard: union === 0 ? 0 : shared / union, shared };
}

function slugifyProject(project: string): string {
  return project
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('it-IT')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'progetto';
}

function polishProposalText(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed.charAt(0).toLocaleUpperCase('it-IT') + trimmed.slice(1) : trimmed;
}

export function detectSensitive(text: string): string | null {
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function redactSnippet(text: string): string {
  return detectSensitive(text) ? '[contenuto sensibile rimosso]' : text.slice(0, 800);
}

export function extractExplicitRequest(userText: string): { text: string; rationale: string } | null {
  const patterns: Array<{ pattern: RegExp; keepWhole?: boolean; rationale: string }> = [
    {
      pattern: /^\s*(?:per favore,?\s*)?(?:ricorda(?:mi)?(?:\s+che)?|remember that)\s*[:,-]?\s*/i,
      rationale: 'Richiesta esplicita dell’utente di ricordare questa informazione.',
    },
    {
      pattern: /^\s*salva\s+(?:questa\s+)?informazione\s*[:,-]?\s*/i,
      rationale: 'Richiesta esplicita di salvare questa informazione nel Second Brain.',
    },
    {
      pattern: /^\s*aggiungi\s+(?:questa\s+informazione\s+)?(?:al|nel)\s+second\s+brain\s*[:,-]?\s*/i,
      rationale: 'Richiesta esplicita di aggiungere questa informazione al Second Brain.',
    },
    {
      pattern: /^\s*(?:da ora in poi|d'ora in poi)\b/i,
      keepWhole: true,
      rationale: 'Richiesta esplicita di applicare una regola durevole da ora in poi.',
    },
  ];

  for (const { pattern, keepWhole, rationale } of patterns) {
    if (!pattern.test(userText)) continue;
    const text = keepWhole ? userText.trim() : userText.replace(pattern, '').trim();
    if (text.length < 3) return null;
    return { text: polishProposalText(text), rationale };
  }
  return null;
}

function inferProject(text: string): string | undefined {
  const match = text.match(/\b(?:progetto|project)\s+["“']?([\p{Lu}][\p{L}\p{N}'-]*(?:\s+[\p{Lu}][\p{L}\p{N}'-]*)?)/u);
  return match?.[1]?.replace(/["”']+$/, '').trim() || undefined;
}

function inferCategory(text: string, project?: string): string {
  if (/\b(preferisco|preferiamo|preferenza|abitudine|convenzione|workflow|d'ora in poi|da ora in poi)\b/i.test(text)) {
    return 'preference';
  }
  if (/\b(ho deciso|abbiamo deciso|decisione|deciso di|abbiamo scelto|scelto di|stabilito)\b/i.test(text)) {
    return 'decision';
  }
  if (/\b(mi chiamo|lavoro come|il mio ruolo|abito a|vivo a|profilo)\b/i.test(text)) {
    return 'profile';
  }
  if (/\b(obiettivo|obbiettivo|voglio raggiungere|intenzione|roadmap)\b/i.test(text)) {
    return 'goal';
  }
  return project ? 'project' : 'fact';
}

function inferHeading(category: string, text: string): string {
  if (category === 'preference') {
    return /\b(ai|modello|modelli|openrouter|llm|workflow)\b/i.test(text) ? 'AI workflow' : 'Preferenze';
  }
  if (category === 'decision') return 'Decisioni';
  if (category === 'profile') return 'Profilo';
  if (category === 'goal') return 'Obiettivi';
  if (category === 'project') return 'Note progetto';
  return 'Fatti';
}

function todayIsoDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function inferMetadata(text: string, now: number): InferredMetadata {
  const project = inferProject(text);
  const category = inferCategory(text, project);
  const heading = inferHeading(category, text);

  if (project) {
    return {
      category,
      project,
      projectId: slugifyProject(project),
      heading,
      targetPath: `projects/${slugifyProject(project)}/memory.md`,
    };
  }

  if (category === 'fact' && /\b(oggi|ieri|diario|journal)\b/i.test(text)) {
    return {
      category: 'journal',
      heading: 'Note',
      targetPath: `journal/${todayIsoDate(now)}.md`,
    };
  }
  if (category === 'preference') return { category, heading, targetPath: 'memory/preferences.md' };
  if (category === 'decision') return { category, heading, targetPath: 'memory/decisions.md' };
  if (category === 'goal') return { category, heading, targetPath: 'memory/profile.md' };
  return { category, heading, targetPath: 'memory/profile.md' };
}

function extractAutomaticProposal(userText: string): CandidateProposal | null {
  const text = userText.trim();
  if (text.length < 15 || text.includes('?') || /^(?:ciao|salve|buongiorno|buonasera|grazie|ok|va bene)\b/i.test(text)) {
    return null;
  }

  const signals: Array<{ pattern: RegExp; rationale: string }> = [
    {
      pattern: /\b(preferisco|preferiamo|preferenza|abitudine|convenzione|workflow)\b/i,
      rationale: 'Frase con indicatore esplicito di preferenza o convenzione durevole.',
    },
    {
      pattern: /\b(ho deciso|abbiamo deciso|decisione|deciso di|abbiamo scelto|scelto di|stabilito)\b/i,
      rationale: 'Frase con indicatore esplicito di decisione stabile.',
    },
    {
      pattern: /\b(mi chiamo|lavoro come|il mio ruolo|abito a|vivo a)\b/i,
      rationale: 'Frase con informazione stabile di profilo.',
    },
    {
      pattern: /\b(obiettivo|obbiettivo|voglio raggiungere|intenzione|roadmap)\b/i,
      rationale: 'Frase con obiettivo o intenzione a medio/lungo termine.',
    },
    {
      pattern: /\b(?:progetto|project)\s+\p{Lu}/u,
      rationale: 'Frase con informazione stabile su un progetto.',
    },
  ];

  const signal = signals.find(({ pattern }) => pattern.test(text));
  if (!signal) return null;
  return { text: polishProposalText(text), rationale: signal.rationale, origin: 'automatic', priority: 'normal' };
}

export class MemoryWriter {
  private readonly dataDir: string;
  private readonly memoryService: MemorySearchProvider;
  private readonly automaticExtraction: boolean;
  private readonly curator?: MemoryCurator;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly store: MemoryCandidateStore;

  constructor(config: MemoryWriterConfig) {
    this.dataDir = config.dataDir;
    this.memoryService = config.memoryService;
    this.automaticExtraction = config.automaticExtraction ?? false;
    this.curator = config.curator;
    this.now = config.now ?? Date.now;
    this.idFactory = config.idFactory ?? crypto.randomUUID;
    this.store = new MemoryCandidateStore(config.dataDir);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /** Analizza un turno e crea zero o più candidati. Non scrive mai Markdown. */
  async processTurn(input: MemoryTurnInput): Promise<{ created: MemoryCandidate[] }> {
    // Idempotenza per retry/ripresa: lo stesso turno non deve produrre due
    // candidati se il processo è caduto dopo la persistenza ma prima dell'ack.
    if (input.turnId || input.sourceMessageId) {
      const existing = (await this.store.listAll()).find(candidate =>
        (input.turnId !== undefined && candidate.turnId === input.turnId)
        || (input.turnId === undefined && input.sourceMessageId !== undefined && candidate.sourceMessageId === input.sourceMessageId));
      if (existing) return { created: [] };
    }
    const explicit = extractExplicitRequest(input.userText);
    if (this.curator && !detectSensitive(input.userText)) {
      let persisting = false;
      let responseStatus: number | undefined;
      const curatorStarted = Date.now();
      try {
        const curated = await this.curator.curate(input, !!explicit);
        if (curated) {
          responseStatus = curated.httpStatus;
          const now = this.now();
          const candidate: MemoryCandidate = {
            id: this.idFactory(), createdAt: now, updatedAt: now, sessionId: input.sessionId,
            sourceMessageId: input.sourceMessageId, turnId: input.turnId,
            category: curated.category, project: curated.project, projectId: curated.projectId, heading: curated.heading,
            proposedText: curated.proposedText, rationale: curated.rationale,
            status: curated.action === 'conflict' ? 'conflict' : 'pending', targetPath: curated.targetPath,
            origin: explicit ? 'explicit' : 'automatic', priority: explicit ? 'high' : 'normal',
            importanceScore: curated.importance, durabilityScore: curated.durability,
            futureUtilityScore: curated.futureUtility, noveltyScore: curated.novelty,
            confidenceScore: curated.confidence, salienceScore: curated.salience,
            memoryType: curated.memoryType, action: curated.action, updateIntent: curated.updateIntent, entityType: curated.entityType,
            entityName: curated.entityName, currentText: curated.currentText,
            relatedSourceIds: curated.relatedSourceIds, curatorProvider: curated.curatorProvider, curatorModel: curated.curatorModel,
            conflictsWith: curated.conflictMemory ? { relativePath: curated.conflictMemory.relativePath, heading: curated.conflictMemory.heading, content: curated.conflictMemory.content, score: 0 } : undefined,
          };
          persisting = true;
          await validateMemoryTargetPath(this.dataDir, candidate.targetPath);
          await this.store.append(candidate);
          this.curator.reportCreated(curated.latencyMs, curated.httpStatus, curated.salience, curated.confidence);
          return { created: [candidate] };
        }
        if (!explicit) return { created: [] };
      } catch {
        if (persisting) this.curator.reportFailure(Date.now() - curatorStarted, responseStatus);
        // Preserve existing explicit-request behavior; never turn a curator
        // failure into a conversation failure or log model output.
        if (!explicit) return { created: [] };
      }
    }
    const proposals: CandidateProposal[] = [];

    if (explicit) {
      proposals.push({
        text: explicit.text,
        rationale: explicit.rationale,
        origin: 'explicit',
        priority: 'high',
      });
    } else if (this.automaticExtraction) {
      const automatic = extractAutomaticProposal(input.userText);
      if (automatic) proposals.push(automatic);
    }

    const created: MemoryCandidate[] = [];
    for (const proposal of proposals) {
      const sensitive = detectSensitive(proposal.text);
      if (sensitive && proposal.origin === 'automatic') continue;
      const candidate = await this.buildCandidate(input, proposal, sensitive);
      await this.store.append(candidate);
      created.push(candidate);
    }

    return { created };
  }

  /** Analizza una risposta con il Curator quando disponibile; non persiste nulla. */
  async proposeAssistantMemories(input: {
    assistantText: string;
    question?: string;
    context?: string[];
    projectId?: string;
  }): Promise<AssistantMemoryProposal[] | null> {
    if (!this.curator) return null;
    return this.curator.proposeAssistantMemories(input);
  }

  /** Promuove esplicitamente una risposta dell'assistente a candidato memoria.
   * Non passa dal Curator: è un'azione utente e resta soggetta ad approvazione.
   */
  async proposeAssistantMemory(input: {
    sessionId: string;
    projectId?: string;
    text: string;
    question?: string;
    context?: string[];
    targetPath?: string;
    category?: string;
    heading?: string;
    action?: 'new' | 'update';
    currentText?: string;
    sourceMessageId?: string;
    sourceTimestamp?: number;
  }): Promise<MemoryCandidate> {
    const text = input.text.trim();
    if (!text) throw new MemoryWriterError('invalid_candidate', 'La risposta è vuota');
    if (text.length > 6000) throw new MemoryWriterError('invalid_candidate', 'La risposta è troppo lunga per una memoria');
    if (detectSensitive(text)) throw new MemoryWriterError('sensitive_content', 'La risposta contiene un possibile segreto');
    const proposal: CandidateProposal = {
      text: polishProposalText(text),
      rationale: 'Risposta dell’assistente promossa esplicitamente dall’utente.',
      origin: 'explicit',
      priority: 'high',
    };
    const candidate = await this.buildCandidate({
      sessionId: input.sessionId,
      projectId: input.projectId,
      userText: text,
      sourceMessageId: input.sourceMessageId,
      sourceTimestamp: input.sourceTimestamp,
      sourceKind: 'assistant',
    }, proposal, null, [...(input.context ?? []), input.question, text].filter(Boolean).join('\n'));
    let next = candidate.projectId || !input.projectId ? candidate : {
      ...candidate,
      projectId: input.projectId,
      category: candidate.category === 'fact' ? 'project' : candidate.category,
      targetPath: `projects/${input.projectId}/memory.md`,
    };
    if (input.targetPath) {
      const target = await validateMemoryTargetPath(this.dataDir, input.targetPath);
      const projectMatch = target.relativePath.match(/^projects\/([^/]+)\//);
      next = {
        ...next,
        targetPath: target.relativePath,
        projectId: projectMatch?.[1],
        project: projectMatch ? next.project : undefined,
        category: projectMatch ? 'project' : 'fact',
        heading: projectMatch ? next.heading : 'Fatti',
      };
    }
    const withContext = {
      ...next,
      ...(input.category ? { category: input.category } : {}),
      ...(input.heading ? { heading: input.heading } : {}),
      ...(input.action === 'update' && input.currentText ? { action: 'update' as const, currentText: input.currentText } : {}),
      ...(input.question ? { sourceQuestion: input.question.slice(0, 2000) } : {}),
      ...(input.context?.length ? { sourceContext: input.context.slice(-6).map(item => item.slice(0, 1000)) } : {}),
    };
    await this.store.append(withContext);
    return withContext;
  }

  async getStats(): Promise<{ pending: number; conflict: number; approved: number; rejected: number; total: number; approvalRate: number | null }> {
    const candidates = await this.store.listAll();
    const count = (status: MemoryCandidateStatus) => candidates.filter(candidate => candidate.status === status).length;
    const approved = count('approved');
    const rejected = count('rejected');
    return {
      pending: count('pending'),
      conflict: count('conflict'),
      approved,
      rejected,
      total: candidates.length,
      approvalRate: approved + rejected === 0 ? null : approved / (approved + rejected),
    };
  }

  async listCandidates(status?: MemoryCandidateStatus): Promise<MemoryCandidate[]> {
    const candidates = await this.store.listAll();
    return status ? candidates.filter((candidate) => candidate.status === status) : candidates;
  }

  async getCandidate(id: string): Promise<MemoryCandidate> {
    const candidate = await this.store.get(id);
    if (!candidate) {
      throw new MemoryWriterError('candidate_not_found', `Candidato non trovato: ${id}`);
    }
    return candidate;
  }

  async updateCandidate(id: string, update: CandidateUpdate): Promise<MemoryCandidate> {
    const current = await this.requireReviewable(id);
    const next: MemoryCandidate = {
      ...current,
      updatedAt: this.now(),
    };

    if (update.proposedText !== undefined) {
      const text = update.proposedText.trim();
      if (!text) throw new MemoryWriterError('invalid_candidate', 'Il testo proposto non può essere vuoto');
      if (detectSensitive(text)) {
        throw new MemoryWriterError('sensitive_content', 'Il testo modificato contiene un possibile segreto');
      }
      next.proposedText = text;
    }
    if (update.targetPath !== undefined) {
      const target = await validateMemoryTargetPath(this.dataDir, update.targetPath);
      next.targetPath = target.relativePath;
    }
    if (update.category !== undefined) next.category = update.category.trim() || next.category;
    if (update.project !== undefined) next.project = update.project.trim() || undefined;
    if (update.heading !== undefined) next.heading = update.heading.trim() || next.heading;

    if (update.proposedText !== undefined || update.targetPath !== undefined || update.category !== undefined) {
      const analysis = await this.analyzeExistingMemory(next.proposedText);
      next.status = analysis.status;
      next.duplicateOf = analysis.duplicateOf;
      next.conflictsWith = analysis.conflictsWith;
    }

    await this.store.append(next);
    return next;
  }

  private memoryRecordFor(candidate: MemoryCandidate, previous?: MemoryRecord): MemoryRecord {
    const now = this.now();
    const entity = candidate.entityName
      ? [{ type: candidate.entityType ?? 'other', name: candidate.entityName }]
      : [];
    const tags: string[] = [];
    if (candidate.memoryType) tags.push(candidate.memoryType);
    if (candidate.updateIntent) tags.push(candidate.updateIntent);
    return {
      memoryId: previous?.memoryId ?? `mem_${candidate.id}`,
      versionId: `ver_${candidate.id}`,
      version: (previous?.version ?? 0) + 1,
      status: 'active',
      createdAt: previous?.createdAt ?? candidate.createdAt,
      updatedAt: now,
      sourceSessionId: candidate.sessionId,
      sourceMessageId: candidate.sourceMessageId,
      sourceTurnId: candidate.turnId,
      sourceTimestamp: candidate.sourceTimestamp ?? candidate.createdAt,
      confidence: candidate.confidenceScore,
      importance: candidate.importanceScore,
      durability: candidate.durabilityScore,
      futureUtility: candidate.futureUtilityScore,
      novelty: candidate.noveltyScore,
      salience: candidate.salienceScore,
      scope: candidate.project ? `project:${slugifyProject(candidate.project)}` : candidate.category,
      project: candidate.project,
      projectId: candidate.projectId,
      entities: entity,
      tags,
      curatorProvider: candidate.curatorProvider,
      curatorModel: candidate.curatorModel,
      supersedes: previous ? [previous.versionId] : [],
      supersededBy: null,
    };
  }

  private async existingMemoryRecord(targetPath: string, currentText: string, candidate: MemoryCandidate): Promise<MemoryRecord> {
    try {
      const content = await fs.readFile(path.join(this.dataDir, targetPath), 'utf-8');
      const lineIndex = matchingMemoryBulletLines(content, currentText)[0];
      if (lineIndex !== undefined) {
        const record = extractMemoryMetadata(content.split('\n')[lineIndex] ?? '')[0];
        if (record) return record;
      }
    } catch {
      // La validazione del path e il matching del bullet falliranno in scrittura.
    }
    return deriveLegacyMemoryRecord(targetPath, currentText, candidate.createdAt);
  }

  async approve(
    id: string,
    overrides: CandidateUpdate = {},
  ): Promise<{ candidate: MemoryCandidate; reindexed: boolean; markdownChanged: boolean }> {
    const candidate = Object.keys(overrides).length > 0
      ? await this.updateCandidate(id, overrides)
      : await this.requireReviewable(id);

    if (detectSensitive(candidate.proposedText)) {
      throw new MemoryWriterError('sensitive_content', 'Il candidato contiene un possibile segreto');
    }

    const target = await validateMemoryTargetPath(this.dataDir, candidate.targetPath);
    const previous = candidate.action === 'update' && candidate.currentText
      ? await this.existingMemoryRecord(target.relativePath, candidate.currentText, candidate)
      : undefined;
    const next = this.memoryRecordFor(candidate, previous);
    const writeResult = candidate.action === 'update' && candidate.currentText
      ? await replaceMemoryBullet(this.dataDir, target.relativePath, candidate.currentText, candidate.proposedText, { previous, next })
      : await writeMemoryMarkdown(this.dataDir, target.relativePath, candidate.heading, candidate.proposedText, next);

    if (writeResult.changed) {
      await this.memoryService.reindex();
    }

    const approved: MemoryCandidate = {
      ...candidate,
      status: 'approved',
      updatedAt: this.now(),
      writtenPath: writeResult.relativePath,
      writtenAt: this.now(),
      skippedDuplicate: writeResult.skippedDuplicate,
    };
    await this.store.append(approved);

    return {
      candidate: approved,
      reindexed: writeResult.changed,
      markdownChanged: writeResult.changed,
    };
  }

  /** Propaga la cancellazione di una fonte ai candidati che la referenziano. */
  async markCandidatesPurgedForPath(relativePath: string): Promise<number> {
    const now = this.now();
    let purged = 0;
    for (const candidate of await this.store.listAll()) {
      if (candidate.purgedAt || (candidate.targetPath !== relativePath && candidate.writtenPath !== relativePath)) continue;
      const rejected = candidate.status === 'pending' || candidate.status === 'conflict';
      await this.store.append({
        ...candidate,
        status: rejected ? 'rejected' : candidate.status,
        rejectionReason: rejected ? 'source_deleted' : candidate.rejectionReason,
        updatedAt: now,
        purgedAt: now,
        purgeReason: 'source_deleted',
      });
      purged++;
    }
    return purged;
  }

  async reject(id: string, reason?: string): Promise<MemoryCandidate> {
    const current = await this.requireReviewable(id);
    const rejected: MemoryCandidate = {
      ...current,
      status: 'rejected',
      updatedAt: this.now(),
      rejectionReason: reason?.trim() || undefined,
    };
    await this.store.append(rejected);
    return rejected;
  }

  private async buildCandidate(
    input: MemoryTurnInput,
    proposal: CandidateProposal,
    sensitive: string | null,
    metadataText = proposal.text,
  ): Promise<MemoryCandidate> {
    const now = this.now();
    const metadata = inferMetadata(metadataText, now);
    const base: MemoryCandidate = {
      id: this.idFactory(),
      createdAt: now,
      updatedAt: now,
      sessionId: input.sessionId,
      sourceMessageId: input.sourceMessageId,
      sourceTimestamp: input.sourceTimestamp,
      turnId: input.turnId,
      sourceKind: input.sourceKind ?? 'user',
      category: metadata.category,
      project: metadata.project,
      projectId: metadata.projectId,
      heading: metadata.heading,
      proposedText: proposal.text,
      rationale: proposal.rationale,
      status: 'pending',
      targetPath: metadata.targetPath,
      origin: proposal.origin,
      priority: proposal.priority,
    };

    if (sensitive) {
      return {
        ...base,
        proposedText: '[contenuto sensibile rimosso]',
        rationale: `Candidato bloccato: rilevato possibile ${sensitive}.`,
        status: 'rejected',
        sensitive: true,
        rejectionReason: `Rilevato possibile ${sensitive}; nessun contenuto è stato scritto nella knowledge base.`,
      };
    }

    const analysis = await this.analyzeExistingMemory(proposal.text, metadata.projectId);
    return {
      ...base,
      status: analysis.status,
      duplicateOf: analysis.duplicateOf,
      conflictsWith: analysis.conflictsWith,
    };
  }

  private async analyzeExistingMemory(text: string, projectId?: string): Promise<ExistingMemoryAnalysis> {
    const query = text.trim();
    if (!query) return { status: 'pending' };

    let results: MemorySearchResultLike[] = [];
    try {
      results = projectId && this.memoryService.searchScoped
        ? await this.memoryService.searchScoped(query, { topK: 8, maxChars: 6000, projectId, includeGlobal: true })
        : await this.memoryService.search(query, { topK: 8, maxChars: 6000, projectId });
    } catch {
      return { status: 'pending' };
    }

    const candidateNormalized = normalizeText(text);
    const candidateTokens = new Set(tokenize(text));
    if (!candidateNormalized || candidateTokens.size === 0) return { status: 'pending' };

    let bestConflict: { match: MemoryCandidateMatch; score: number } | undefined;

    for (const result of results) {
      const resultNormalized = normalizeText(result.content);
      const match: MemoryCandidateMatch = {
        relativePath: result.relativePath,
        heading: result.heading,
        content: redactSnippet(result.content),
        score: result.score,
      };

      if (resultNormalized.includes(candidateNormalized)) {
        return { status: 'pending', duplicateOf: match };
      }

      const lines = result.content.split('\n').map((line) => normalizeText(line.replace(/^\s*[-*+]\s+/, '')));
      if (lines.some((line) => line === candidateNormalized)) {
        return { status: 'pending', duplicateOf: match };
      }

      const resultTokens = new Set(tokenize(result.content));
      const { jaccard, shared } = similarity(candidateTokens, resultTokens);
      if (jaccard >= 0.78) {
        return { status: 'pending', duplicateOf: match };
      }
      if (jaccard >= 0.32 && shared >= 3 && (!bestConflict || jaccard > bestConflict.score)) {
        bestConflict = { match, score: jaccard };
      }
    }

    if (bestConflict) {
      return { status: 'conflict', conflictsWith: bestConflict.match };
    }
    return { status: 'pending' };
  }

  private async requireReviewable(id: string): Promise<MemoryCandidate> {
    const candidate = await this.getCandidate(id);
    if (candidate.status !== 'pending' && candidate.status !== 'conflict') {
      throw new MemoryWriterError('candidate_not_reviewable', 'Il candidato è già stato revisionato');
    }
    return candidate;
  }
}
