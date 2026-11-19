# Memora

**Italiano** | [English](README.md)

> Assistente personale self-hosted, file-first, costruito sopra Pi.
> Documentazione italiana; versione inglese in [`README.md`](README.md).

[![CI](https://github.com/lian84/memora/actions/workflows/ci.yml/badge.svg)](https://github.com/lian84/memora/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

Memora è un assistente personale self-hosted costruito sopra
[Pi](https://github.com/earendil-works/pi). Riunisce chat persistenti, un Second
Brain in Markdown, memoria con approvazione umana, progetti, artefatti e ricerca
web in un'unica interfaccia.

Il registro completo delle funzionalità, con stato e limiti noti, è in
[`docs/FEATURES.it.md`](docs/FEATURES.it.md). Le decisioni architetturali sono in
[`docs/DECISIONS.it.md`](docs/DECISIONS.it.md).

## Stato

Memora è in sviluppo **pre-release**. Il codice è utilizzabile e testato, ma
l'installazione e le migrazioni non sono ancora considerate stabili. Non
esporre il servizio su Internet senza HTTPS, reverse proxy e una revisione della
configurazione.

## Funzionalità principali

- Chat con streaming, sessioni Pi persistenti e turni in background.
- Second Brain file-first: Markdown autorevole, SQLite ricostruibile.
- Embeddings locali opzionali e ricerca semantica/ibrida.
- Memory Inbox con approvazione esplicita di default e auto-salvataggio opzionale; Curator LLM opzionale.
- Progetti, fonti indicizzate, file di progetto e artefatti versionati.
- PDF, DOCX, XLSX e PPTX senza LibreOffice.
- Ricerca web SSRF-safe tramite Brave o SearXNG, con citazioni numerate.
- Login single-user, notifiche browser e interfaccia IT/EN/FR.
- Layout responsive, pannello laterale e amministrazione runtime.

## Requisiti

- Node.js 24
- pnpm 12.21
- Debian 13 o una distribuzione compatibile per il runtime completo
- Chromium headless opzionale per il rendering PDF
- Modello di embedding locale opzionale per la ricerca semantica

## Avvio rapido

```bash
git clone https://github.com/lian84/memora.git
cd memora
cp .env.example .env
pnpm install
pnpm dev
```

Apri `http://127.0.0.1:3000`, completa il primo accesso e configura provider,
modello e credenziali da **Amministrazione**.

Build production:

```bash
pnpm build
pnpm start
```

## Documentazione

- [Funzionalità](docs/FEATURES.it.md)
- [Architettura](ARCHITECTURE.md)
- [Decisioni](docs/DECISIONS.it.md)
- [Operazioni](docs/OPERATIONS.md)
- [Sicurezza](docs/SECURITY.md)
- [Roadmap](ROADMAP.md)

## Principi di progetto

1. Pi è il motore agentico e resta una dipendenza esterna, non un fork.
2. La memoria importante resta leggibile in Markdown.
3. Le sessioni restano nel formato Pi JSONL.
4. Le credenziali non entrano mai nel repository.
5. Il deployment predefinito resta locale/LAN; l'esposizione pubblica richiede
   HTTPS e una configurazione esplicita.
6. Memora deve restare utile cambiando modello o frontend.
7. Codice, configurazione, dati e segreti sono separati; i dati runtime vivono
   in `MEMORA_DATA_DIR`.
8. Nessun percorso specifico dell'utente o della macchina è hardcoded.

Le risposte possono continuare in background: la concorrenza è configurabile
da Amministrazione (1–4, default 2) e gli altri turni vengono accodati.
Chiudere il browser non interrompe il turno; un riavvio di Memora sì. La sidebar
mostra un pallino giallo per una risposta in corso in un'altra chat e verde per
una risposta completata non ancora letta. Lo stato letto è condiviso tra
dispositivi, mentre le notifiche browser a risposta pronta sono opt-in e
richiedono la scheda aperta (Telegram non è ancora implementato). Tornando
nella chat, il client si ricollega agli eventi già prodotti e riprende il testo
parziale. Dopo un riavvio del server i turni in corso vengono marcati come
interrotti.

## Stack
- Debian 13
- Node.js 24 LTS
- TypeScript
- pnpm workspaces
- `@earendil-works/pi-coding-agent`
- Fastify
- React + Vite
- SQLite + FTS5
- Markdown come fonte autorevole

## Comandi

```bash
pnpm install          # installa le dipendenze del monorepo
pnpm dev              # development: backend Fastify su :3000
pnpm build            # build backend + frontend React
pnpm start            # production: Fastify serve API + React su :3000
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm typecheck        # TypeScript strict
pnpm test             # Vitest
pnpm smoke:dist       # smoke dei moduli compilati
pnpm smoke:prod       # smoke del runtime production completo
pnpm embeddings:setup     # download esplicito e verifica offline del modello
pnpm embeddings:benchmark # benchmark sintetico locale (richiede setup)
pnpm eval:memory          # valutazione memoria: lexical, più semantic/hybrid se disponibili
pnpm eval:memory:check    # confronto con evaluation/baseline.json
pnpm memory:metadata:migrate # dry-run metadata dei bullet legacy
pnpm memory:history:prune  # dry-run retention delle versioni superate
pnpm memory:integrity      # controllo read-only di indice, metadata e Inbox
pnpm memory:consolidate    # audit read-only delle memorie attive simili
pnpm memory:consolidate:llm # report LLM read-only su duplicati/conflitti
pnpm memory:feedback      # tuning advisory delle soglie
pnpm projects:migrate     # dry-run project.json per i progetti legacy
```

Variabili d'ambiente (vedi `.env.example`). Le variabili Memora usano il prefisso `MEMORA_*`; le credenziali provider e `NODE_ENV` mantengono i nomi standard.
- `NODE_ENV` (`development` oppure `production`)
- `MEMORA_HOST` (default `127.0.0.1`)
- `MEMORA_PORT` (default `3000`)
- `MEMORA_DATA_DIR` (default `./data`)
- `MEMORA_WEB_DIST_DIR` (opzionale): override della build frontend servita in production
- `MEMORA_ASSISTANT_CWD` (opzionale): CWD isolato delle sessioni personal assistant
- `MEMORA_MEMORY_SEARCH_MODE`: `lexical` (default), `semantic` o `hybrid`.
- `MEMORA_MEMORY_TOP_K` (default `5`), `MEMORA_MEMORY_MAX_CHARS` (default `4000`) e `MEMORA_MEMORY_MAX_TOKENS` (default `1000`, stima `caratteri/4`): limiti del contesto memoria per turno.
- `MEMORA_MEMORY_DIVERSITY` (default `0.15`, `0..1`): penalità di similarità per evitare chunk ridondanti.
- `MEMORA_EMBEDDINGS_ENABLED` (default `false`): carica e indicizza embeddings locali, necessari per `semantic` e `hybrid`.
- `MEMORA_HYBRID_SEARCH_ENABLED` è legacy: `true` seleziona `hybrid` solo se `MEMORA_MEMORY_SEARCH_MODE` non è impostata; la modalità esplicita ha sempre precedenza.
- `MEMORA_EMBEDDING_MODEL` (default `Horizon-Labs/multilingual-embedding-small`) e `MEMORA_EMBEDDING_DIMENSIONS` (default `1024`).
- `MEMORA_MEMORY_CURATOR_ENABLED` (default `false`): abilita il Curator LLM opzionale; `MEMORA_MEMORY_CURATOR_AUTO` (default `true`) abilita le proposte automatiche.
- `MEMORA_MEMORY_CURATOR_PROVIDER` (default `openrouter`) e `MEMORA_MEMORY_CURATOR_MODEL` (default vuoto): provider e modello indipendenti da quelli della chat; `MEMORA_MEMORY_CURATOR_MIN_CONFIDENCE` (default `0.75`) e `MEMORA_MEMORY_CURATOR_MIN_SALIENCE` (default `0.70`) sono soglie separate.
- `MEMORA_MEMORY_QUEUE_MAX_ATTEMPTS` (default `3`) e `MEMORA_MEMORY_QUEUE_RETRY_DELAY_MS` (default `5000`): retry della coda Curator durevole.
- `OPENCODE_API_KEY` e `OPENROUTER_API_KEY`: credenziali provider lette dal secret store locale o dall'environment.
- `MEMORA_CHAT_PROVIDER`: `openrouter` o `opencode-go`; `OPENROUTER_MODEL` resta il nome storico della variabile per il modello chat predefinito. La UI Impostazioni permette di scegliere provider, modello, chiave e livello reasoning.
- `MEMORA_CHAT_REASONING_LEVEL` (default `medium`) e `MEMORA_MEMORY_CURATOR_REASONING_LEVEL` (default `low`): livelli `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

Le variabili di configurazione runtime hanno precedenza su
`$MEMORA_DATA_DIR/config/settings.json`. Un valore impostato dall'ambiente è
mostrato come bloccato nella pagina Impostazioni. Il pannello è organizzato in
pagine: Aspetto, Generale, Chat, Memoria, Curator, Web e Sistema. Embeddings e
dati/provider sono raggruppati nelle pagine Memoria e Sistema.
Token budget e diversità sono modificabili da **Memoria** e si applicano live.
La pagina **Aspetto** gestisce tema chiaro/scuro/sistema, dimensione del testo,
densità, larghezza conversazione e movimento ridotto. Queste preferenze sono
locali al browser (`localStorage`), non vengono inviate al server e si applicano
subito. La sidebar è comprimibile con il pulsante nella topbar o `Ctrl+B`.
- `MEMORA_MEMORY_WRITER_ENABLED` (default `false`): abilita l'estrazione
  automatica conservativa dei candidati memoria. Le richieste esplicite
  (“ricorda che…”, “salva questa informazione…”) funzionano comunque.

## Retrieval semantico locale (opzionale)

Markdown rimane la fonte autorevole; SQLite è un indice ricostruibile, con FTS5
per il lessico e sqlite-vec per embeddings locali. RRF fonde le classifiche,
senza combinare direttamente i punteggi BM25 e cosine. Il default rimane FTS.

Impostare `MEMORA_DATA_DIR` fuori dal repository e, una sola volta, eseguire
`pnpm embeddings:setup`: il modello q8 viene scaricato in `$MEMORA_DATA_DIR/models/`
e verificato offline in un secondo processo. Non inviare contenuti privati al
setup: è il solo passaggio che consente rete e scarica solo il modello. Il runtime
invece vieta il download remoto e genera gli embeddings localmente. Impostare
`MEMORA_EMBEDDINGS_ENABLED=true` e scegliere `MEMORA_MEMORY_SEARCH_MODE=semantic`
o `hybrid`, riavviare e chiamare `POST /api/memory/reindex`
per costruire esplicitamente i vettori. Un reindex successivo riusa i vettori
invariati; se gli embeddings sono disabilitati, il modello manca o fallisce, il
servizio avverte e usa FTS. Una modalità non valida produce warning e usa FTS,
anche se la flag legacy è attiva. Il log di startup riporta la modalità effettiva.
Il caricamento richiede RAM significativa; vedere `tasks/05.4-hybrid-rag.md`.

Per diagnostica, `/api/memory/search?q=...&mode=lexical|semantic|hybrid` seleziona
il motore senza modificare il default. `pnpm embeddings:benchmark` crea una
fixture temporanea sintetica e non usa OpenRouter né dati personali.

## Memory Curator opzionale

Il Curator è disattivato per default. Per provarlo configurare esplicitamente
provider e modello dalla pagina Impostazioni, oppure con
`MEMORA_MEMORY_CURATOR_ENABLED=true`, `MEMORA_MEMORY_CURATOR_PROVIDER`,
`MEMORA_MEMORY_CURATOR_MODEL` e la relativa API key. Il modello è separato da
quello della chat. **Privacy:** quando attivo, fino a tre brevi messaggi utente
precedenti, il turno corrente e fino a cinque chunk correlati vengono inviati al
provider configurato (OpenRouter o OpenCode Go); non è un'elaborazione locale. I controlli per segreti sono conservativi e non possono
garantire il riconoscimento di ogni dato sensibile. Non attivarlo se non si
vuole inviare questo contesto al provider.

Dopo un turno significativo: prefilter → ricerca memoria configurata → una
chiamata Curator → validazione e rilevanza → Memory Inbox → approvazione umana
→ Markdown → reindex. I saluti brevi sono esclusi localmente; la decisione
semantica spetta all'LLM. Le richieste esplicite conservano la priorità alta e,
in caso di errore del Curator, ricadono nel Memory Writer precedente. Un errore
non interrompe la chat. Se il Curator è disattivato il Writer resta invariato.
Quando è attivo, i turni vengono accodati dopo la risposta, con una sola
elaborazione alla volta; la Inbox si aggiorna automaticamente ogni tre secondi.
La coda è limitata a 100 turni in attesa, **solo in memoria**: arresti improvvisi
e riavvii forzati possono perderli; al limite i nuovi turni sono rifiutati e
viene emesso un warning. Lo shutdown regolare attende la coda prima di chiudere
SQLite, ma un timeout forzato del service manager può interromperla.

Rilevanza = media dei cinque valori 0..1 importance, durability, futureUtility,
novelty e confidence; i pesi sono iniziali e non calibrati. Le proposte
automatiche richiedono confidence ≥ 0,75 e rilevanza ≥ 0,70 per default; le
soglie sono configurabili separatamente. Duplicati ad alta
confidenza sono saltati. Un UPDATE è proposto solo quando il testo corrente
corrisponde esattamente a un bullet nella fonte correlata; l'approvazione
verifica nuovamente il bullet e rifiuta modifiche ambigue o obsolete.
Il Curator riceve i bullet esistenti e deve classificare l'update come
`augment`, `replace`, `remove` o `correct`. `proposedText` è sempre lo stato
finale canonico completo, non il delta: per `augment` il controllo backend
verifica che i fatti precedenti sopravvivano e rifiuta una proposta incompleta.
Solo `replace`, `remove` e `correct` possono omettere un valore precedente,
perché l'utente lo ha esplicitamente invalidato.

Il salvataggio automatico si abilita da **Amministrazione → Curator**. Vale solo
per i **nuovi** candidati sopra soglie separate di confidenza e rilevanza
(default 0,90 e 0,85), senza duplicati/conflitti, senza contenuti sensibili o PII
ad alta confidenza e con destinazione nella memoria globale o nel progetto della
chat corrente. Aggiornamenti, conflitti, duplicati e dati personali restano
sempre in revisione manuale. Le approvazioni automatiche vengono registrate con
`approvedBy: auto` e compaiono in **Memory Inbox → Salvati automaticamente**.
Eventi e latenza sono loggati senza testo del turno; il Curator aggiunge al
massimo una chiamata LLM per turno significativo.
I log strutturati distinguono request, response, parse, validation, decision e
persistence, con status HTTP e codici sanitizzati ma senza prompt, risposta o
chunk. OpenRouter riceve `reasoning.enabled=false`; OpenCode Go non accetta quel
parametro e viene quindi omesso. Il modello OpenCode può comunque produrre
reasoning interno: un output troncato viene diagnosticato senza registrare il
contenuto.

## Impostazioni amministrative

L’icona **Impostazioni** nella sidebar permette di modificare le opzioni runtime
senza editare manualmente i file. La configurazione è salvata in
`$MEMORA_DATA_DIR/config/settings.json` con scrittura atomica, JSON leggibile,
schema versionato e mode `0600`. Il file contiene solo override e viene creato
al primo salvataggio; le installazioni esistenti continuano a funzionare con
default + environment senza migrazioni automatiche.

Precedenza: default applicativi → `settings.json` → environment. I campi
provenienti dall'ambiente sono marcati “Gestito dall'ambiente” e non modificabili
dalla UI. Le API sono centralizzate sotto `/api/admin/*`:

```text
GET   /api/admin/settings
PATCH /api/admin/settings
GET   /api/admin/status
```

La sezione **Chat** permette di scegliere OpenRouter o OpenCode Go, salvare la
chiave nel secret store locale, testare la connessione, cercare e selezionare un
modello dal catalogo reale. Il nuovo default vale per le nuove sessioni; le
sessioni esistenti non vengono modificate. Da questa sezione si possono anche
abilitare o disabilitare i titoli automatici delle nuove chat; il fallback
locale resta sempre disponibile. La sezione **Memory Curator** sceglie
provider e modello separati e riutilizza la stessa chiave del provider, senza
chiederne una seconda. Il catalogo OpenRouter usa il catalogo Pi; OpenCode Go usa
l'endpoint remoto con cache di 10 minuti e fallback al catalogo Pi.

Retrieval mode, topK/maxChars, soglie Curator, reasoning, provider/modello Curator,
default Chat e titoli automatici si applicano a caldo; embeddings e abilitazione/disabilitazione del
Curator richiedono un riavvio esplicito. La UI
mostra “Riavvio Memora necessario” e non esegue mai `systemctl` o comandi sudo.
I preset Lite e Standard mostrano le modifiche prima dell'applicazione. Lite è
pensato per VPS con 1–2 GB RAM; Standard per host da almeno 4 GB RAM.

Le API amministrative sono protette dalla login single-user. Le chiavi sono
salvate solo in `$MEMORA_DATA_DIR/config/secrets.json` (mode `0600`, scrittura
atomica) oppure lette dall'environment; `GET` restituisce soltanto stato e
provenienza, mai il valore. La configurazione è adatta a systemd, Docker futuro,
VPS, Proxmox, mini PC e installazioni locali, senza path hardcoded oltre
`MEMORA_DATA_DIR`.

## Login e accesso

Al primo avvio, se non esiste `$MEMORA_DATA_DIR/config/auth.json`, Memora entra
in modalità setup: le API applicative restano bloccate finché non viene scelta
la prima password. Non esiste un nome utente: Memora è personale e single-user.
La prima password impostata vince, quindi completa il setup subito dopo
l'installazione.

- password minima: 12 caratteri;
- hash `scrypt` con salt casuale;
- nessuna password in chiaro;
- cookie `memora_session`, `HttpOnly`, `SameSite=Lax`;
- sessione di 24 ore;
- logout che invalida tutte le sessioni;
- tutte le `/api/*` protette tranne `/api/health`, login, setup e stato auth;
- rate limit sugli accessi falliti;
- nessun token API nella v0.1.

Per il reset della password, dalla macchina che ospita Memora:

```bash
MEMORA_DATA_DIR=/percorso/dati pnpm memora:set-password
```

Il comando chiede la nuova password in modo nascosto e sostituisce
`config/auth.json`. Riavvia Memora dopo il reset. Se il servizio è raggiungibile via HTTP sulla LAN, il cookie
non ha il flag `Secure`; impostare `MEMORA_COOKIE_SECURE=true` solo quando
l'accesso avviene tramite HTTPS. Tailscale cifra il trasporto, ma il login resta
necessario.

## Lingue dell’interfaccia

La UI supporta:

```text
Italiano
English
Français
```

La lingua viene rilevata dal browser, salvata in `localStorage` con la chiave
`memora-language` e può essere cambiata dal selettore in
**Amministrazione → Aspetto**. Il fallback è l’inglese.

Il dizionario è in `apps/web/src/i18n/`: `it` è la lingua sorgente, mentre
`en.ts` e `fr.ts` contengono le traduzioni. Per aggiungere una lingua si copia
un dizionario e si registra il codice in `SUPPORTED_LANGUAGES`.

La lingua della UI non forza la lingua di Memo: l’assistente risponde nella
lingua del messaggio dell’utente.

## Ricerca web

L’accesso web è **disattivato per default**. Si configura da
**Amministrazione → Web** scegliendo Brave Search o SearXNG; la chiave Brave
resta in `$MEMORA_DATA_DIR/config/web.json` con permessi `0600` e non viene mai
restituita dall’API.

Nella chat il pulsante **Web**, accanto agli allegati, abilita la ricerca per
quella sessione. Le fonti consultate compaiono nella scheda **Fonti** del
pannello laterale destro, insieme a File (solo nei progetti), Contesto e
Artefatti. Il pannello è chiuso per default; su desktop si apre automaticamente
sulla scheda pertinente quando arriva una nuova ricerca o viene creato un
artefatto.

Sono supportiti:

- ricerca di pagine;
- lettura del testo HTML con Readability;
- estrazione testo da PDF;
- fonti numerate con citazioni `[n]` nel testo, cliccabili verso la fonte;
- blocco di URL privati/locali, redirect limitati, timeout e limiti di
  dimensione.

Il contenuto web è trattato come **dato non fidato**: non viene mai eseguito e
non può modificare istruzioni, permessi o strumenti. `web_fetch` non usa
JavaScript, cookie o sessioni.

Ogni fonte riceve un numero stabile, mostrato come `[1]`, `[2]` nella scheda
Fonti. Memo deve inserire il riferimento subito dopo ogni informazione ricavata
dal web; se una frase usa più fonti può scrivere `[1][3]`. I riferimenti nella
risposta sono cliccabili e aprono la fonte corrispondente. Passando il mouse o
il focus su un riferimento compaiono sito, titolo e una breve descrizione. I
numeri non vengono riutilizzati quando la cronologia supera le 50 fonti.

Nella scheda Fonti:

- **Ricerca** indica un risultato del motore di ricerca, con titolo e snippet,
  ma la pagina non è ancora stata letta;
- **Letta** indica una pagina effettivamente recuperata e letta da Memo;
- **PDF** indica un PDF letto e convertito in testo.

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

## Memoria

Il confine di fiducia tra memoria, prompt e provider esterni è documentato in
[`docs/MEMORY-SECURITY.md`](docs/MEMORY-SECURITY.md).

La qualità di retrieval e Curator è misurata con dataset sintetici e una baseline
versionata. Comandi, metriche, risultati e limiti sono in
[`evaluation/README.md`](evaluation/README.md).

Ogni bullet scritto da Memora conserva provenienza e versione in un commento
HTML nascosto; gli aggiornamenti mantengono lo storico `superseded` e il reindex
indicizza solo le versioni attive. Formato e migrazione:
[`docs/MEMORY-DATA-MODEL.md`](docs/MEMORY-DATA-MODEL.md).

Le chiavi interne del JSONL e dei metadata Markdown usano il namespace
`memora.*` e `memora-memory:v1`.

La coda Curator durevole, il recupero dopo riavvio e l'audit di consolidamento
sono descritti in [`docs/MEMORY-CURATOR-ROBUSTNESS.md`](docs/MEMORY-CURATOR-ROBUSTNESS.md).
Metriche, alert, backup, restore e degrado controllato sono in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

I progetti sono entità di prima classe. La sidebar è organizzata in **sezioni
personalizzabili**; ogni sezione contiene progetti e ogni progetto contiene le
proprie sessioni. Sezioni e progetti hanno un’icona e possono essere aperti o
chiusi singolarmente; lo stato viene ricordato nel browser. Le azioni delle
righe sono raccolte nel menu verticale `⋮`, visibile solo su hover o focus. Le
chat possono essere messe in evidenza localmente: restano in cima al proprio
gruppo e sono ricordate nel browser. Il modello completo
è in [`tasks/05.9-projects.md`](tasks/05.9-projects.md).

Le sezioni sono salvate in `$MEMORA_DATA_DIR/config/project-sections.json`; ogni
`project.json` può contenere `sectionId` e `icon`. I progetti senza sezione
finiscono in **Senza sezione** e possono essere spostati dalle impostazioni del
progetto.

La pianificazione per anteprime HTML evolute e artefatti Office leggeri
(DOCX, XLSX, PPTX HTML-first) è in
[`tasks/05.10-office-artifacts.md`](tasks/05.10-office-artifacts.md).

### File progetto e allegati chat

Il pannello laterale **a destra** è unico, chiuso per default e organizzato in
quattro aree fisse: **File**, **Contesto**, **Artefatti** e **Fonti**. La scheda
File compare solo quando la chat appartiene a un progetto; le fonti web sono in
Fonti, mentre le fonti del progetto restano nel Contesto. I contatori delle aree
si aggiornano durante il turno. Su desktop il pannello si apre automaticamente
sulla scheda Fonti quando arriva una nuova ricerca e sulla scheda Artefatti,
con il dettaglio del nuovo file, quando viene creato un artefatto. Su mobile
l’auto-apertura è disabilitata.

La scheda File espone il contenuto della directory
`projects/<id>/`, con ricerca, metadati e anteprima per:

- Markdown e testo;
- PDF, tramite il visualizzatore del browser;
- HTML, in iframe sandboxed senza script;
- Word `.docx`, convertito in HTML locale con Mammoth;
- Excel `.xlsx`, con anteprima a fogli in sola lettura;
- immagini comuni.

I `.pptx` caricati nei file del progetto restano scaricabili ma non hanno
anteprima: la preview PPTX è disponibile per le presentazioni generate da
Memora.

Il pulsante **Allega alla chat** copia il file negli allegati della sessione.
Dal composer si possono anche caricare file con la graffetta. Limiti attuali:
8 allegati per messaggio, 15 MB per file; formati `.md`, `.txt`, `.csv`, `.json`,
`.pdf`, `.docx`, `.html`, `.htm` e immagini. Testo, PDF e `.docx` vengono
estratti in locale e passati al modello come dati non fidati nel system prompt
transitorio; le immagini vengono passate come blocchi immagine. Gli allegati
non vengono eseguiti.

Se la chat appartiene a un progetto, un file caricato viene archiviato anche in
`projects/<id>/files/`: diventa subito visibile nel pannello progetto, ma **non**
entra automaticamente nella memoria o nel retrieval. La cartella `files/` è
esclusa dal reindex; la promozione a fonte resta un’azione separata.

I file caricati risiedono in `$MEMORA_DATA_DIR/chat-attachments/<sessionId>/`
e vengono rimossi quando la sessione viene eliminata. I metadati degli allegati
restano nel JSONL Pi come custom entry `memora.attachments`.

La scheda **Contesto** permette di attivare per singola chat memoria globale,
memoria del progetto e fonti del progetto. La scelta è salvata nella sessione
(custom entry `memora.context`) e vale dal messaggio successivo; non modifica la
configurazione del progetto.

Il pannello laterale può essere espanso con il pulsante dedicato per anteprime più ampie. Quando un PDF/HTML è già stato creato, il codice HTML della risposta viene nascosto e sostituito dal riferimento all’artefatto. Le anteprime HTML usano un componente condiviso con viewport Auto/Desktop/Tablet/Mobile, zoom 50%–250%, ricarica e apertura del file originale, sempre in iframe sandboxed senza script o rete.

La scheda **Artefatti** elenca i deliverable creati dal modello. Il tool
`create_artifact` produce Markdown, HTML, SVG, testo, JSON, CSV o codice senza
eseguire Python. Gli artefatti stanno in `$MEMORA_DATA_DIR/artifacts/<sessionId>/`
e possono essere aperti o scaricati; HTML/SVG restano in sandbox. Ogni riga
dell’elenco offre download, eliminazione e allegato al prossimo messaggio della
chat. Aprendo un artefatto, il nome e il selettore **Variante** (`v1`, `v2`,
ecc.) sono subito sotto **← Artefatti**. Accanto ad **Apri** ci sono eliminazione,
allegato alla chat e **Aggiungi al progetto**: Markdown/testo vengono importati
nelle fonti indicizzate del progetto, gli altri formati in `files/`. La conferma
di eliminazione usa una modale dedicata, non `window.confirm`. L’anteprima
dispone dei controlli zoom (50%–250%).

Gli artefatti con lo stesso nome nella stessa chat non vengono duplicati: la
versione precedente viene conservata in `.versions/` e la UI mostra `v1`, `v2`,
ecc. sullo stesso artefatto.

Gli artefatti creati in un turno compaiono anche come card di download direttamente
nella risposta dell’assistente, oltre che nel pannello laterale. Ogni card è
associata al messaggio sorgente, quindi il collegamento resta corretto dopo un
reload. Per artefatti PDF, HTML e PPTX un modello con supporto immagini può essere
usato con **Rivedi anteprima**: Memora genera un’anteprima PNG, la invia come
allegato immagine insieme al contesto e lascia al modello creare una versione
migliorata. L’azione è manuale e non avvia loop automatici; la versione precedente
resta disponibile.

### Controlli chat

- quando il modello espone il ragionamento, un pannello **Ragionamento** compatto
  mostra un’anteprima live e può essere espanso per seguire tutto il pensiero;
  dopo un reload il ragionamento completato viene ricostruito dal transcript Pi;
- ogni messaggio ha il pulsante **copia**: testo semplice per la domanda,
  Markdown per la risposta;
- le domande hanno **Modifica**: la modifica crea un nuovo ramo Pi, mantenendo
  lo storico nel JSONL, e rigenera la risposta;
- le risposte hanno **Riformula** e **PDF**;
- dopo la risposta il composer torna automaticamente in focus.

Per i PDF esiste il tool `create_pdf`: riceve solo titolo, formato e nome file,
non il documento. Dopo la chiamata il modello scrive il documento nella
risposta finale e Memora lo renderizza lato server. Con `format: "html"` il
modello può produrre una pagina HTML con CSS; Memora usa Chromium headless per
una resa fedele e `html-to-pdfmake`/`pdfmake` come fallback leggero. In
alternativa il pulsante **PDF** su una risposta crea un artefatto PDF dal testo
già presente, senza un’altra chiamata al modello. Anche un artefatto
HTML/Markdown può essere convertito con **Esporta PDF**. Limiti iniziali:
30.000 caratteri Markdown, 60.000 caratteri HTML, 30 pagine, 5 MB. Il PDF non
entra mai nel contesto del modello.

Il renderer HTML usa CSS inline e, quando Chromium è disponibile, supporta anche
layout complessi. Il fallback PDFMake supporta un sottoinsieme CSS. L’anteprima
PDF usa PDF.js e non dipende dal plugin PDF del browser.

Con il tool `create_docx` il modello scrive il documento in Markdown nella
risposta finale; Memora genera un `.docx` Word e ne mostra l’anteprima
semantica tramite Mammoth, senza inviare contenuto aggiuntivo al modello.

Con `create_xlsx` il modello scrive una o più tabelle Markdown: ogni tabella
diventa un foglio `.xlsx`, il titolo precedente diventa il nome del foglio e
l’anteprima mostra schede, intestazioni e formattazione essenziale senza
valutare formule.

Con `create_pptx` il modello scrive un deck HTML con sezioni
`<section class="slide">`: lo stesso HTML alimenta la preview e la conversione
in `.pptx` tramite `jsdom` e `pptxgenjs`. Titoli, paragrafi, liste, tabelle e
immagini `data:` sono supportati; layout CSS complessi restano visibili nella
preview HTML ma non sono garantiti nel file PowerPoint.

Per preparare Chromium su Debian:

```bash
pnpm pdf:browser:setup
```

Le librerie vengono salvate in `$MEMORA_DATA_DIR/browser-libs/`. È possibile
usare `MEMORA_PDF_BROWSER_LIBS` o `MEMORA_PDF_BROWSER_PATH` per path esterni.
Senza Chromium il rendering continua con il fallback PDFMake.

API:

```text
GET  /api/projects/:id/files
GET  /api/projects/:id/files/content?path=...
GET  /api/projects/:id/files/preview?path=...
POST /api/projects/:id/artifacts
DELETE /api/projects/:id
POST /api/sessions/:id/attachments
POST /api/sessions/:id/attachments/from-project
POST /api/sessions/:id/attachments/from-artifact
GET  /api/sessions/:id/attachments/:attachmentId
DELETE /api/sessions/:id/attachments/:attachmentId
GET  /api/sessions/:id/context
PATCH /api/sessions/:id/context
GET  /api/sessions/:id/artifacts
GET  /api/sessions/:id/artifacts/:artifactId
GET  /api/sessions/:id/artifacts/:artifactId/preview
DELETE /api/sessions/:id/artifacts/:artifactId
POST /api/sessions/:id/artifacts/pdf
POST /api/sessions/:id/artifacts/:artifactId/pdf
```

Versioni superate, retention, cancellazione, backup e memoria storica sono
documentati in [`docs/MEMORY-LIFECYCLE.md`](docs/MEMORY-LIFECYCLE.md).

Budget token, filtri, diversità e reranking del retrieval sono descritti in
[`docs/MEMORY-RETRIEVAL-QUALITY.md`](docs/MEMORY-RETRIEVAL-QUALITY.md).

La conversazione non è memoria. Dopo un turno, Memora può creare uno o più
`MemoryCandidate` e mostrarli nella Memory Inbox. I candidati pending non sono
indicizzati e non modificano il Second Brain. Solo dopo Approva il contenuto
viene scritto in un file Markdown sotto `MEMORA_DATA_DIR` e reindicizzato.

La sidebar espone due icone separate: **Second Brain** e **Impostazioni**.
La pagina Second Brain raccoglie tutte le memorie Markdown globali e di progetto
in un unico punto, con ricerca, filtro globale/progetto e modifica diretta del
Markdown. Il pannello **Memoria della chat**, in basso, contiene la Memory Inbox
e i collegamenti alle memorie globali/di progetto; non è più la pagina completa
del Second Brain.

Una risposta dell’assistente può essere promossa esplicitamente con il pulsante
**Memoria**. La risposta diventa un candidato con provenienza
`sourceKind: assistant`; non viene scritta automaticamente e richiede sempre
l’approvazione nella Memory Inbox.

- fonte autorevole: Markdown;
- indice ricostruibile: SQLite/FTS5;
- candidate/audit: `memory-inbox/candidates.jsonl`;
- nessuna scrittura automatica non approvata;
- nessun segreto viene proposto o scritto automaticamente.

Le memorie già approvate possono essere aperte, modificate o eliminate dalla
sezione Second Brain. Il client usa solo il source ID: il backend risolve il
file dall'indice, valida la directory Markdown e riscrive atomicamente solo il
file target. Dopo edit/delete esegue il reindex, quindi la ricerca vede subito
il nuovo contenuto o la sua assenza.

I file core `memory/profile.md`, `memory/preferences.md` e `memory/decisions.md`
sono modificabili; la UI non mostra la cancellazione completa perché possono
contenere più memorie. Non esiste ancora il delete del singolo bullet.

## Contribuire

Le linee guida, il setup di sviluppo e il Developer Certificate of Origin sono
in [`CONTRIBUTING.md`](CONTRIBUTING.md). Prima di una modifica importante,
aprire una issue per discutere il design.

## Sicurezza

Non aprire issue pubbliche per vulnerabilità. Usare il private vulnerability
reporting di GitHub; dettagli in [`SECURITY.md`](SECURITY.md).

## Licenza

Memora è distribuito secondo i termini di **AGPL-3.0-only**. I contributi sono
accettati con la stessa licenza e richiedono sign-off DCO. I marchi **Memora** e
**Memo** sono soggetti a [`TRADEMARKS.md`](TRADEMARKS.md); le note di terze parti
sono in [`NOTICE`](NOTICE).
