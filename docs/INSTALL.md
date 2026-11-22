# Install, restore and update

**English** | [Italiano](INSTALL.it.md)

The supported production target is **Debian 13 + systemd**. Docker is not
required.

## Install Memora

Clone the repository where the service will live, then run the installer as a
user with `sudo`:

```bash
git clone https://github.com/lian84/memora.git
cd memora
sudo ./install.sh
```

The installer uses these defaults:

```text
Code:       /opt/memora
Service:    memora.service
User:       memora
Data:       /var/lib/memora
Config:     /etc/memora/memora.env
Backups:    /var/lib/memora-backups
```

They can be changed with `MEMORA_HOME`, `MEMORA_USER`, `MEMORA_DATA_DIR`,
`MEMORA_CONFIG_DIR` and `MEMORA_BACKUP_DIR`.

The installer:

- checks or installs Node.js 24;
- installs pnpm and the system prerequisites;
- creates the service user and directories;
- installs the official rclone binary with the Mega backend;
- builds the application;
- creates the systemd service;
- optionally restores a backup;
- starts Memora and verifies `/api/health`.

No secret from the source checkout is copied. Provider keys and Telegram/MCP
tokens are configured after the first login.

Open `http://127.0.0.1:3000` and create the first password. For remote access use
HTTPS or an encrypted tunnel; do not expose the plain HTTP port publicly.

## Restore during installation

The installer asks whether to restore a backup. It needs:

- the `.mbackup` file;
- the backup password;
- confirmation before replacing data.

The archive checksum and manifest are verified before extraction. The existing
data directory, if any, is renamed to:

```text
<data-dir>.restore-backup-<timestamp>
```

It is not deleted automatically.

### Emergency restore from CLI

Restore is intentionally not available from a running web UI.

```bash
sudo systemctl stop memora
MEMORA_BACKUP_PASSWORD='...' \
  node scripts/restore-backup.mjs \
  --file /path/to/memora-backup.mbackup \
  --data-dir /var/lib/memora \
  --yes
sudo systemctl start memora
```

Use `--force` only when you have verified that the service is stopped. Read the
manifest and checksum before restoring. Keep the safety copy until the restored
instance has been verified.

## Update Memora

Updates are manual and based on published GitHub releases, not on every push to
`main`.

```bash
cd /opt/memora
sudo ./update.sh
```

`update.sh`:

1. stops Memora;
2. creates an encrypted local backup with the configured backup password;
3. aborts if the backup fails;
4. fetches tags and checks out the latest `v*` release;
5. installs dependencies, builds and runs idempotent migrations;
6. starts the service and checks `/api/health`;
7. rolls back to the previous commit and restarts if the update fails.

A specific tag can be selected with:

```bash
MEMORA_UPDATE_TAG=v0.2.0 sudo -E ./update.sh
```

An update available banner is shown in **Administration → System → Updates**.
It is based on GitHub Releases. Pushing to `main` does not create an update
notification.

## Backup requirement

The backup password must already be configured in Memora. Without it, the update
is aborted rather than performed without a safety copy.

The backup is local; if automatic remote upload is enabled in Administration,
the next scheduled backup can upload the latest copy.

## Manual verification

```bash
curl -fsS http://127.0.0.1:3000/api/health
systemctl status memora.service
journalctl -u memora.service -n 100
```

## Known limits

- The installer targets Debian/systemd; no Docker image is provided yet.
- Restore is available during install or via the emergency CLI, not from the
  running web UI.
- Updates use Git tags from the installed checkout; a source tarball without
  `.git` cannot be updated by `update.sh`.
- `rclone` is installed locally in `$MEMORA_DATA_DIR/tools/` so the Mega backend
  is available even when the Debian package lacks it.
