import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isBrowserNotificationEnabled,
  notifyTurnFinished,
  requestBrowserNotificationPermission,
  setBrowserNotificationEnabled,
} from './browser-notifications';

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

function installBrowser(visibility: DocumentVisibilityState = 'hidden') {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    Notification: FakeNotification,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    focus: vi.fn(),
  });
  vi.stubGlobal('document', { visibilityState: visibility, hasFocus: () => false });
  vi.stubGlobal('Notification', FakeNotification);
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeNotification.permission = 'granted';
  FakeNotification.instances = [];
});

describe('browser notifications', () => {
  it('resta disattivato per default e rispetta il toggle locale', () => {
    installBrowser();
    expect(isBrowserNotificationEnabled()).toBe(false);
    setBrowserNotificationEnabled(true);
    expect(isBrowserNotificationEnabled()).toBe(true);
    setBrowserNotificationEnabled(false);
    expect(isBrowserNotificationEnabled()).toBe(false);
  });

  it('crea una notifica solo se abilitata e con permesso concesso', () => {
    installBrowser();
    expect(notifyTurnFinished({ sessionId: 's1', title: 'Memo', body: 'Pronta', activeSessionId: null, onOpen: vi.fn() })).toBeNull();
    setBrowserNotificationEnabled(true);
    const notification = notifyTurnFinished({ sessionId: 's1', title: 'Memo · Chat', body: 'Pronta', activeSessionId: null, onOpen: vi.fn() });
    expect(notification).not.toBeNull();
    expect(FakeNotification.instances[0]?.title).toBe('Memo · Chat');
    FakeNotification.permission = 'denied';
    expect(notifyTurnFinished({ sessionId: 's1', title: 'Memo', body: 'Pronta', activeSessionId: null, onOpen: vi.fn() })).toBeNull();
  });

  it('non chiede il permesso se è già stato negato', async () => {
    installBrowser();
    FakeNotification.permission = 'denied';
    await expect(requestBrowserNotificationPermission()).resolves.toBe('denied');
  });
});
