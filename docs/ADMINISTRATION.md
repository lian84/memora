# Administration

Runtime settings, authentication and interface language.

The **Settings** icon in the sidebar opens runtime options without manual file
editing. Configuration is stored in `$MEMORA_DATA_DIR/config/settings.json` with
atomic writes, readable JSON, a versioned schema and mode `0600`. The file
contains only overrides and is created on the first save; existing installations
continue to work with defaults + environment and no automatic migrations.

Precedence: application defaults → `settings.json` → environment. Fields that
come from the environment are marked “Managed by the environment” and cannot be
edited in the UI. APIs are centralized under `/api/admin/*`:

```text
GET   /api/admin/settings
PATCH /api/admin/settings
GET   /api/admin/status
```

The **Chat** section lets you choose OpenRouter or OpenCode Go, save the key in
the local secret store, test the connection and search/select a model from the
real catalog. The new default applies to new sessions; existing sessions are not
changed. This section also toggles automatic titles for new chats; the local
fallback always remains available. The **Memory Curator** section selects a
separate provider and model and reuses the same provider key without asking for a
second one. The OpenRouter catalog uses the Pi catalog; OpenCode Go uses its
remote endpoint with a 10-minute cache and fallback to the Pi catalog.

Retrieval mode, topK/maxChars, Curator thresholds, reasoning, Curator
provider/model, Chat defaults, automatic titles and turn concurrency apply live;
embedding changes and enabling/disabling the Curator require an explicit restart.
The UI shows “Memora restart required” and never executes `systemctl` or sudo
commands. Lite and Standard presets show changes before applying them. Lite is
intended for 1–2 GB RAM VPS instances; Standard for hosts with at least 4 GB RAM.

Admin APIs are protected by single-user login. Keys are stored only in
`$MEMORA_DATA_DIR/config/secrets.json` (mode `0600`, atomic writes) or read from
the environment; `GET` returns only status and source, never the value. The
configuration is suitable for systemd, future Docker, VPS, Proxmox, mini PCs and
local installations, with no hardcoded paths beyond `MEMORA_DATA_DIR`.

## Login and access

On first start, if `$MEMORA_DATA_DIR/config/auth.json` does not exist, Memora
enters setup mode: application APIs remain blocked until the first password is
chosen. There is no username: Memora is personal and single-user. The first
password set wins, so complete setup immediately after installation.

- minimum password length: 12 characters;
- `scrypt` hash with a random salt;
- no plaintext password;
- `memora_session` cookie, `HttpOnly`, `SameSite=Lax`;
- 24-hour session;
- logout invalidates all sessions;
- all `/api/*` protected except `/api/health`, login, setup and auth status;
- rate limiting for failed logins;
- no API tokens in v0.1.

To reset the password, from the machine hosting Memora:

```bash
MEMORA_DATA_DIR=/path/to/data pnpm memora:set-password
```

The command asks for the new password without echoing it and replaces
`config/auth.json`. Restart Memora after the reset. If the service is reachable
over HTTP on the LAN, the cookie does not have the `Secure` flag; set
`MEMORA_COOKIE_SECURE=true` only when access uses HTTPS. Tailscale encrypts the
transport, but login remains required.

## Interface languages

The UI supports:

```text
Italiano
English
Français
```

The language is detected from the browser, stored in `localStorage` under
`memora-language` and can be changed from the selector in
**Administration → Appearance**. The fallback is English.

The dictionary lives in `apps/web/src/i18n/`: `it` is the source language, while
`en.ts` and `fr.ts` contain translations. To add a language, copy a dictionary
and register the code in `SUPPORTED_LANGUAGES`.

The UI language does not force Memo's answer language: the assistant replies in
the language of the user's message.
