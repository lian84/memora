# Sviluppo e operazioni

Sviluppo locale, deployment production, systemd e runtime dell’assistente.

## Development

Servono due processi:

```bash
pnpm dev
pnpm --filter @memora/web dev
```

- Fastify: `http://127.0.0.1:3000`
- Vite: `http://127.0.0.1:5173`
- Vite inoltra `/api` al backend tramite `VITE_PROXY_TARGET`.

## Production

Un solo processo Fastify:

```bash
pnpm build
pnpm start
```

`pnpm start` imposta `NODE_ENV=production`, non avvia Vite e non usa `tsx`.
Fastify serve:

```text
GET /api/*  → API Memora
GET /*      → React build + SPA fallback (index.html)
```

La build Vite attuale viene emessa in `apps/dist/web` (`apps/web/vite.config.ts`,
`outDir: ../dist/web`). Le API sconosciute restano `404` JSON; gli asset
mancanti restano `404` e non ricevono `index.html`.

## Servizio systemd

Unità di esempio: `deploy/memora.service`.

Installazione suggerita:

```bash
sudo cp deploy/memora.service /etc/systemd/system/memora.service
sudo systemctl daemon-reload
sudo systemctl enable --now memora
sudo systemctl status memora
```

Comandi operativi:

```bash
sudo systemctl restart memora
sudo systemctl stop memora
journalctl -u memora -f
```

L'unit usa `User=memora`, `WorkingDirectory=/opt/memora` e
`EnvironmentFile=/etc/memora/memora.env` come esempio generico. Adatta utente,
directory e file di ambiente al deployment reale.

`systemd` non espande `~`: `EnvironmentFile` deve usare un path assoluto.
Nessuna API key deve essere scritta nell'unit. `NODE_ENV=production` è forzato
anche nell'`ExecStart`, perché systemd lascia che `EnvironmentFile` sovrascriva
`Environment=`.

## Accesso remoto sicuro

Il default è `MEMORA_HOST=127.0.0.1`: il servizio non è esposto automaticamente
su Internet.

Da un altro computer, con SSH:

```bash
ssh -L 3000:127.0.0.1:3000 utente@server
```

Poi aprire `http://127.0.0.1:3000`.

Via Tailscale, usare lo stesso tunnel SSH verso l'hostname o l'IP Tailscale:

```bash
ssh -L 3000:127.0.0.1:3000 utente@nome-tailscale
```

Tailscale Serve non è configurato in questo task.

## Personal Assistant runtime

Le normali chat Memora sono sessioni personal assistant, non coding agent del
repository:

- CWD isolato: `$MEMORA_DATA_DIR/runtime/assistant`
- built-in coding/filesystem tools disattivati (`noTools: "builtin"`)
- niente AGENTS.md, project skills, prompt template, documentazione o source
  code del repository nel context
- memoria Second Brain e Memory Retrieval restano attivi
- custom/integration tools esplicitamente configurate possono restare attive

Le sessioni legacy restano visibili e riprendibili, applicando lo stesso runtime
isolato al resume.

Il Personal Assistant risponde naturalmente a decisioni e preferenze: non chiede
conferma per salvare, non dichiara che una memoria è già registrata e non
promette tool o ricerche aggiuntive. Le proposte sono gestite separatamente dal
Memory Curator e riviste nella Memory Inbox. Quando il turno contiene una
sezione «Memoria utilizzata», quelle fonti sono disponibili come contesto.
