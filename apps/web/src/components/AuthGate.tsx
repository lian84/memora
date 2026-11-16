import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getAuthStatus, login as loginRequest, logout as logoutRequest, setupPassword, type AuthStatus } from '../lib/api';
import { useI18n } from '../i18n';

interface AuthContextValue {
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth deve essere usato dentro AuthGate');
  return value;
}

function AuthScreen({ mode, onAuthenticated }: { mode: 'login' | 'setup'; onAuthenticated: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSetup = mode === 'setup';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (isSetup && password !== confirmation) {
      setError(t('Le password non coincidono.'));
      return;
    }
    if (password.length < 12) {
      setError(t('La password deve avere almeno 12 caratteri.'));
      return;
    }
    setBusy(true);
    try {
      if (isSetup) await setupPassword(password);
      else await loginRequest(password);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="auth-mark" aria-hidden="true">M</span>
          <div>
            <strong>{t('Memora')}</strong>
            <span>{t('assistente personale')}</span>
          </div>
        </div>
        <span className="admin-eyebrow">{t(isSetup ? 'Primo accesso' : 'Accesso protetto')}</span>
        <h1 id="auth-title">{t(isSetup ? 'Crea la password di Memora' : 'Bentornato')}</h1>
        <p>
          {t(isSetup
            ? 'La prima password impostata protegge tutte le chat, la memoria e le impostazioni. Sceglila ora e conservala in un posto sicuro.'
            : 'Inserisci la password per accedere a Memora e alla memoria di Memo.')}
        </p>
        <form onSubmit={event => void submit(event)}>
          <label className="admin-label">Password
            <input
              type="password"
              autoFocus
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={busy}
              minLength={12}
              required
            />
          </label>
          {isSetup && (
            <label className="admin-label">Conferma password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={event => setConfirmation(event.target.value)}
                disabled={busy}
                minLength={12}
                required
              />
            </label>
          )}
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? t('Verifico…') : isSetup ? t('Imposta password e entra') : t('Accedi')}
          </button>
        </form>
        <small className="auth-hint">{t('Sessione valida per 24 ore. Nessun nome utente: Memora è personale.')}</small>
      </section>
    </main>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getAuthStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    const onExpired = () => setStatus(current => current ? { ...current, authenticated: false } : { setupRequired: false, authenticated: false });
    window.addEventListener('memora-auth-expired', onExpired);
    return () => window.removeEventListener('memora-auth-expired', onExpired);
  }, []);

  const logout = async () => {
    try { await logoutRequest(); } catch { /* la UI torna comunque al login */ }
    setStatus(current => current ? { ...current, authenticated: false } : { setupRequired: false, authenticated: false });
  };

  if (loading) return <main className="auth-screen"><div className="auth-card auth-loading">{t('Caricamento Memora…')}</div></main>;
  if (error || !status) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <h1>{t('Memora non disponibile')}</h1>
          <div className="auth-error" role="alert">{error ?? t('Stato di autenticazione non disponibile.')}</div>
          <button type="button" className="auth-submit" onClick={() => void loadStatus()}>{t('Riprova')}</button>
        </div>
      </main>
    );
  }
  if (!status.authenticated) {
    return <AuthScreen mode={status.setupRequired ? 'setup' : 'login'} onAuthenticated={() => setStatus({ setupRequired: false, authenticated: true })} />;
  }
  return <AuthContext.Provider value={{ logout }}>{children}</AuthContext.Provider>;
}
