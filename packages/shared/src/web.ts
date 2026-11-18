export type WebProvider = 'brave' | 'searxng';

export interface WebSettings {
  enabled: boolean;
  provider: WebProvider;
  maxResults: number;
  maxChars: number;
  timeoutMs: number;
  searxngUrl: string;
}

export interface WebConfig extends WebSettings {
  braveApiKey: string;
}

export interface WebSettingsView extends WebSettings {
  braveConfigured: boolean;
}

export interface WebSource {
  id: string;
  url: string;
  title: string;
  domain: string;
  kind: 'page' | 'pdf' | 'search';
  query?: string;
  snippet?: string;
  fetchedAt: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSessionSettings {
  enabled: boolean;
}
