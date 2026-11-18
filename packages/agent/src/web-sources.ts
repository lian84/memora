import type { WebSource } from '@memora/shared';

export const MAX_WEB_SOURCES = 50;

export interface NumberedWebSources {
  /** Elenco persistito, con numeri stabili e limite massimo. */
  sources: WebSource[];
  /** Sorgenti in ingresso, arricchite con il numero da usare nel tool output. */
  incoming: WebSource[];
  /** Prossimo numero da assegnare, anche dopo la rimozione delle fonti più vecchie. */
  nextNumber: number;
}

/**
 * Assegna numeri stabili alle fonti web. Una fonte già presente mantiene il
 * proprio numero anche quando viene ritrovata da una ricerca successiva.
 */
export function mergeWebSourcesWithNumbers(
  current: WebSource[],
  incoming: WebSource[],
  nextNumber = 1,
): NumberedWebSources {
  let next = Math.max(1, Math.trunc(nextNumber) || 1);
  const normalized = current.map(source => {
    const number = typeof source.number === 'number' && source.number > 0 ? source.number : next++;
    if (number >= next) next = number + 1;
    return { ...source, number };
  });
  const byUrl = new Map<string, WebSource>(normalized.map(source => [source.url, source]));
  const assigned = incoming.map(source => {
    const existing = byUrl.get(source.url);
    const number = existing?.number ?? next++;
    const merged: WebSource = { ...existing, ...source, number };
    byUrl.set(source.url, merged);
    return merged;
  });
  return {
    sources: [...byUrl.values()].slice(-MAX_WEB_SOURCES),
    incoming: assigned,
    nextNumber: next,
  };
}
