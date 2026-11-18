import type { ChatArtifact, WebSource } from '@memora/shared';

export const SIDE_PANEL_DESKTOP_BREAKPOINT = 900;

export function canAutoOpenSidePanel(
  viewportWidth = typeof window === 'undefined' ? undefined : window.innerWidth
): boolean {
  return viewportWidth === undefined || viewportWidth > SIDE_PANEL_DESKTOP_BREAKPOINT;
}

export function mergeArtifacts(current: ChatArtifact[], incoming: ChatArtifact[]): ChatArtifact[] {
  const known = new Set(current.map((artifact) => artifact.id));
  const added = incoming.filter((artifact) => !known.has(artifact.id));
  return added.length > 0 ? [...added, ...current] : current;
}

export function mergeWebSources(
  current: WebSource[],
  incoming: WebSource[],
  limit = 50
): WebSource[] {
  const known = new Set(current.map((source) => source.id));
  const added = incoming.filter((source) => !known.has(source.id));
  return added.length > 0 ? [...added, ...current].slice(0, limit) : current;
}

function getToolDetails(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const details = (result as { details?: unknown }).details;
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
}

function isChatArtifact(value: unknown): value is ChatArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<ChatArtifact>;
  return (
    typeof artifact.id === 'string' &&
    typeof artifact.name === 'string' &&
    typeof artifact.kind === 'string' &&
    typeof artifact.mimeType === 'string' &&
    typeof artifact.size === 'number' &&
    typeof artifact.version === 'number'
  );
}

function isWebSource(value: unknown): value is WebSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<WebSource>;
  return (
    typeof source.id === 'string' &&
    typeof source.url === 'string' &&
    typeof source.title === 'string' &&
    typeof source.domain === 'string' &&
    typeof source.kind === 'string' &&
    typeof source.fetchedAt === 'number' &&
    typeof source.status === 'string'
  );
}

export interface PanelToolUpdate {
  artifacts: ChatArtifact[];
  webSources: WebSource[];
}

/** Estrae gli aggiornamenti del pannello dagli eventi `tool_execution_end` di Pi. */
export function readPanelToolUpdate(payload: unknown): PanelToolUpdate {
  const empty: PanelToolUpdate = { artifacts: [], webSources: [] };
  if (!payload || typeof payload !== 'object') return empty;
  const event = payload as { toolName?: unknown; result?: unknown };
  if (typeof event.toolName !== 'string') return empty;
  const details = getToolDetails(event.result);
  if (!details) return empty;
  if (event.toolName === 'create_artifact') {
    return {
      artifacts: isChatArtifact(details.artifact) ? [details.artifact] : [],
      webSources: [],
    };
  }
  if (event.toolName === 'web_search' || event.toolName === 'web_fetch') {
    return {
      artifacts: [],
      webSources: Array.isArray(details.webSources) ? details.webSources.filter(isWebSource) : [],
    };
  }
  return empty;
}
