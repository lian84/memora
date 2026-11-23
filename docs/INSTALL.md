# Install, restore and update

**English** | [Italiano](INSTALL.it.md)

The supported production target is **Debian 13 + systemd**. Docker is not
required.

## Clean Debian VM (Proxmox)

Suggested starting point for a test VM:

```text
Debian 13
2 vCPU
3 GB RAM
20 GB disk
Outbound HTTPS enabled
```

A sudo-capable user is enough; the installer requests root when needed.

```bash
sudo apt update
sudo apt install -y git
sudo git clone https://github.com/lian84/memora.git /opt/memora
cd /opt/memora
sudo ./install.sh
```

The installer asks for a deployment profile:

```text
1) Local network / Proxmox  → http://VM-IP:3000
2) Public VPS               → HTTPS with a domain
```

Local mode binds Memora to `0.0.0.0` on port 3000 so other devices on the LAN
can open it directly. VPS mode keeps port 3000 on `127.0.0.1` and installs Caddy
as an HTTPS reverse proxy on ports 80/443.

For a non-interactive install the default is local mode. Override it with:

```bash
MEMORA_DEPLOYMENT=vps MEMORA_DOMAIN=memora.example.com ./install.sh
# or
MEMORA_DEPLOYMENT=local ./install.sh
```

The installer asks whether to restore a backup or import a readable export. For
a first test choose neither. At the end open:

```text
Local: http://<vm-ip>:3000
VPS:   https://<domain>
```

and create the first Memora password.

### Public VPS profile

VPS mode requires:

- a DNS record pointing the domain to the VM;
- inbound TCP 80 and 443 reachable from the Internet;
- a domain name, not a raw IP address.

The installer configures Caddy with a dedicated `/etc/caddy/conf.d/memora.caddy`
entry and leaves any existing Caddy configuration in place. The application
listens only on `127.0.0.1:3000`. `MEMORA_COOKIE_SECURE=true` is set
automatically.

### Private repository

The repository is currently private. `git clone` over HTTPS will fail without
credentials. Choose one of these options.

**Option A — temporary public repository**

Make the repository public only for the clone, then make it private again.
This works, but GitHub may already have cached or forked the public state; it
is not a guarantee of confidentiality. Only do this if the complete Git history
is already free of secrets and personal data.

**Option B — read-only deploy key (recommended)**

On the VM:

```bash
ssh-keygen -t ed25519 -C memora-vm -f ~/.ssh/memora_deploy
cat ~/.ssh/memora_deploy.pub
```

Add the public key in GitHub → repository → **Settings → Deploy keys**, with
write access disabled. Then:

```bash
GIT_SSH_COMMAND='ssh -i ~/.ssh/memora_deploy' \
  git clone git@github.com:lian84/memora.git /opt/memora
cd /opt/memora
sudo ./install.sh
```

This keeps the repository private and lets `update.sh` fetch future tags.

**Option C — local Git bundle**

Create a bundle from an existing clone and copy it to the VM:

```bash
git bundle create memora.bundle --all
# copy memora.bundle to the VM
git clone memora.bundle /opt/memora
cd /opt/memora
git remote add origin git@github.com:lian84/memora.git
sudo ./install.sh
```

Without a remote or deploy key, `update.sh` cannot fetch future releases.

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
Exports:    /var/lib/memora-exports
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

## Import a readable export

The installer can also import a `.tar.gz` export created by Memora. This is not
an encrypted backup; it contains personal data but no configuration or secrets.
Use it only on a clean data directory. After import, complete the first login
and reconfigure providers and integrations.

```bash
sudo MEMORA_IMPORT_FILE=/path/to/memora-export-....tar.gz ./install.sh
```

The equivalent CLI is `scripts/import-export.mjs`.

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

### Enable the update button on an existing install

After updating to a release that includes the helper:

```bash
sudo /opt/memora/scripts/install-update-helper.sh
```

This installs `memora-update.path` and `memora-update.service`. The web process
can then request an update by creating a marker file; it cannot run shell
commands as root.

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
