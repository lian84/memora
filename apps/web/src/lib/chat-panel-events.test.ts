import { describe, expect, it } from 'vitest';
import type { ChatArtifact, WebSource } from '@memora/shared';
import {
  canAutoOpenSidePanel,
  mergeArtifacts,
  mergeWebSources,
  readPanelToolUpdate,
} from './chat-panel-events';

const artifact: ChatArtifact = {
  id: 'a1',
  sessionId: 's1',
  name: 'report.md',
  kind: 'markdown',
  mimeType: 'text/markdown',
  size: 12,
  createdAt: 1,
  updatedAt: 1,
  version: 1,
};

const source: WebSource = {
  id: 'https://example.com',
  url: 'https://example.com',
  title: 'Example',
  domain: 'example.com',
  kind: 'search',
  fetchedAt: 1,
  status: 'ok',
};

describe('chat panel events', () => {
  it('apre automaticamente solo sopra il breakpoint desktop', () => {
    expect(canAutoOpenSidePanel(901)).toBe(true);
    expect(canAutoOpenSidePanel(900)).toBe(false);
    expect(canAutoOpenSidePanel(600)).toBe(false);
  });

  it('estrae un artefatto da create_artifact', () => {
    const update = readPanelToolUpdate({
      toolName: 'create_artifact',
      result: { details: { artifact } },
    });
    expect(update.artifacts).toEqual([artifact]);
    expect(update.webSources).toEqual([]);
  });

  it('estrae le fonti da web_search e web_fetch', () => {
    expect(
      readPanelToolUpdate({ toolName: 'web_search', result: { details: { webSources: [source] } } })
        .webSources
    ).toEqual([source]);
    expect(
      readPanelToolUpdate({ toolName: 'web_fetch', result: { details: { webSources: [source] } } })
        .webSources
    ).toEqual([source]);
  });

  it('ignora eventi senza dettagli validi', () => {
    expect(readPanelToolUpdate(null)).toEqual({ artifacts: [], webSources: [] });
    expect(readPanelToolUpdate({ toolName: 'other', result: { details: { artifact } } })).toEqual({
      artifacts: [],
      webSources: [],
    });
    expect(
      readPanelToolUpdate({
        toolName: 'create_artifact',
        result: { details: { artifact: { id: 'x' } } },
      })
    ).toEqual({ artifacts: [], webSources: [] });
  });

  it('deduplica artefatti e fonti per id', () => {
    expect(mergeArtifacts([artifact], [{ ...artifact, version: 2 }])).toEqual([artifact]);
    expect(mergeWebSources([source], [{ ...source, title: 'Aggiornato' }])).toEqual([source]);
  });

  it('mantiene il limite delle fonti web', () => {
    const sources = Array.from({ length: 3 }, (_, index) => ({
      ...source,
      id: `s${index}`,
      url: `https://example.com/${index}`,
    }));
    expect(mergeWebSources([], sources, 2)).toHaveLength(2);
  });
});
