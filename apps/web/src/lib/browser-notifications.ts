const STORAGE_KEY = 'memora-browser-notifications';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

export function isBrowserNotificationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}

export function setBrowserNotificationEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, 'true');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
}

export interface TurnNotification {
  sessionId: string;
  title: string;
  body: string;
  activeSessionId: string | null;
  onOpen: () => void;
}

/**
 * Notifica locale del browser. Non è una push notification: richiede che la
 * scheda Memora sia ancora aperta, anche se in background.
 */
export function notifyTurnFinished(options: TurnNotification): Notification | null {
  if (!isBrowserNotificationEnabled() || typeof window === 'undefined' || !('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';
  if (visible && document.hasFocus?.() && options.activeSessionId === options.sessionId) return null;
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: '/brand/memora-avatar.png',
      tag: `memora-turn-${options.sessionId}`,
      data: { sessionId: options.sessionId },
    });
    notification.onclick = () => {
      try { window.focus(); } catch { /* window may be unavailable */ }
      options.onOpen();
      notification.close();
    };
    return notification;
  } catch {
    return null;
  }
}
