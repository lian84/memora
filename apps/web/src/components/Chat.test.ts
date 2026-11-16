import { describe, expect, it } from 'vitest';
import { appendOptimisticTurn, updateStreamingPlaceholder, type DisplayChatMessage } from './Chat';

const history: DisplayChatMessage[] = [
  { id: 'old-user', role: 'user', content: 'precedente', timestamp: 1 },
  { id: 'old-assistant', role: 'assistant', content: 'risposta precedente', timestamp: 2 },
];

describe('streaming chat message order', () => {
  it('inserisce user e placeholder assistant nello stesso aggiornamento, nell’ordine conversazionale', () => {
    const result = appendOptimisticTurn(history, 'che giorno è oggi?', 'stream-1', 3);
    expect(result.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(result.slice(-2)).toEqual([
      expect.objectContaining({ id: 'user-stream-1', role: 'user', content: 'che giorno è oggi?' }),
      expect.objectContaining({ id: 'stream-1', role: 'assistant', content: '', streaming: true }),
    ]);
  });

  it('aggiorna in place il placeholder con text_delta senza aggiungere messaggi', () => {
    const pending = appendOptimisticTurn(history, 'domanda', 'stream-1', 3);
    const updated = updateStreamingPlaceholder(pending, 'stream-1', 'Oggi è', true);
    expect(updated).toHaveLength(pending.length);
    expect(updated.at(-1)).toEqual(expect.objectContaining({ id: 'stream-1', content: 'Oggi è', streaming: true }));
  });

  it('mantiene il placeholder dopo il messaggio user, mai sopra la conversazione', () => {
    const result = appendOptimisticTurn([], 'ordine corretto', 'stream-1', 100);
    expect(result[0].id).toBe('user-stream-1');
    expect(result[1].id).toBe('stream-1');
  });

  it('agent_end finalizza lo stesso placeholder senza duplicare assistant', () => {
    const pending = appendOptimisticTurn(history, 'domanda', 'stream-1', 3);
    const completed = updateStreamingPlaceholder(pending, 'stream-1', 'risposta completa', false);
    expect(completed).toHaveLength(4);
    expect(completed.filter((message) => message.role === 'assistant')).toHaveLength(2);
    expect(completed.at(-1)).toEqual(expect.objectContaining({ id: 'stream-1', content: 'risposta completa', streaming: false }));
  });

  it('conserva gli allegati sul messaggio utente ottimistico', () => {
    const result = appendOptimisticTurn([], 'guarda', 'stream-1', 3, [
      { id: 'a1', filename: 'nota.md', mimeType: 'text/markdown', size: 10, kind: 'text' },
    ]);
    expect(result[0].attachments).toEqual([
      expect.objectContaining({ id: 'a1', filename: 'nota.md', kind: 'text' }),
    ]);
  });

  it('non riordina messaggi con timestamp uguale e conserva l’ordine storico/streaming', () => {
    const result = appendOptimisticTurn(history, 'domanda', 'stream-1', 2);
    expect(result.map((message) => message.id)).toEqual(['old-user', 'old-assistant', 'user-stream-1', 'stream-1']);
  });
});
