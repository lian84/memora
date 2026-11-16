import { useCallback, useState, useRef, useEffect } from 'react';
import {
  sendMessage as sendMessageAPI,
  editMessage as editMessageAPI,
  abortSession,
} from '../lib/api';

export function useSSE(sessionId: string | null) {
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
    };
  }, []);

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      setIsStreaming(false);
    }
    // Notifica anche il backend per fermare l'agent
    if (sessionId) {
      void abortSession(sessionId).catch(() => {});
    }
  }, [sessionId]);

  const sendMessage = useCallback(
    async (
      text: string,
      onEvent: (event: {
        type: string;
        sessionId: string;
        timestamp: number;
        payload: unknown;
      }) => void,
      attachmentIds: string[] = [],
    ): Promise<void> => {
      if (!sessionId) throw new Error('Nessuna sessione selezionata');

      const controller = new AbortController();
      controllerRef.current = controller;
      setIsStreaming(true);

      try {
        await sendMessageAPI(sessionId, text, (event) => {
          if (controller.signal.aborted) {
            throw new Error('streaming interrotto dall\'utente');
          }
          onEvent(event);
        }, attachmentIds);
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [sessionId],
  );

  const editMessage = useCallback(
    async (
      entryId: string,
      text: string,
      onEvent: (event: { type: string; sessionId: string; timestamp: number; payload: unknown }) => void,
    ): Promise<void> => {
      if (!sessionId) throw new Error('Nessuna sessione selezionata');
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsStreaming(true);
      try {
        await editMessageAPI(sessionId, entryId, text, (event) => {
          if (controller.signal.aborted) throw new Error('streaming interrotto dall\'utente');
          onEvent(event);
        });
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [sessionId],
  );

  return { sendMessage, editMessage, abort, isStreaming };
}
