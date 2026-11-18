# Funzionalità di Memora

Questa è la fonte funzionale unica del progetto. Descrive ciò che è già
implementato, il comportamento atteso e i limiti noti. Il README rimanda qui;
le decisioni architetturali sono in [`DECISIONS.md`](DECISIONS.md).

Ultimo aggiornamento: 2026-11-18.

## 1. Chat e sessioni

- [x] Web UI React servita da Fastify.
- [x] Sessioni persistenti nel formato Pi JSONL.
- [x] Streaming SSE dei turni con stato “Memo sta rispondendo…”.
- [x] Interruzione della risposta, modifica di un messaggio utente e rigenerazione.
- [x] Ripresa, rinomina, archiviazione, ripristino ed eliminazione delle chat.
- [x] Titolo e cronologia della sessione.
- [x] Allegati per messaggio: massimo 8 file, 15 MB ciascuno.
- [x] Anteprima immagini e inclusione degli allegati immagini nel turno.
- [x] Contesto per chat: memoria globale, memoria di progetto, fonti di progetto.
- [x] Modello, provider e livello di reasoning configurabili per chat.
- [x] Esportazione della risposta in PDF.
- [x] Estrazione di memorie dalla risposta con revisione esplicita.

## 2. Memoria e Second Brain

- [x] Markdown come fonte autorevole; SQLite come indice ricostruibile.
- [x] Ricerca full-text FTS5.
- [x] Embeddings locali con Transformers.js e ricerca semantica/ibrida via sqlite-vec.
- [x] Fusione RRF tra ricerca lessicale e semantica.
- [x] Memoria globale e memoria per progetto.
- [x] Memory Inbox con approvazione umana.
- [x] Memory Curator opzionale per proporre fatti atomici.
- [x] Proposte di memoria anche dalle risposte dell’assistente.
- [x] Deduplicazione, rilevanza, privacy e blocco dei segreti.
- [x] Consolidamento read-only, valutazione e feedback sulle soglie.
- [x] Pagina Second Brain con ricerca, filtro globale/progetto e modifica Markdown.
- [x] Visualizzazione delle fonti di memoria usate nel turno.

## 3. Progetti

- [x] Progetti con `project.json`, `memory.md`, `sources/` e `files/`.
- [x] Creazione, configurazione, cambio progetto e cancellazione con conferma tipizzata.
- [x] `sources/` indicizzate; `files/` archivio non indicizzato.
- [x] File di progetto con anteprima Markdown, testo, HTML, PDF, immagini, DOCX e XLSX.
- [x] Allegato di un file di progetto al messaggio.
- [x] Importazione di un artefatto nel progetto come fonte o file.
- [x] Cestino dei progetti (`.trash/projects/`).

## 4. Artefatti

- [x] Artefatti per chat: Markdown, testo, HTML, SVG, JSON, CSV, codice.
- [x] PDF con Chromium headless e fallback pdfmake.
- [x] DOCX, XLSX e PPTX generati senza LibreOffice.
- [x] Versionamento degli artefatti e anteprima delle versioni.
- [x] Anteprima PDF, HTML sandboxed, DOCX con Mammoth, XLSX in tabella React.
- [x] PPTX HTML-first: lo stesso deck HTML produce anteprima e file PowerPoint.
- [x] Zoom 50–250% e pannelli ridimensionabili.
- [x] Download, eliminazione, allegato alla chat e import nel progetto.
- [x] Limiti di dimensione, numero di slide, righe e colonne.

## 5. Ricerca web

