# Roadmap

> Release pubblica corrente: **v0.2.1** — 28 novembre 2026.
> Le fasi 0–7 descrivono il percorso del nucleo; le caselle indicano ciò che è
> effettivamente completo. Le sezioni successive raccolgono integrazioni,
> hardening e stabilizzazione. Non sono promesse di date.
> Dettaglio funzionalità: [`docs/FEATURES.md`](docs/FEATURES.md).

## Fase 0 — Bootstrap

- [x] Monorepo pnpm
- [x] TypeScript strict
- [x] Lint, test e build
- [x] Endpoint di health
- [x] CI GitHub Actions

## Fase 1 — Pi Core

- [x] SDK ufficiale Pi
- [x] AgentService
- [x] Provider e modelli configurabili
- [x] Streaming e reasoning
- [x] Sessioni persistenti

## Fase 2 — Web Chat

- [x] Interfaccia React
- [x] Streaming delle risposte
- [x] Interruzione e ripresa
- [x] Contesto di sessione
- [x] Turni in background

## Fase 3 — Sessioni

- [x] JSONL Pi
- [x] Metadati e titoli automatici
- [x] Rinomina, archivio e ripristino
- [x] Sezioni e progetti nella sidebar
- [x] Chat archiviate per progetto

## Fase 4 — Second Brain

- [x] Scanner Markdown
- [x] SQLite FTS5
- [x] Ricerca ibrida e embedding locali opzionali
- [x] Fonti usate nel contesto
- [x] Memory Inbox e Memory Curator
- [x] Audit e integrità della memoria

## Fase 5 — Memoria e conoscenza

- [x] Candidati di memoria con deduplica e conflitti
- [x] Approvazione, modifica e rifiuto
- [x] Rilevamento segreti
- [x] Gestione delle fonti approvate
- [x] Isolamento del runtime dell'assistente
- [x] Produzione Fastify + React statico
- [x] systemd e graceful shutdown

## Fase 6 — Telegram

- [x] Notifiche e risultati delle automazioni in uscita
- [x] Invio di documenti PDF, DOCX, XLSX e PPTX
- [x] Account Telegram riutilizzabili
- [x] Polling in ingresso, pairing monouso e allowlist per ID numerico
- [x] Comandi di servizio, sessioni condivise e conversazione nello stesso backend della web UI
- [x] Allegati in ingresso e avviso dei turni interrotti dopo un riavvio
- [x] Condivisione Telegram opt-in delle risposte web, per singola chat
- [x] Gruppi privati con forum topic: General come sessione predefinita, un topic per sessione, progetto predefinito del gruppo con override per topic, prefisso progetto opzionale, pairing con scope gruppo e pannello amministrativo

## Fase 7 — Automazioni

- [x] Scheduler headless
- [x] Cron e timezone
- [x] Storico delle esecuzioni
- [x] Output Web e Telegram
- [x] Timeout e retry limitati
- [x] Modello, ragionamento, web e MCP per singolo job
- [x] Automazioni nella sidebar e pagina globale

## Fase 8 — Progetti, artefatti e agenti

- [x] Progetti con sezioni, fonti e file
- [x] Contesto e prompt di progetto
- [x] Artefatti HTML, PDF, DOCX, XLSX e PPTX
- [x] Versioning e preview degli artefatti
- [x] Profili agente, icone e skill
- [x] Editor dei profili in amministrazione

## Fase 9 — Integrazioni

- [x] Registro MCP e risoluzione degli account
- [x] Notion e Todoist in lettura
- [x] Scritture MCP esplicite per chat
- [x] Ricerca web Brave/SearXNG con citazioni numerate
- [x] Fonti web distinte tra ricerca, lettura e PDF
- [ ] Google Calendar
- [ ] Gmail
- [ ] Ingestione documentale più ampia oltre a fonti progetto e allegati chat

## Fase 10 — Hardening e operazioni

- [x] Login single-user e sessioni
- [x] Backup locali cifrati con retention
- [x] Backup remoto Mega/rclone con ultima copia
- [x] Export leggibile e import su installazione pulita
- [x] Monitoraggio locale con avvisi Telegram deduplicati
- [x] Controllo aggiornamenti dalle release GitHub
- [x] Helper systemd per l'aggiornamento dalla UI
- [x] Script di restore, backup e import/export
- [ ] Validazione end-to-end di aggiornamento, restore e rollback su VM pulita
- [ ] Gate di approvazione per le scritture MCP distruttive
- [ ] Security review completa
- [ ] Audit licenze e dipendenze

## Fase 11 — Release e documentazione

- [x] Licenza AGPL-3.0-only
- [x] CONTRIBUTING con DCO, SECURITY, CODE_OF_CONDUCT
- [x] `install.sh` e `update.sh` con backup pre-aggiornamento
- [x] Configurazione di esempio in `.env.example`
- [x] Release pubbliche e workflow di release
- [x] README bilingue e documentazione operativa
- [x] Fix del fallback di versione in v0.1.2
- [ ] Test dell'installer su Debian 13 pulita con la release corrente
- [ ] Traduzione completa di architettura, sicurezza e decisioni
- [ ] Immagine Docker/Compose opzionale, solo se richiesta

## Prossime priorità

1. Provare l’aggiornamento da v0.2.0 a v0.2.1 con il pulsante.
2. Provare restore, rollback e import/export su una VM usa-e-getta.
3. Rifare l'installazione pulita con v0.2.1 e aggiornare la checklist.
4. Audit licenze e dipendenze.
5. Documentare il gate di approvazione per le scritture MCP distruttive.
6. Riprendere le feature rimandate: Calendar/Gmail, installer SearXNG nativo e
   condivisione web verso i topic Telegram.

## Rimandato

- Condivisione web verso i topic Telegram e streaming progressivo.
- Calendar e Gmail.
- Docker/Compose come percorso di installazione principale.
- Multi-utente e permessi granulari.
- App mobile nativa.
