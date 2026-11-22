# Backup and restore

**English** | [Italiano](BACKUP.it.md)

Memora creates encrypted local snapshots that can be downloaded from
**Administration → Backup**. The archive contains application data and secrets; the encryption password is
chosen by the user and is not stored in the manifest. The archive also contains
the encrypted configuration, so the password is required to restore it.

## What is included

- `config/` (settings, auth metadata, integrations and secrets);
- `agents/`;
- `projects/`;
- `memory/`;
- `pi-sessions/`;
- `automations/`;
- `memory-inbox/`;
- `artifacts/`;
- `chat-attachments/`;
- the SQLite index;
- other small runtime metadata.

Excluded because they are large or rebuildable:

- `models/`;
- `browser-libs/`;
- `searxng/`;
- `runtime/`;
- `tools/` (official rclone binary);
- `.trash/`;
- the backup directory itself.

## Password and encryption

- The archive is encrypted with AES-256-GCM.
- The key is derived from the backup password with scrypt.
- The password is stored locally in `config/backup-secrets.json` with mode
  `0600` so scheduled backups can run. It is never returned by the API and is
  part of the encrypted archive configuration.
- `MEMORA_BACKUP_PASSWORD` can be used instead; in that case the UI cannot
  change it.
- If the password is lost, the backup cannot be restored.
- Changing the password does not re-encrypt older archives: keep the old
  password for them.

## Local destination

The default directory is a sibling of `MEMORA_DATA_DIR`:

```text
<MEMORA_DATA_DIR>/../memora-backups
```

Override it with:

```bash
MEMORA_BACKUP_DIR=/path/to/memora-backups
```

The directory is created with mode `0700`; archives and manifests use `0600`.

## Freeze during backup

A backup is a consistent snapshot:

1. Memora enters maintenance mode.
2. New turns, automations and API writes are blocked.
3. Active turns/automations are allowed to finish (up to two minutes).
4. The archive is created.
5. Maintenance is released.

Reads other than the health/auth/backup endpoints are blocked during the
freeze. A snapshot is never created while activities are still running.

## Automatic backups

Automatic backups are optional and default to **off**. When enabled:

- frequency: daily or weekly;
- local time and timezone;
- retention: default **4** copies, maximum 20;
- the archive still uses the same freeze procedure;
- old archives and manifests are deleted after a successful backup.

The schedule is stored in `config/backup.json`. The timer runs inside the
server, so a closed browser is fine. A backup starts only when the service is
running.

## Download and deletion

Every archive can be downloaded from the backup table. Downloads are encrypted
files; the password is required to decrypt them. Deletion is explicit and
requires confirmation in the UI.

## Remote backup (Mega via rclone)

The remote backup card in Administration configures a dedicated **Mega** remote
through rclone. The wizard asks for:

- remote name (default `memora-mega`);
- Mega email and password;
- optional 2FA code;
- remote folder;
- automatic upload after every backup.

The rclone configuration is written to `config/rclone.conf` with mode `0600`;
the Mega password is stored obscured, never returned by the API and included in
the encrypted backup. The remote backup directory is dedicated to Memora.

After each upload, only the latest local archive and manifest are copied to the
remote folder: `rclone sync` removes older remote copies. The local retention
still keeps the configured number of local copies.

Memora prefers an official rclone binary at `$MEMORA_DATA_DIR/tools/rclone`
(and falls back to `rclone` in `PATH`). The Debian rclone package may not include
the Mega backend, so use the official binary or set `MEMORA_RCLONE_PATH`.
The installer will provision this in the next milestone. Manual
**Upload latest backup** is available when a local backup exists. Automatic
upload follows the local backup schedule and runs after the backup has left
maintenance mode.

## Restore

Restore is intentionally not available from a running Memora instance.

- During a clean installation, `install.sh` offers a restore step.
- Administrators can use the emergency CLI `scripts/restore-backup.mjs` with the
  service stopped.

The archive manifest and checksum are verified before replacing data; the
previous data directory is moved to a timestamped safety directory.

## Known limits

- `tar` must be available on the host (Debian package `tar`).
- The backup does not include the large model files; they can be downloaded
  again.
- A password stored locally for automatic backups protects a stolen backup, not
  a fully compromised host.
