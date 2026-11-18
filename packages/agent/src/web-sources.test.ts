import { describe, expect, it } from 'vitest';
import type { WebSource } from '@memora/shared';
import { mergeWebSourcesWithNumbers } from './web-sources.js';

function source(url: string, number?: number): WebSource {
  return {
    id: url,
    url,
    title: url,
    domain: new URL(url).hostname,
    kind: 'search',
    fetchedAt: 1,
    status: 'ok',
    ...(number === undefined ? {} : { number }),
  };
}

describe('web source numbering', () => {
  it('assegna numeri progressivi alle nuove fonti', () => {
    const result = mergeWebSourcesWithNumbers([], [source('https://a.test'), source('https://b.test')]);
    expect(result.incoming.map(item => item.number)).toEqual([1, 2]);
    expect(result.sources.map(item => item.number)).toEqual([1, 2]);
    expect(result.nextNumber).toBe(3);
  });

  it('mantiene il numero di una fonte già citata e aggiunge le nuove', () => {
    const current = [source('https://a.test', 7)];
    const result = mergeWebSourcesWithNumbers(current, [source('https://a.test'), source('https://b.test')], 8);
    expect(result.incoming[0]?.number).toBe(7);
    expect(result.incoming[1]?.number).toBe(8);
    expect(result.sources.find(item => item.url === 'https://a.test')?.number).toBe(7);
    expect(result.nextNumber).toBe(9);
  });

  it('normalizza fonti legacy senza numero', () => {
    const result = mergeWebSourcesWithNumbers([source('https://old.test')], [source('https://new.test')]);
    expect(result.sources.map(item => item.number)).toEqual([1, 2]);
    expect(result.incoming[0]?.number).toBe(2);
  });

  it('non riusa i numeri delle fonti rimosse dal limite', () => {
    const current = Array.from({ length: 50 }, (_, index) => source(`https://example.test/${index}`, index + 1));
    const result = mergeWebSourcesWithNumbers(current, [source('https://new.test')], 51);
    expect(result.incoming[0]?.number).toBe(51);
    expect(result.sources).toHaveLength(50);
    expect(result.sources[0]?.url).toBe('https://example.test/1');
    expect(result.nextNumber).toBe(52);
  });
});
