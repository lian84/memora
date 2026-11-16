import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { MemoryCandidate } from '@memora/shared';
import { MemoryCandidateProvenance } from './MemoryInbox';

const candidate: MemoryCandidate = {
  id: 'candidate-1',
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000,
  sessionId: 'session-1234567890',
  sourceMessageId: 'message-1234567890',
  sourceTimestamp: 1_759_999_000_000,
  category: 'project',
  heading: 'Database',
  proposedText: 'Il progetto Vega usa PostgreSQL.',
  rationale: 'Fatto stabile.',
  status: 'pending',
  targetPath: 'projects/vega/memory.md',
  origin: 'automatic',
  priority: 'normal',
  curatorProvider: 'opencode-go',
  curatorModel: 'deepseek-v4.1-flash',
};

describe('Memory Inbox provenance', () => {
  test('mostra sessione, messaggio, timestamp e modello Curator', () => {
    const markup = renderToStaticMarkup(<MemoryCandidateProvenance candidate={candidate} />);
    expect(markup).toContain('Stato:');
    expect(markup).toContain('Creazione candidato:');
    expect(markup).toContain('Messaggio originale:');
    expect(markup).toContain('Sessione:');
    expect(markup).toContain('Messaggio:');
    expect(markup).toContain('OpenCode Go / deepseek-v4.1-flash');
    expect(markup).toContain('session-1234567890');
    expect(markup).toContain('title="session-1234567890"');
  });
});
