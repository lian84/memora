import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listSessions,
  createSession,
  getSessionMessages,
  resumeSession,
  setSessionModel,
  renameSession,
  setSessionArchived,
  deleteSession,
  type SessionInfo,
  type ChatMessage,
} from '../lib/api';

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function useSessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentFilterRef = useRef(false);
  const latestLoadRef = useRef(0);

  /**
   * Carica una sola vista alla volta. Le risposte vecchie non possono
   * sovrascrivere la vista richiesta più recentemente (ad esempio dopo il
   * passaggio attive/archiviate).
   */
  const load = useCallback(async (onlyArchived = currentFilterRef.current): Promise<boolean> => {
    const previousFilter = currentFilterRef.current;
    currentFilterRef.current = onlyArchived;
    const loadId = ++latestLoadRef.current;

    if (previousFilter !== onlyArchived) setSessions([]);
    setLoading(true);
    setError(null);
    try {
      const data = await listSessions(onlyArchived);
      if (loadId !== latestLoadRef.current) return false;
      setSessions(data);
      return true;
    } catch (err) {
      if (loadId === latestLoadRef.current) {
        setError(asError(err).message);
      }
      return false;
    } finally {
      if (loadId === latestLoadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async (modelId?: string, provider?: import('@memora/shared').ProviderId, reasoningLevel?: import('@memora/shared').ReasoningLevel, projectId?: string) => {
    setError(null);
    const result = await createSession(modelId, provider, reasoningLevel, projectId);
    await load();
    return result;
  }, [load]);

  const getMessages = useCallback(
    async (sessionId: string): Promise<ChatMessage[]> => {
      setError(null);
      try {
        return await getSessionMessages(sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return [];
      }
    },
    [],
  );

  const resume = useCallback(
    async (sessionId: string): Promise<{ sessionId: string; modelId: string; provider?: import('@memora/shared').ProviderId; reasoningLevel?: import('@memora/shared').ReasoningLevel }> => {
      setError(null);
      const result = await resumeSession(sessionId);
      await load();
      return result;
    },
    [load],
  );

  const changeModel = useCallback(
    async (sessionId: string, modelId: string) => {
      setError(null);
      await setSessionModel(sessionId, modelId);
    },
    [],
  );

  const rename = useCallback(
    async (sessionId: string, name: string) => {
      setError(null);
      try {
        await renameSession(sessionId, name);
        await load();
      } catch (err) {
        const error = asError(err);
        setError(error.message);
        throw error;
      }
    },
    [load],
  );

  const archive = useCallback(
    async (sessionId: string, archived: boolean) => {
      setError(null);
      try {
        await setSessionArchived(sessionId, archived);
        const refreshed = await load();
        if (!refreshed && archived !== currentFilterRef.current) {
          setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
        }
      } catch (err) {
        const error = asError(err);
        setError(error.message);
        throw error;
      }
    },
    [load],
  );

  const remove = useCallback(
    async (sessionId: string) => {
      setError(null);
      try {
        // La lista viene ricaricata solo dopo una risposta DELETE valida. In
        // caso di errore la promessa fallisce e il dialog di conferma resta
        // aperto: la UI non può fingere che la sessione sia stata eliminata.
        const result = await deleteSession(sessionId);
        if (result.sessionId !== sessionId || !result.deleted) {
          throw new Error('La cancellazione della sessione non è stata confermata dal server');
        }

        const refreshed = await load();
        // Se il DELETE è riuscito ma il refresh fallisce, rimuoviamo comunque
        // l'elemento locale per evitare di mostrare uno stato sicuramente stale.
        // Un successivo refresh leggerà la fonte autorevole JSONL dal backend.
        if (!refreshed) {
          setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
        }
      } catch (err) {
        const error = asError(err);
        setError(error.message);
        throw error;
      }
    },
    [load],
  );

  return {
    sessions,
    loading,
    error,
    load,
    create,
    getMessages,
    resume,
    changeModel,
    rename,
    archive,
    remove,
  };
}