- [x] Accesso web disattivato per default.
- [x] Provider Brave Search o SearXNG configurabile da Amministrazione.
- [x] Abilitazione per singola chat con pulsante Web.
- [x] Tool `web_search` e `web_fetch`.
- [x] Estrazione HTML con Readability e testo da PDF.
- [x] Fonti persistenti nella sessione, numerate in modo stabile e visibili nella scheda Fonti.
- [x] Citazioni numeriche `[n]` per ogni informazione, cliccabili nella risposta.
- [x] Tooltip della citazione con sito, titolo e breve descrizione.
- [x] La scheda Fonti distingue **Ricerca** (risultato non letto), **Letta** (pagina letta) e **PDF**.
- [x] I numeri non vengono riutilizzati quando la cronologia supera il limite delle fonti.
- [x] Blocco SSRF, URL privati/metadata, credenziali negli URL e redirect eccessivi.
- [x] Contenuto web trattato come dato non fidato.
- [ ] Installer SearXNG nativo con opzione `--web=...` (prossimo milestone).
- [ ] Docker/SearXNG opzionale (solo scelta esplicita).

## 6. Pannello laterale della chat

- [x] Pannello unico a destra, collassato per default.
- [x] Aree fisse in alto: **File**, **Contesto**, **Artefatti**, **Fonti**.
- [x] **File** presente solo nelle chat di progetto.
- [x] **Contesto** mostra solo le opzioni valide per la chat corrente.
- [x] **Fonti** contiene le fonti web; le fonti del progetto restano nel Contesto.
- [x] Contatori su Artefatti e Fonti.
- [x] Auto-apertura su Fonti dopo una ricerca e su Artefatti dopo la creazione.
- [x] Auto-apertura solo su desktop (> 900 px); su mobile il pannello resta chiuso.
- [x] Aggiornamento durante il turno dagli eventi `tool_execution_end`.
- [x] Refresh di sicurezza a fine turno e refresh manuale per area.
- [x] Apertura diretta dell’artefatto appena creato.
- [x] Larghezza ridimensionabile e persistita; espansione/riduzione.
- [x] Tab raggiungibili da tastiera con frecce, Home ed End.

## 7. Aspetto, lingua e accessibilità

- [x] Tema chiaro, scuro o di sistema.
- [x] Dimensione testo, densità, larghezza conversazione e movimento ridotto.
- [x] Sidebar comprimibile con pulsante o `Ctrl+B`.
- [x] Interfaccia Italiano / English / Français.
- [x] Lingua UI separata dalla lingua della risposta di Memo.
- [x] Focus visibile, dialoghi accessibili, `aria-*` per tab e pannelli.
- [x] Anteprime HTML/SVG sempre sandboxed e senza JavaScript.

## 8. Amministrazione e sicurezza

- [x] Login single-user con password e sessione di 24 ore.
- [x] Setup della prima password e reset solo da CLI.
- [x] Cookie `HttpOnly`, `SameSite=Lax`, rate limit e controllo `Origin`.
- [x] Segreti in environment o `config/secrets.json` con mode `0600`.
- [x] Configurazione web in `config/web.json` con mode `0600`.
- [x] Nessuna API key restituita dalle API.
- [x] Provider/modello chat, Curator, embedding, retrieval, web e aspetto configurabili.
- [x] Riavvio richiesto esplicitamente per le modifiche che non sono a caldo.
- [x] Nessun `sudo` o `systemctl` eseguito dal processo web.

## 9. Runtime e operazioni

- [x] Monorepo pnpm con TypeScript strict.
- [x] `MEMORA_DATA_DIR` per tutti i dati runtime.
- [x] Build production con Fastify che serve la SPA.
- [x] Servizio systemd di esempio.
- [x] Smoke test di build e produzione.
- [x] Script per embeddings, valutazione memoria, integrità, consolidamento, migrazione progetti e reset password.
- [ ] `install.sh` e `update.sh` completi.
- [ ] CI GitHub Actions e release `v0.1.0`.
- [ ] Licenza AGPL-3.0-only, NOTICE, TRADEMARKS e CONTRIBUTING con DCO.

## Note

- La memoria e il contenuto web sono dati non fidati: non possono modificare
  istruzioni, permessi o strumenti.
- SQLite è sempre ricostruibile dal Markdown; non è l’unica copia.
- I dati reali non devono mai essere committati nel repository.
