import { useEffect, useState } from 'react';
import type { WebSettingsView } from '@memora/shared';
import { getAdminWebSettings, testAdminWebSearch, updateAdminWebSettings } from '../lib/api';
import { useI18n } from '../i18n';

export function WebSettingsPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<WebSettingsView | null>(null);
  const [braveApiKey, setBraveApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAdminWebSettings()
      .then(value => { if (!cancelled) setSettings(value); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  const patch = (value: Partial<WebSettingsView>) => setSettings(current => current ? { ...current, ...value } : current);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateAdminWebSettings({
        enabled: settings.enabled,
        provider: settings.provider,
        maxResults: settings.maxResults,
        maxChars: settings.maxChars,
        timeoutMs: settings.timeoutMs,
        searxngUrl: settings.searxngUrl,
        ...(braveApiKey.trim() ? { braveApiKey: braveApiKey.trim() } : {}),
      });
      setSettings(next);
      setBraveApiKey('');
      setNotice(t('Impostazioni web salvate.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const results = await testAdminWebSearch();
      setNotice(t('Connessione web riuscita: {count} risultati.', { count: results.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  if (!settings) return <div className="admin-card">{error ?? t('Caricamento impostazioni web…')}</div>;

  return (
    <section className="admin-card">
      <h3>{t('Ricerca web')}</h3>
      <p className="admin-card-description">{t('La ricerca web è disattivata per impostazione predefinita. Le chiavi restano nel secret store locale e non vengono mai restituite.')}</p>
      <label className="admin-toggle">
        <input type="checkbox" checked={settings.enabled} onChange={event => patch({ enabled: event.target.checked })} />
        <span>{t('Abilita accesso web')}</span>
      </label>
      <div className="admin-grid-2">
        <label className="admin-label">{t('Provider')}
          <select value={settings.provider} onChange={event => patch({ provider: event.target.value as WebSettingsView['provider'] })}>
            <option value="brave">Brave Search</option>
            <option value="searxng">SearXNG</option>
          </select>
        </label>
        <label className="admin-label">{t('Timeout (ms)')}
          <input type="number" min={2000} max={60000} step={1000} value={settings.timeoutMs} onChange={event => patch({ timeoutMs: Number(event.target.value) })} />
        </label>
        <label className="admin-label">{t('Risultati massimi')}
          <input type="number" min={1} max={10} value={settings.maxResults} onChange={event => patch({ maxResults: Number(event.target.value) })} />
        </label>
        <label className="admin-label">{t('Caratteri massimi per pagina')}
          <input type="number" min={1000} max={50000} step={1000} value={settings.maxChars} onChange={event => patch({ maxChars: Number(event.target.value) })} />
        </label>
      </div>
      {settings.provider === 'brave' ? (
        <label className="admin-label">{t('Brave Search API key')}
          <input type="password" autoComplete="new-password" value={braveApiKey} onChange={event => setBraveApiKey(event.target.value)} placeholder={settings.braveConfigured ? t('Configurata — inserisci una nuova chiave per sostituirla') : t('Inserisci API key')} />
          <small>{settings.braveConfigured ? t('Credenziale già configurata.') : t('Serve un account Brave Search API.')}</small>
        </label>
      ) : (
        <label className="admin-label">{t('URL SearXNG')}
          <input value={settings.searxngUrl} onChange={event => patch({ searxngUrl: event.target.value })} placeholder="http://127.0.0.1:8080" />
          <small>{t('Istanza SearXNG raggiungibile dal server con formato JSON abilitato.')}</small>
        </label>
      )}
      {notice && <div className="admin-alert is-success">{notice}</div>}
      {error && <div className="admin-alert is-error" role="alert">{error}</div>}
      <div className="admin-actions">
        <button type="button" className="admin-primary" onClick={() => void save()} disabled={saving}>{saving ? t('Salvo…') : t('Salva impostazioni web')}</button>
        <button type="button" onClick={() => void test()} disabled={testing || saving}>{testing ? t('Verifico…') : t('Test connessione')}</button>
      </div>
    </section>
  );
}
