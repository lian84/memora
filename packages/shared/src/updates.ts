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
  checkedAt?: number;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  notes?: string;
  error?: string;
}
