# Development and operations

Local development, production deployment, systemd and assistant runtime.

## Development

Two processes are required:

```bash
pnpm dev
pnpm --filter @memora/web dev
```

- Fastify: `http://127.0.0.1:3000`
- Vite: `http://127.0.0.1:5173`
- Vite proxies `/api` to the backend through `VITE_PROXY_TARGET`.

## Production

A single Fastify process:

```bash
pnpm build
pnpm start
```

`pnpm start` sets `NODE_ENV=production`, does not start Vite and does not use
`tsx`. Fastify serves:

```text
GET /api/*  → Memora API
GET /*      → React build + SPA fallback (index.html)
```

The Vite build is emitted to `apps/dist/web` (`apps/web/vite.config.ts`,
`outDir: ../dist/web`). Unknown APIs remain JSON `404`; missing assets remain
`404` and do not receive `index.html`.

## systemd service

Example unit: `deploy/memora.service`.

Suggested installation:

```bash
sudo cp deploy/memora.service /etc/systemd/system/memora.service
sudo systemctl daemon-reload
sudo systemctl enable --now memora
sudo systemctl status memora
```

Operational commands:

```bash
sudo systemctl restart memora
sudo systemctl stop memora
journalctl -u memora -f
```

The unit uses `User=memora`, `WorkingDirectory=/opt/memora` and
`EnvironmentFile=/etc/memora/memora.env` as a generic example. Adapt the user,
directory and environment file to the real deployment.

`systemd` does not expand `~`: `EnvironmentFile` must use an absolute path. Do
not write API keys into the unit. `NODE_ENV=production` is also forced in
`ExecStart`, because systemd lets `EnvironmentFile` override `Environment=`.

## Secure remote access

The default is `MEMORA_HOST=127.0.0.1`: the service is not automatically exposed
to the Internet.

From another computer, through SSH:

```bash
ssh -L 3000:127.0.0.1:3000 user@server
```

Then open `http://127.0.0.1:3000`.

Through Tailscale, use the same SSH tunnel to the Tailscale hostname or IP:

```bash
ssh -L 3000:127.0.0.1:3000 user@tailscale-name
```

Tailscale Serve is not configured by this project yet.

## Personal Assistant runtime

Normal Memora chats are personal-assistant sessions, not repository coding
agents:

- isolated CWD: `$MEMORA_DATA_DIR/runtime/assistant`
- built-in coding/filesystem tools disabled (`noTools: "builtin"`)
- no repository instruction files, project skills, prompt templates, documentation or repository
  source code in context
- Second Brain memory and Memory Retrieval remain active
- explicitly configured custom/integration tools may remain active

Legacy sessions remain visible and resumable, applying the same isolated runtime
on resume.

The Personal Assistant responds naturally to decisions and preferences: it does
not ask for confirmation before saving, does not claim a memory is already
recorded and does not promise extra tools or research. Proposals are handled
separately by the Memory Curator and reviewed in the Memory Inbox. When a turn
contains a “Memory used” section, those sources are available as context.
