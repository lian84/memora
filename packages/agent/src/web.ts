import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { PDFParse } from 'pdf-parse';
import type { WebConfig, WebSearchResult, WebSource } from '@memora/shared';

const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_QUERY_CHARS = 500;

export class WebError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WebError';
  }
}

export interface WebFetchResult {
  source: WebSource;
  text: string;
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 0) ||
      (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
      (parts[0] === 203 && parts[1] === 0 && parts[2] === 113);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
  }
  return true;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new WebError('invalid_url', 'URL non valido'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebError('invalid_url', 'Sono consentiti solo URL HTTP/HTTPS');
  if (url.username || url.password) throw new WebError('invalid_url', 'URL con credenziali non consentito');
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new WebError('private_url', 'URL privato non consentito');
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some(item => isPrivateIp(item.address))) throw new WebError('private_url', 'URL privato non consentito');
  return url;
}

function domainOf(raw: string): string {
  try { return new URL(raw).hostname; } catch { return ''; }
}

function sourceId(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function cleanSnippet(value: unknown): string {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function readLimited(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new WebError('response_too_large', 'Pagina troppo grande');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

function htmlToText(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (article?.textContent?.trim()) return article.textContent.replace(/\s+/g, ' ').trim();
  return dom.window.document.body?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Client web minimale: solo ricerca e lettura, senza browser o sessione. */
export class WebService {
  constructor(private readonly getConfig: () => WebConfig) {}

  private config(): WebConfig {
    const config = this.getConfig();
    if (!config.enabled) throw new WebError('web_disabled', 'Accesso web non abilitato');
    return config;
  }

  async search(query: string): Promise<WebSearchResult[]> {
    const config = this.config();
    const clean = query.trim().slice(0, MAX_QUERY_CHARS);
    if (!clean) throw new WebError('empty_query', 'Query vuota');
    if (config.provider === 'brave') {
      if (!config.braveApiKey) throw new WebError('web_not_configured', 'API key Brave non configurata');
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(clean)}&count=${config.maxResults}`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': config.braveApiKey, 'User-Agent': 'Memora/0.1' },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) throw new WebError('search_failed', `Ricerca non riuscita (${response.status})`);
      const data = await response.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
      return (data.web?.results ?? []).slice(0, config.maxResults).map(item => ({ title: cleanSnippet(item.title), url: item.url ?? '', snippet: cleanSnippet(item.description) })).filter(item => item.url);
    }
    const base = config.searxngUrl.trim().replace(/\/+$/, '');
    if (!base) throw new WebError('web_not_configured', 'URL SearXNG non configurato');
    const response = await fetch(`${base}/search?q=${encodeURIComponent(clean)}&format=json`, { headers: { Accept: 'application/json', 'User-Agent': 'Memora/0.1' }, signal: AbortSignal.timeout(config.timeoutMs) });
    if (!response.ok) throw new WebError('search_failed', `Ricerca non riuscita (${response.status})`);
    const data = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results ?? []).slice(0, config.maxResults).map(item => ({ title: cleanSnippet(item.title), url: item.url ?? '', snippet: cleanSnippet(item.content) })).filter(item => item.url);
  }

  async fetchPage(rawUrl: string, query?: string): Promise<WebFetchResult> {
    const config = this.config();
    const initial = await assertPublicUrl(rawUrl);
    let url = initial;
    let response: Response | null = null;
    for (let redirect = 0; redirect < 4; redirect++) {
      response = await fetch(url, {
        headers: { Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.1', 'User-Agent': 'Memora/0.1' },
        redirect: 'manual',
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;
        url = await assertPublicUrl(new URL(location, url).toString());
        continue;
      }
      break;
    }
    if (!response) throw new WebError('fetch_failed', 'Pagina non disponibile');
    if (!response.ok) throw new WebError('fetch_failed', `Pagina non disponibile (${response.status})`);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const buffer = await readLimited(response);
    let text = '';
    let kind: WebSource['kind'] = 'page';
    if (contentType.includes('application/pdf') || url.pathname.toLowerCase().endsWith('.pdf')) {
      kind = 'pdf';
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try { text = (await parser.getText()).text; } finally { await parser.destroy().catch(() => undefined); }
    } else if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      text = htmlToText(buffer.toString('utf8'), url.toString());
    } else if (contentType.includes('text/plain') || contentType.includes('application/json') || contentType.includes('text/')) {
      text = buffer.toString('utf8');
    } else {
      throw new WebError('unsupported_content', 'Tipo di contenuto non supportato');
    }
    const source: WebSource = {
      id: sourceId(url.toString()),
      url: url.toString(),
      title: cleanSnippet(url.hostname + url.pathname).slice(0, 200),
      domain: domainOf(url.toString()),
      kind,
      ...(query ? { query } : {}),
      fetchedAt: Date.now(),
      status: 'ok',
    };
    return { source, text: text.replace(/\s+/g, ' ').trim().slice(0, config.maxChars) };
  }
}
