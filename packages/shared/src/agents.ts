import type { ProjectIcon } from './projects.js';

/** Icona usata da un profilo agente; riusa il set delle icone progetto. */
export type AgentIcon = ProjectIcon;

export const DEFAULT_AGENT_COLOR = '#2563eb';

/** Colori predefiniti per i profili di esempio e fallback per profili custom. */
export function defaultAgentColor(id: string): string {
  switch (id) {
    case 'brainstorming': return '#d97706';
    case 'commercialista': return '#0f8a6a';
    case 'sviluppatore': return '#2563eb';
    case 'social-media': return '#c026d3';
    default: return DEFAULT_AGENT_COLOR;
  }
}

export function isAgentColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/** Metadati di una competenza caricabile on demand dal profilo. */
export interface AgentSkillSummary {
  name: string;
  description: string;
}

/** Profilo agente completo, usato dal server e dal file store. */
export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  icon: AgentIcon;
  /** Colore esadecimale dell'icona; usato solo dalla UI. */
  color: string;
  prompt: string;
  skills: AgentSkillSummary[];
  createdAt: number;
  updatedAt: number;
}

/** Versione leggera restituita alla UI per il selettore della nuova chat. */
export interface AgentProfileSummary {
  id: string;
  name: string;
  description: string;
  icon: AgentIcon;
  color: string;
  skills: string[];
}

/** Identità del profilo associata a una sessione e mostrata nella sidebar. */
export interface SessionAgentInfo {
  id: string;
  name: string;
  icon: AgentIcon;
  color: string;
}
