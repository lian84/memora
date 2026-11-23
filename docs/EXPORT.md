# Readable data export

**English** | [Italiano](EXPORT.it.md)

Memora can export a readable archive containing the user's knowledge and
history without configuration or secrets.

## What is exported

- `memory/` — Markdown memory;
- `projects/` — project metadata, sources and files;
- `agents/` — custom agent profiles and skills;
- `automations/` — jobs and run history;
- `memory-inbox/` — memory candidates and audit data;
- `pi-sessions/` — chat transcripts;
- `artifacts/` and `chat-attachments/` — generated documents and attachments;
- `export-manifest.json` — format, version and exclusion list.

The archive is a `.tar.gz` file. It contains personal data, so store it securely.

## What is not exported

Configuration and secrets:

```text
config/  (including auth, provider keys, Telegram/MCP tokens, web keys)
index/   (rebuildable SQLite index)
models/, browser-libs/, searxng/, runtime/, backups/, tools/
```

After importing an export into a clean installation, the user must complete the
first login and reconfigure providers and integrations.

## UI

In **Administration → System → Data export**:

- create an export;
- download it;
- delete old exports (the newest five are retained).

## Import

Import is intentionally restricted to a clean data directory or the installer.
It never merges into an existing active installation.

```bash
node scripts/import-export.mjs \
  --file /path/to/memora-export-....tar.gz \
  --data-dir /var/lib/memora \
  --yes
```

The installer also offers an import step. No backup password is needed because
the readable export is not encrypted; it must be protected by the operator.

## Difference from backup

| Backup | Export |
|---|---|
| encrypted | readable |
| includes config/secrets | excludes config/secrets |
| exact restore | portability/migration |
| restore only | clean import |
