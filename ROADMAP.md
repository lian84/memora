# Roadmap

> Stato: Phase 0–5 completate. Backlog canonico dettagliato in `tasks/06`–`tasks/10`:
> Backlog canonico (Telegram, automazioni, integrazioni, hardening, release).

## Phase 0 — Bootstrap
- [x] monorepo
- [x] TypeScript strict
- [x] pnpm
- [x] lint/test
- [x] health endpoint

## Phase 1 — Pi Core
- [x] Pi SDK
- [x] AgentService
- [x] OpenRouter
- [x] streaming
- [x] session dir

## Phase 2 — Web Chat
- [x] React UI
- [x] streaming
- [x] abort
- [x] resume

## Phase 3 — Sessioni
- [x] JSONL Pi
- [x] metadati
- [x] rename/archive
- [x] restart test

## Phase 4 — Second Brain
- [x] scanner Markdown
- [x] SQLite FTS5
- [x] retrieval
- [x] fonti usate

## Phase 5 — Memory Writer
- [x] candidati ricordo
- [x] deduplica e conflitti
- [x] preview di testo/destinazione (diff completo rimandato)
- [x] approvazione, modifica, rifiuto
- [x] audit append-only
- [x] Memory Inbox UI
- [x] secret detection
- [x] gestione fonti approvate (dettaglio, edit, delete)
- [x] personal assistant runtime isolation
- [x] production runtime Fastify + React static
- [x] systemd unit e graceful shutdown

## Phase 6 — Telegram
- [x] notifiche/risultati automazioni in uscita
- [ ] bot in ingresso
- [ ] whitelist
- [ ] stesse sessioni/backend

## Phase 7 — Automazioni
- [x] scheduler
- [x] cron
- [x] history
- [x] output Web/Telegram
- [x] timeout e retry limitati

## Phase 8 — Integrazioni
- [ ] Todoist
- [ ] Notion
- [ ] Calendar
- [ ] Gmail
- [ ] web search
- [ ] document ingestion

## Phase 9 — Hardening
- [x] systemd
- [ ] Tailscale
- [x] auth
- [ ] backup/restore
- [ ] security review

## Phase 10 — Open Source Release
- [x] LICENSE (AGPL-3.0-only)
- [x] CONTRIBUTING.md (DCO)
- [x] SECURITY.md pubblico
- [ ] install script (`install.sh`)
- [ ] configurazione di esempio (`.env.example`, file di esempio)
- [x] CI GitHub Actions
- [ ] release/versioning
- [ ] upgrade/migrations
- [ ] backup/restore
- [ ] audit licenze dipendenze
- [ ] eventuale Docker image/Compose
