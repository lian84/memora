# Monitoring and alerts

**English** | [Italiano](MONITORING.it.md)

Memora runs a lightweight monitor inside the server. It checks at most every
15 minutes and can send new alerts to the first enabled Telegram account.

## What is checked

- disk usage of `MEMORA_DATA_DIR`;
- last local backup and backup failure;
- remote upload failure;
- failed or timed-out automation jobs;
- active alerts and their first occurrence.

Missing backups are reported when automatic backup is enabled but no archive
exists yet. Old backups are reported after the configured number of days.

## Settings

In **Administration → System → Monitoring**:

- enable or disable the monitor;
- enable Telegram notifications;
- disk warning and critical thresholds;
- maximum backup age.

Defaults:

```text
disk warning   80%
disk critical  90%
backup age     8 days
```

## Alert behavior

- A new active alert is sent once.
- Repeated checks do not resend it.
- When the condition clears, a recovery message is sent.
- If Telegram is not configured, the alert remains visible in the UI and can be
  sent after an account is configured.
- A failed Telegram delivery does not lose the alert; it is retried on the next
  check.
- Alert state is stored in `config/monitor-state.json` with mode `0600`.
- Settings are stored in `config/monitor.json`.

The monitor never starts a model, backup or update. It only observes.

## Manual check

**Check now** in the Monitoring section runs the same checks immediately.

## Known limits

- The monitor checks only what Memora can observe locally.
- It does not replace external uptime monitoring.
- It does not alert about a host that is completely offline.
