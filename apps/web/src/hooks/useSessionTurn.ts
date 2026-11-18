import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizePiContent } from '@memora/shared';
import {
  abortTurn as abortTurnApi,
  getCurrentTurn,
  startTurn as startTurnApi,
  type SSEEvent,
  type TurnInfo,
  type TurnStatus,
} from '../lib/api';

interface TurnEvent {
  type: string;
  payload: unknown;
  seq?: number;
}

function getTextDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const assistantMessageEvent = (payload as { assistantMessageEvent?: unknown }).assistantMessageEvent;
  if (!assistantMessageEvent || typeof assistantMessageEvent !== 'object') return '';
  const event = assistantMessageEvent as { type?: unknown; delta?: unknown };
  return event.type === 'text_delta' && typeof event.delta === 'string'
    ? normalizePiContent([{ type: 'text', text: event.delta }])
    : '';
}

function parseTurnEvent(data: string): TurnEvent | null {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return null;
    const event = value as TurnEvent;
    return typeof event.type === 'string' ? event : null;
  } catch {
    return null;
  }
}

interface UseSessionTurnOptions {
  onEvent?: (event: SSEEvent) => void;
  onComplete?: (turn: TurnInfo) => void;
}

export function useSessionTurn(sessionId: string | null, options: UseSessionTurnOptions = {}) {
  const [turn, setTurn] = useState<TurnInfo | null>(null);
  const [content, setContent] = useState('');
  const turnRef = useRef<TurnInfo | null>(null);
  const seqRef = useRef(0);
  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const onEventRef = useRef(options.onEvent);
  const onCompleteRef = useRef(options.onComplete);
  onEventRef.current = options.onEvent;
  onCompleteRef.current = options.onComplete;

  const closeSource = useCallback(() => {
    if (retryRef.current !== null) {
      window.clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const attach = useCallback((nextTurn: TurnInfo, after = 0) => {
    if (typeof window === 'undefined') return;
    closeSource();
    if (nextTurn.status === 'completed' || nextTurn.status === 'failed' || nextTurn.status === 'aborted') {
      setTurn(nextTurn);
      turnRef.current = nextTurn;
      return;
    }
    stoppedRef.current = false;
    seqRef.current = after;
    const source = new EventSource(`/api/sessions/${encodeURIComponent(nextTurn.sessionId)}/turns/${encodeURIComponent(nextTurn.turnId)}/events?after=${after}`);
    sourceRef.current = source;
    source.onmessage = event => {
      const parsed = parseTurnEvent(event.data);
      if (!parsed) return;
      if (typeof parsed.seq === 'number') seqRef.current = parsed.seq;
      const delta = parsed.type === 'message_update' ? getTextDelta(parsed.payload) : '';
      if (delta) setContent(current => current + delta);
      if (parsed.type === 'turn_status') {
        const status = (parsed.payload as { status?: unknown } | null)?.status;
        if (status === 'queued' || status === 'running' || status === 'completed' || status === 'failed' || status === 'aborted') {
          const updated = { ...nextTurn, status: status as TurnStatus, updatedAt: Date.now() };
          turnRef.current = updated;
          setTurn(updated);
        }
      }
      if (parsed.type === 'turn_complete') {
        const status = (parsed.payload as { status?: unknown } | null)?.status;
        const completed = { ...nextTurn, status: (status === 'failed' || status === 'aborted' ? status : 'completed') as TurnStatus, updatedAt: Date.now() };
        turnRef.current = completed;
        setTurn(completed);
        closeSource();
        onCompleteRef.current?.(completed);
      }
      onEventRef.current?.({ type: parsed.type, sessionId: nextTurn.sessionId, timestamp: Date.now(), payload: parsed.payload });
    };
    source.onerror = () => {
      if (stoppedRef.current) return;
      source.close();
      sourceRef.current = null;
      const current = turnRef.current;
      if (!current || current.status === 'completed' || current.status === 'failed' || current.status === 'aborted') return;
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        void getCurrentTurn(nextTurn.sessionId).then(latest => {
          if (latest && (latest.status === 'running' || latest.status === 'queued')) attach(latest, seqRef.current);
        }).catch(() => undefined);
      }, 1500);
    };
  }, [closeSource]);

  useEffect(() => {
    stoppedRef.current = true;
    closeSource();
    setTurn(null);
    turnRef.current = null;
    seqRef.current = 0;
    setContent('');
    if (!sessionId) return;
    let cancelled = false;
    stoppedRef.current = false;
    void getCurrentTurn(sessionId).then(latest => {
      if (cancelled || !latest) return;
      turnRef.current = latest;
      setTurn(latest);
      if (latest.status === 'running' || latest.status === 'queued') attach(latest, 0);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      stoppedRef.current = true;
      closeSource();
    };
  }, [attach, closeSource, sessionId]);

  const sync = useCallback(async () => {
    if (!sessionId) return;
    const latest = await getCurrentTurn(sessionId);
    if (!latest) return;
    if (turnRef.current?.turnId !== latest.turnId) {
      seqRef.current = 0;
      setContent('');
    }
    turnRef.current = latest;
    setTurn(latest);
    if (latest.status === 'running' || latest.status === 'queued') attach(latest, seqRef.current);
  }, [attach, sessionId]);

  const start = useCallback(async (text: string, attachmentIds: string[] = []) => {
    if (!sessionId) throw new Error('Nessuna chat attiva');
    const next = await startTurnApi(sessionId, text, attachmentIds);
    turnRef.current = next;
    seqRef.current = 0;
    setContent('');
    setTurn(next);
    attach(next, 0);
    return next;
  }, [attach, sessionId]);

  const abort = useCallback(async () => {
    const current = turnRef.current;
    if (!sessionId || !current) return;
    const updated = await abortTurnApi(sessionId, current.turnId);
    turnRef.current = updated;
    setTurn(updated);
  }, [sessionId]);

  return { turn, content, start, sync, abort, isActive: turn?.status === 'running' || turn?.status === 'queued' };
}
