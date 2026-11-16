import { describe, expect, it } from 'vitest';
import { RuntimeMetrics } from './metrics.js';

describe('RuntimeMetrics', () => {
  it('aggrega retrieval e Curator senza contenuti', () => {
    const metrics = new RuntimeMetrics();
    metrics.recordRetrieval({ latencyMs: 10, resultCount: 2, estimatedTokens: 30 });
    metrics.recordRetrieval({ latencyMs: 30, resultCount: 0, estimatedTokens: 0, error: 'retrieval_failed' });
    metrics.recordCurator('curator_invoked');
    metrics.recordCurator('curator_candidate_created');
    metrics.recordCurator('curator_below_threshold');
    metrics.recordCurator('curator_timeout');
    const snapshot = metrics.snapshot({ queued: 2, running: 0, failed: 1, oldestQueuedAgeMs: 130_000 }, { pending: 60, conflict: 2 });
    expect(snapshot.retrieval).toMatchObject({ searches: 2, errors: 1, averageLatencyMs: 20, maxLatencyMs: 30, results: 2, estimatedTokens: 30 });
    expect(snapshot.curator).toMatchObject({ invoked: 1, completed: 1, declined: 1, failed: 1, timeouts: 1 });
    expect(snapshot.alerts.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(snapshot)).not.toContain('query');
  });
});
