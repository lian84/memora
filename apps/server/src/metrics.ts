import type { RuntimeMetricsSnapshot } from '@memora/shared';

interface QueueSnapshot {
  queued: number;
  running: number;
  failed: number;
  oldestQueuedAgeMs: number | null;
}

interface InboxSnapshot {
  pending: number;
  conflict: number;
}

/** Metriche aggregate in memoria. Non contengono query, prompt o memorie. */
export class RuntimeMetrics {
  private retrieval = { searches: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0, results: 0, estimatedTokens: 0 };
  private curator = { invoked: 0, completed: 0, declined: 0, failed: 0, invalidJson: 0, timeouts: 0 };

  recordRetrieval(metric: { latencyMs: number; resultCount: number; estimatedTokens: number; error?: string }): void {
    this.retrieval.searches++;
    if (metric.error) this.retrieval.errors++;
    this.retrieval.totalLatencyMs += metric.latencyMs;
    this.retrieval.maxLatencyMs = Math.max(this.retrieval.maxLatencyMs, metric.latencyMs);
    this.retrieval.results += metric.resultCount;
    this.retrieval.estimatedTokens += metric.estimatedTokens;
  }

  recordCurator(event: string): void {
    if (event === 'curator_invoked') this.curator.invoked++;
    else if (event === 'curator_candidate_created') this.curator.completed++;
    else if (event === 'curator_below_threshold' || event === 'curator_duplicate' || event === 'curator_decision_skipped' || event === 'curator_skipped_prefilter') this.curator.declined++;
    else if (event === 'curator_invalid_json') { this.curator.invalidJson++; this.curator.failed++; }
    else if (event === 'curator_timeout') { this.curator.timeouts++; this.curator.failed++; }
    else if (event.endsWith('_failure')) this.curator.failed++;
  }

  snapshot(queue: QueueSnapshot, inbox: InboxSnapshot): RuntimeMetricsSnapshot {
    const alerts: string[] = [];
    if (queue.failed > 0) alerts.push(`${queue.failed} job Curator falliti`);
    if (queue.oldestQueuedAgeMs !== null && queue.oldestQueuedAgeMs > 120_000) alerts.push('Coda Curator bloccata da oltre 2 minuti');
    if (queue.queued > 50) alerts.push('Backlog Curator elevato');
    if (inbox.pending + inbox.conflict > 50) alerts.push('Memory Inbox con molti candidati in attesa');
    if (this.curator.failed > 0) alerts.push('Errori Curator registrati in questa sessione');
    if (this.retrieval.errors > 0) alerts.push('Errori di retrieval registrati in questa sessione');
    return {
      generatedAt: Date.now(),
      retrieval: {
        searches: this.retrieval.searches,
        errors: this.retrieval.errors,
        averageLatencyMs: this.retrieval.searches === 0 ? 0 : this.retrieval.totalLatencyMs / this.retrieval.searches,
        maxLatencyMs: this.retrieval.maxLatencyMs,
        results: this.retrieval.results,
        estimatedTokens: this.retrieval.estimatedTokens,
      },
      curator: { ...this.curator },
      alerts,
    };
  }
}
