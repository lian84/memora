import { useCallback, useEffect, useMemo, useState } from 'react';
import { MCP_SERVER_DEFINITIONS, type McpAccount, type McpServerId, type McpSessionSettings, type ProjectRecord } from '@memora/shared';
import { getSessionMcp, listMcpAccounts, setSessionMcp } from '../lib/api';
import { useI18n } from '../i18n';
import { AppIcon } from './AppIcon';
import { ConfirmDialog } from './ConfirmDialog';

interface McpPanelProps {
  sessionId: string;
  project?: ProjectRecord | null;
}

export function McpPanel({ sessionId, project = null }: McpPanelProps) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<McpAccount[]>([]);
  const [settings, setSettings] = useState<McpSessionSettings>({ enabled: [], accounts: {}, allowWrites: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<McpServerId | null>(null);
  const [writeSaving, setWriteSaving] = useState(false);
  const [writeConfirmOpen, setWriteConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextAccounts, nextSettings] = await Promise.all([listMcpAccounts(project?.id), getSessionMcp(sessionId)]);
      setAccounts(nextAccounts.filter(account => account.scope === 'global' || (project?.id && account.projectId === project.id)));
      setSettings(nextSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [project?.id, sessionId]);

  useEffect(() => { void load(); }, [load]);

  const accountsByServer = useMemo(() => {
    const map = new Map<McpServerId, McpAccount[]>();
    for (const server of MCP_SERVER_DEFINITIONS) map.set(server.id, accounts.filter(account => account.serverId === server.id));
    return map;
  }, [accounts]);

  const toggle = async (serverId: McpServerId) => {
    setSaving(serverId);
    setError(null);
    try {
      const enabled = settings.enabled.includes(serverId)
        ? settings.enabled.filter(server => server !== serverId)
        : [...settings.enabled, serverId];
      setSettings(await setSessionMcp(sessionId, enabled, settings.allowWrites === true));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  const setWrites = async (allowWrites: boolean) => {
    setWriteSaving(true);
    setError(null);
    try {
      setSettings(await setSessionMcp(sessionId, settings.enabled, allowWrites));
      setWriteConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriteSaving(false);
    }
  };

  const accountFor = (serverId: McpServerId): McpAccount | undefined => {
    const candidates = accountsByServer.get(serverId) ?? [];
    const selected = settings.accounts[serverId] ?? project?.mcpAccounts?.[serverId];
    return candidates.find(account => account.id === selected)
      ?? candidates.find(account => account.defaultForServer)
      ?? candidates[0];
  };

  return (
    <div className="mcp-panel">
      <div className="mcp-panel-intro">
        <h3>{t('Server MCP')}</h3>
        <p>{t('I server sono disattivati per impostazione predefinita. Attiva solo quelli che servono in questa chat.')}</p>
      </div>
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {loading && <div className="admin-field-note">{t('Caricamento…')}</div>}
      {!loading && (
        <div className="mcp-server-list">
          {MCP_SERVER_DEFINITIONS.map(server => {
            const account = accountFor(server.id);
            const enabled = settings.enabled.includes(server.id);
            return (
              <div className={`mcp-server-row${enabled ? ' is-enabled' : ''}`} key={server.id}>
                <span className="mcp-server-icon"><AppIcon name={server.id === 'notion' ? 'book' : 'chart'} size={17} /></span>
                <div className="mcp-server-copy">
                  <strong>{server.label}</strong>
                  <span>{account ? `${account.label}${account.defaultForServer ? ` · ${t('predefinito')}` : ''}` : t('Nessun account configurato')}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={enabled ? t('Disattiva {server}', { server: server.label }) : t('Attiva {server}', { server: server.label })}
                  className={`mcp-toggle${enabled ? ' is-on' : ''}`}
                  disabled={Boolean(saving) || !account || account.configured === false}
                  onClick={() => void toggle(server.id)}
                >
                  <span />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className={`mcp-write-setting${settings.allowWrites ? ' is-enabled' : ''}`}>
        <div>
          <strong>{t('Consenti scritture')}</strong>
          <small>{settings.allowWrites ? t('L’agente può modificare i dati nei servizi attivi.') : t('Lettura soltanto. Le scritture sono disabilitate.')}</small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.allowWrites === true}
          aria-label={t('Consenti scritture')}
          className={`mcp-toggle${settings.allowWrites ? ' is-on' : ''}`}
          disabled={writeSaving || loading || settings.enabled.length === 0}
          onClick={() => { setError(null); if (settings.allowWrites) void setWrites(false); else setWriteConfirmOpen(true); }}
        >
          <span />
        </button>
      </div>
      <p className="mcp-panel-note">{t('Le modifiche valgono dal prossimo messaggio. Per eliminazioni o modifiche distruttive l’agente deve chiedere conferma.')}</p>
      {writeConfirmOpen && (
        <ConfirmDialog
          title={t('Abilitare le scritture MCP?')}
          confirmLabel={t('Abilita scritture')}
          busyLabel={t('Abilitazione…')}
          busy={writeSaving}
          error={error}
          onClose={() => { if (!writeSaving) setWriteConfirmOpen(false); }}
          onConfirm={() => void setWrites(true)}
        >
          <p>{t('Da questo momento l’agente può creare, modificare o eliminare contenuti in Notion e Todoist, in base ai tool esposti dai server attivi. Usa questa opzione solo quando necessario.')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
