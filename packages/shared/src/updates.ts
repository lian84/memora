export interface UpdateSettings {
  enabled: boolean;
  notifyTelegram: boolean;
}

export interface UpdateStatus {
  currentVersion: string;
  repository: string;
  enabled: boolean;
  notifyTelegram: boolean;
  updateAvailable: boolean;
  /** Il pulsante Aggiorna ora è disponibile solo se l'update helper è installato. */
  applyAvailable: boolean;
  requestedAt?: number;
  checkedAt?: number;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  notes?: string;
  error?: string;
}
