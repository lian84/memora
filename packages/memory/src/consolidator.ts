import type { MemoryCuratorProvider, ProviderEvent } from './curator.js';

export type ConsolidationKind = 'duplicate' | 'conflict';

export interface ConsolidationRecord {
  memoryId: string;
  versionId: string;
  relativePath: string;
  text: string;
  project?: string;
  confidence?: number;
  updatedAt: number;
}

export interface ConsolidationDecision {
  kind: ConsolidationKind;
  memoryIds: string[];
  recommendedText?: string;
  rationale?: string;
  confidence?: number;
}

export interface ConsolidationReport {
  schemaVersion: 1;
  decisions: ConsolidationDecision[];
  provider: string;
  model: string;
  latencyMs: number;
}

export interface MemoryConsolidatorOptions {
  maxRecords?: number;
  maxDecisions?: number;
}

const SYSTEM_PROMPT = `Sei un consolidatore di memoria, non un chatbot. Ricevi un elenco di memorie attive con id, path, testo, progetto, confidenza e data. Devi solo trovare:
- duplicate: stessa informazione espressa in modi diversi;
- conflict: informazioni incompatibili sullo stesso fatto.
Non inventare memorie, non unire fatti solo perché parlano dello stesso progetto e non proporre modifiche non supportate dal testo. Usa esclusivamente gli id forniti.
Rispondi con un solo oggetto JSON, senza markdown:
{"schemaVersion":1,"decisions":[{"kind":"duplicate|conflict","memoryIds":["id1","id2"],"recommendedText":"testo finale opzionale","rationale":"motivo breve","confidence":0.0}]}
Se non trovi problemi restituisci {"schemaVersion":1,"decisions":[]}.`;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length > max || [...value].some(char => char.charCodeAt(0) < 32)) return undefined;
  return value.trim() || undefined;
}

function validateReport(value: unknown, ids: Set<string>, maxDecisions: number): ConsolidationDecision[] {
  const raw = record(value);
  if (!raw || raw.schemaVersion !== 1) throw new Error('consolidation_invalid_schema');
  if (!Array.isArray(raw.decisions) || raw.decisions.length > maxDecisions) throw new Error('consolidation_invalid_decisions');
  const decisions: ConsolidationDecision[] = [];
  for (const item of raw.decisions) {
    const decision = record(item);
    if (!decision) throw new Error('consolidation_invalid_decision');
    const kind = decision.kind;
    if (kind !== 'duplicate' && kind !== 'conflict') continue;
    if (!Array.isArray(decision.memoryIds) || decision.memoryIds.length < 2 || decision.memoryIds.length > 10) continue;
    if (!decision.memoryIds.every(id => typeof id === 'string' && ids.has(id))) continue;
    const confidence = typeof decision.confidence === 'number' && Number.isFinite(decision.confidence) && decision.confidence >= 0 && decision.confidence <= 1
      ? decision.confidence : undefined;
    decisions.push({
      kind,
      memoryIds: [...new Set(decision.memoryIds as string[])],
      recommendedText: text(decision.recommendedText, 2000),
      rationale: text(decision.rationale, 400),
      confidence,
    });
  }
  return decisions;
}

/** Consolidamento LLM read-only: produce solo un report, non candidate o Markdown. */
export class MemoryConsolidator {
  constructor(
    private readonly provider: MemoryCuratorProvider,
    private readonly config: MemoryConsolidatorOptions = {},
  ) {}

  async analyze(records: ConsolidationRecord[], reportEvent?: (event: ProviderEvent) => void): Promise<ConsolidationReport> {
    if (!this.provider.complete) throw new Error('consolidation_provider_unsupported');
    const maxRecords = this.config.maxRecords ?? 20;
    if (records.length < 2) return { schemaVersion: 1, decisions: [], provider: this.provider.provider ?? 'custom', model: this.provider.model, latencyMs: 0 };
    const selected = records.slice(0, maxRecords);
    const ids = new Set(selected.map(record => record.memoryId));
    const payload = selected.map(record => ({
      id: record.memoryId,
      path: record.relativePath,
      project: record.project,
      confidence: record.confidence,
      updatedAt: new Date(record.updatedAt).toISOString(),
      text: record.text,
    }));
    const started = Date.now();
    const output = await this.provider.complete(SYSTEM_PROMPT, payload, reportEvent);
    return {
      schemaVersion: 1,
      decisions: validateReport(output, ids, this.config.maxDecisions ?? 20),
      provider: this.provider.provider ?? 'custom',
      model: this.provider.model,
      latencyMs: Date.now() - started,
    };
  }
}
