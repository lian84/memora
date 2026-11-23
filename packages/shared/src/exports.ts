export interface DataExportRecord {
  id: string;
  filename: string;
  createdAt: number;
  size: number;
  appVersion: string;
}

export interface DataExportStatus {
  localDir: string;
  exports: DataExportRecord[];
}
