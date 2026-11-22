export interface MonitorSettings {
  enabled: boolean;
  notifyTelegram: boolean;
  diskWarningPercent: number;
  diskCriticalPercent: number;
  backupMaxAgeDays: number;
}

export type MonitorAlertSeverity = 'warning' | 'critical';

export interface MonitorAlert {
  key: string;
  severity: MonitorAlertSeverity;
  title: string;
  detail: string;
  active: boolean;
  since: number;
  lastNotifiedAt?: number;
}

export interface MonitorStatus {
  settings: MonitorSettings;
  checkedAt?: number;
  alerts: MonitorAlert[];
  error?: string;
  disk: {
    available: boolean;
    percent: number | null;
  };
}
