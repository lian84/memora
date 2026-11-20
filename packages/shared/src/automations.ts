import type { McpServerId } from './mcp.js';

export const AUTOMATION_LIMITS = {
  nameMax: 120,
  promptMax: 20_000,
  cronMax: 100,
  timezoneMax: 64,
  timeoutMinutesMin: 1,
  timeoutMinutesMax: 120,
  maxAttemptsMax: 3,
  defaultTimeoutMinutes: 10,
  runHistoryLimit: 50,
} as const;

export interface AutomationMcpSettings {
  enabled: McpServerId[];
  /** Scritture MCP disattivate di default anche nelle automazioni. */
  allowWrites?: boolean;
}

export type AutomationRunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'interrupted';
export type AutomationTrigger = 'schedule' | 'manual';
export type AutomationTelegramStatus = 'sent' | 'skipped' | 'failed';

export interface AutomationJob {
  id: string;
  name: string;
  prompt: string;
  /** Espressione cron a 5 campi (minuto, ora, giorno, mese, giorno della settimana). */
  cron: string;
  timezone: string;
  enabled: boolean;
  projectId?: string;
  agentProfileId?: string;
  mcp: AutomationMcpSettings;
  notifyTelegram: boolean;
  timeoutMinutes: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastRunStatus?: AutomationRunStatus;
}

export interface AutomationRun {
  id: string;
  jobId: string;
  trigger: AutomationTrigger;
  status: AutomationRunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  sessionId?: string;
  output?: string;
  error?: string;
  telegramStatus?: AutomationTelegramStatus;
  telegramError?: string;
}

export interface AutomationJobInput {
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  enabled?: boolean;
  projectId?: string | null;
  agentProfileId?: string | null;
  mcp?: AutomationMcpSettings;
  notifyTelegram?: boolean;
  timeoutMinutes?: number;
  maxAttempts?: number;
}

export interface TelegramSettingsView {
  enabled: boolean;
  chatId: string;
  tokenConfigured: boolean;
  tokenSource: 'environment' | 'secret' | 'none';
  tokenEditable: boolean;
}

export interface TelegramChat {
  id: string;
  label: string;
  type: string;
  username?: string;
}
