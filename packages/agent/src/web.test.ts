import { describe, expect, it } from 'vitest';
import { WebService } from './web.js';

const enabled = { enabled: true, provider: 'searxng' as const, maxResults: 5, maxChars: 5000, timeoutMs: 5000, searxngUrl: 'http://127.0.0.1:8080', braveApiKey: '' };

describe('WebService', () => {
  it('rifiuta URL privati e loopback', async () => {
    const service = new WebService(() => enabled);
    await expect(service.fetchPage('http://127.0.0.1/admin')).rejects.toMatchObject({ code: 'private_url' });
    await expect(service.fetchPage('file:///etc/passwd')).rejects.toMatchObject({ code: 'invalid_url' });
  });

  it('rifiuta l’uso quando il web è disabilitato', async () => {
    const service = new WebService(() => ({ ...enabled, enabled: false }));
    await expect(service.search('test')).rejects.toMatchObject({ code: 'web_disabled' });
  });
});
