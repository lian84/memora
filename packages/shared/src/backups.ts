export type BackupFrequency = 'daily' | 'weekly';
export type BackupTrigger = 'manual' | 'automatic';

export interface BackupSchedule {
  enabled: boolean;
  frequency: BackupFrequency;
  /** Giorno della settimana per frequency=weekly (0=domenica). */
  weekday: number;
  /** Ora locale nel formato HH:MM. */
  time: string;
  timezone: string;
  /** Numero di copie locali da conservare. */
  retention: number;
}

export interface BackupRecord {
  id: string;
  archiveName: string;
  createdAt: number;
  size: number;
  sha256: string;
  encrypted: boolean;
  appVersion: string;
  trigger: BackupTrigger;
}

export interface BackupStatus {
  passwordConfigured: boolean;
  maintenance: boolean;
  busy: boolean;
  localDir: string;
  schedule: BackupSchedule;
  nextRunAt?: number;
  backups: BackupRecord[];
  lastBackup?: BackupRecord;
}

export interface BackupRemoteStatus {
  rcloneAvailable: boolean;
  configured: boolean;
  remoteName?: string;
  folder?: string;
  autoUpload: boolean;
  busy: boolean;
  lastUploadAt?: number;
  lastUploadName?: string;
  lastError?: string;
}

export interface BackupRemoteInput {
  remoteName: string;
  email: string;
  password: string;
  twoFactor?: string;
  folder: string;
  autoUpload?: boolean;
}
