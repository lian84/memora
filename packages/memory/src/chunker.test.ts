import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from './chunker.js';

describe('structured memory chunking', () => {
  it('separa bullet autonomi e mantiene heading e linee di origine', () => {
    const input = '## Preferenze\n\n- Preferisce Tailscale.\n- Preferisce risposte concise.\n';
    const chunks = chunkMarkdown(input, { splitStandaloneBullets: true });
    expect(chunks).toEqual([
      { chunkIndex: 0, heading: 'Preferenze', startLine: 3, endLine: 3, content: '## Preferenze\n- Preferisce Tailscale.' },
      { chunkIndex: 1, heading: 'Preferenze', startLine: 4, endLine: 4, content: '## Preferenze\n- Preferisce risposte concise.' },
    ]);
  });

  it('mantiene aggregati documenti normali, prosa, sottoliste e codice', () => {
    const lists = '## Preferenze\n\n- Uno.\n- Due.\n';
    expect(chunkMarkdown(lists)).toHaveLength(1);
    for (const input of [
      '## Note\n\nUna frase.\n\n- Uno.\n- Due.',
      '## Note\n\n- Uno.\n  - Dettaglio.\n- Due.',
      '## Note\n\n```text\n- Uno.\n- Due.\n```',
      '## Note\n\n- Uno.\n  continuazione\n- Due.',
    ]) {
      expect(chunkMarkdown(input, { splitStandaloneBullets: true })).toHaveLength(1);
    }
  });
});
