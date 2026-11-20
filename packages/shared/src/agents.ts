import type { ProjectIcon } from './projects.js';

/** Icona usata da un profilo agente; riusa il set delle icone progetto. */
export type AgentIcon = ProjectIcon;

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
  skills: string[];
}

/** Identità del profilo associata a una sessione e mostrata nella sidebar. */
export interface SessionAgentInfo {
  id: string;
  name: string;
  icon: AgentIcon;
}
