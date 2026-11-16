/**
 * Calcola la selezione dopo una cancellazione riuscita.
 * Una sessione diversa da quella selezionata non deve cambiare la chat aperta.
 */
export function selectedSessionAfterDelete(
  selectedSessionId: string | null,
  deletedSessionId: string,
): string | null {
  return selectedSessionId === deletedSessionId ? null : selectedSessionId;
}
