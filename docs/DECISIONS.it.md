# Architecture Decision Log

**Italiano** | [English](DECISIONS.md)

Formato:

## ADR-000 — Titolo
**Data:** YYYY-MM-DD
**Stato:** proposed | accepted | superseded

### Contesto
### Decisione
### Conseguenze

---
## ADR-005.5d — UPDATE come stato finale canonico
**Stato:** accepted

Un UPDATE non può essere un delta: l'approvazione sostituisce un bullet, quindi
il Curator riceve i bullet esistenti e restituisce uno stato finale autonomo.
L'intento è `augment`, `replace`, `remove` o `correct`. Per AUGMENT il backend
verifica che i token informativi della memoria precedente siano conservati e
rifiuta proposte incomplete; per le altre intenzioni la rimozione è ammessa
solo perché l'utente l'ha dichiarata. Sono rifiutate proposte non autonome o
prive dell'entità di progetto. La validazione è conservativa e basata su token:
non comprende equivalenze semantiche perfette. La risposta del provider può
essere piatta o contenere un singolo oggetto in `memories`; più memorie sono
rifiutate perché il flusso MVP produce un candidato per turno.

---
## ADR-005.5c — Curator fuori dal percorso SSE e diagnostica sicura
**Stato:** accepted

Con Curator abilitato, i turni sono messi in una coda seriale limitata e
volatile, avviata dopo l'invio della risposta SSE. Gli errori della coda sono
osservabili senza contenuti; lo shutdown regolare attende il completamento prima
di chiudere SQLite. Crash o riavvii forzati possono perdere turni in attesa;
non si introduce un broker né persistenza che replichi la cronologia. La Inbox
ricontrolla il candidate store ogni tre secondi.

I log strutturati distinguono gli stage senza registrare prompt o risposta.
Nel test reale Nemotron ha consumato 700 token in reasoning e restituito
contenuto nullo; il provider richiede ora `reasoning.enabled=false`. Il modello
può non rispettare o supportare questa opzione: i casi di troncamento e timeout
restano espliciti nei log. Le soglie di confidence e salience sono ora separate
(default 0,75 e 0,70): la confidence resta invariata, mentre una salience 0,74
per un aggiornamento rilevante era stata scartata dalla soglia condivisa 0,75.
I valori sono parametri iniziali configurabili, non soglie calibrate.

---
## ADR-005.5b — Curator LLM opt-in con revisione umana
**Stato:** proposed — in attesa dell'E2E con provider reale

Un provider sostituibile analizza solo l'ultimo turno utente, una breve finestra
di precedenti messaggi utente e fino a cinque chunk correlati. Il provider reale
usa una singola chiamata al provider configurato (OpenRouter o OpenCode Go),
separata dalla chat e spenta per default; questa scelta invia dati al provider ed è documentata. Un
prefilter leggero evita turni triviali. I controlli segreti sono euristici.

La risposta JSON viene validata; il routing è deciso dal backend. La salience
è la media non calibrata dei cinque score; confidence e salience sotto le
rispettive soglie escludono il candidato automatico. I duplicati ad alta confidence sono
saltati. UPDATE richiede corrispondenza esatta di un bullet correlato e nuova
verifica all'approvazione; altrimenti diventa conflitto. I candidate continuano
a richiedere approvazione umana. Errori del provider non bloccano la chat e le
richieste esplicite ricadono nel Writer precedente.

---
## ADR-005.5a — Granularità dei bullet nella memoria strutturata
**Stato:** accepted

Per rendere ricercabili fatti indipendenti, le sezioni composte esclusivamente
da almeno due bullet autonomi su una riga in `memory/` e `projects/` vengono
indicizzate un bullet per chunk, con heading e line range. Liste complesse,
prosa e documenti mantengono il chunking precedente. Il reindex confronta anche
i chunk di file invariati, aggiornando l'indice derivato senza toccare Markdown.
Questa decisione non implementa né attiva il Memory Curator.

---
## ADR-005.4.1 — Modalità retrieval esplicita
**Stato:** accepted

`MEMORA_MEMORY_SEARCH_MODE` seleziona lexical, semantic o hybrid; default lexical.
La variabile esplicita prevale sulla flag legacy hybrid, che è considerata solo
se la modalità non è impostata. Un valore invalido, embeddings disabilitati o
un provider non disponibile producono warning e fallback lexical. Le sessioni
nuove e riprese continuano a usare lo stesso MemoryService. RRF non cambia.

---
## ADR-005.4 — Retrieval ibrido locale opt-in
**Stato:** accepted

Markdown resta autorevole e SQLite ricostruibile. FTS5 è mantenuto per nomi e
codici; sqlite-vec 0.1.9 sulla stessa connessione contiene vettori Float32
cosine con metadati hash/modello/dimensioni. Transformers.js 4.3.2 esegue
localmente l'ONNX q8; il download esplicito usa `$MEMORA_DATA_DIR/models`, il
runtime non scarica. L'API provider è sostituibile; errori del modello non
impediscono l'uso di FTS. RRF con k=60 fonde rank anziché score eterogenei.

Il benchmark sintetico N95 mostra un miglioramento recall/MRR rispetto a FTS,
ma non giustifica un default automatico: lexical rimane il default e
l'abilitazione richiede setup e reindex espliciti. La memoria aggiuntiva è
significativa (~780 MiB nel test); l'indice vec0 viene interrogato con overfetch
per rispettare il filtro categoria, scelta semplice ma non ottimale su corpora
molto grandi. Cambio di modello rilevato dal suo identificativo: sostituire i
pesi mantenendo lo stesso identificativo richiede rebuild esplicito dell'indice.

---
## ADR-001 — Monorepo pnpm, TypeScript strict, Fastify health
**Data:** 2026-11-10
**Stato:** accepted

### Contesto
Task 00 richiede una base minima e riproducibile: monorepo, TypeScript strict, pnpm, lint/test, health endpoint. Senza integrare ancora il Pi SDK.

### Decisione
- Struttura monorepo con `pnpm-workspace.yaml`: `apps/*` (server, web) e `packages/*` (agent, memory, shared).
- Root `tsconfig.json` con riferimenti composite; ogni workspace estende `tsconfig.base.json` (strict, ESNext, moduleResolution bundler).
- Server: Fastify con `GET /api/health` (bind `127.0.0.1` default).
- Web: Vite + React (placeholder).
- Testing: Vitest.
- Lint: ESLint flat config + Prettier.
- `shamefully-hoist=true` in `.npmrc` per risoluzione moduli affidabile sotto pnpm.
- Pi SDK deliberatamente NON integrato (rimandato a Task 01).

### Consequenze
- Build emette in `dist/` (gitignored).
- `tsc --build`, `eslint`, `vitest run` passano.
- Endpoint `/api/health` risponde `{"status":"ok","service":"memora"}` su localhost.
- L'integrazione con `@earendil-works/pi-coding-agent` è rimandata a Task 01.

---
## ADR-002 — Integrazione Pi SDK ufficiale e AgentService
**Data:** 2026-11-10
**Stato:** accepted

### Contesto
Task 01 richiede l'integrazione di `@earendil-works/pi-coding-agent` come dipendenza esterna per fornire AgentService con creazione sessione, invio prompt, streaming, abort e ripresa sessione.

### Decisione
- `@earendil-works/pi-coding-agent@1.5.2` (versione esatta, non `^`) aggiunto come dipendenza diretta di `@memora/agent` (non forkato, non vendoring).
- `AgentService` creato in `@memora/agent/src/index.ts` che incapsula `createAgentSession`, `ModelRuntime`, `SessionManager` dell'SDK.
- `MEMORA_DATA_DIR` usato per derivare:
  - session directory: `$MEMORA_DATA_DIR/pi-sessions/`;
  - Pi config dir: `$MEMORA_DATA_DIR/.pi/` (mai `~/.pi`).
- OpenRouter configurato tramite `ModelRuntime.setRuntimeApiKey('openrouter', OPENROUTER_API_KEY)` a runtime (chiave mai scritta su disco, mai nel repository).
- `cwd` esplicito e configurabile via `MEMORA_CWD` env.
- Sessioni usano il formato JSONL nativo di Pi tramite `SessionManager`.
- API Fastify esposta in `@memora/server`: POST /api/sessions, GET /api/sessions, GET /api/sessions/:id, POST /api/sessions/:id/messages (SSE streaming), POST /api/sessions/:id/abort.
- Test con mock dell'SDK (vitest + vi.mock), nessun credito OpenRouter consumato.
- Il SDK include `dist/index.d.ts` ufficiale; nessun file `.d.ts` locale mantenuto.
- I symlink workspace sono creati automaticamente da `pnpm install` tramite `workspace:*` nei `dependencies` dei package che li usano (nessun script custom, nessun `postinstall`, nessuna manipolazione manuale di `node_modules/`).
- TypeScript risolve direttamente i tipi reali forniti da `@earendil-works/pi-coding-agent/dist/index.d.ts` attraverso i symlink di pnpm (nessuno shim locale, nessun `any` ambientale, nessun `paths` fittizio).
- `tsconfig.base.json` usa `moduleResolution: bundler` e `module: ESNext` (valori standard del progetto).
- `.npmrc` contiene solo `ignore-scripts=false` (nessun `public-hoist-pattern`, nessun `shamefully-hoist`).
- `pnpm-workspace.yaml` contiene solo la configurazione standard dei package workspace e `allowBuilds`.

### Consequenze
- `tsc --build`, `eslint`, `vitest run` passano su un clone pulito con il solo `pnpm install`.
- Nessuna API key nel repository.
- Nessun percorso hardcoded (`$HOME`, directory del progetto, `~/.pi`).
- Le sessioni risiedono in `$MEMORA_DATA_DIR/pi-sessions/` (formato JSONL nativo Pi).
- L'SDK rimane aggiornabile come dipendenza esterna (versione bloccata a 1.5.2 per riproducibilità).

---
## ADR-003 — Session Management: rename, archive, modelId nella lista
**Data:** 2026-11-10
**Stato:** accepted

### Contesto
Task 03 richiede la gestione delle sessioni: rinomina (display name), archiviazione soft-delete, modelId nella lista sessioni, restart test automatizzato, branching documentato ma non implementato.

### Decisione
- **Rinomina**: usa `SessionManager.appendSessionInfo(name)` nativo di Pi SDK. Il nome viene memorizzato come entry di tipo `session_info` nel JSONL, recuperabile tramite `SessionManager.getSessionName()`. Endpoint: `PATCH /api/sessions/:id` con body `{ name: string }`.
- **Archiviazione**: usa `SessionManager.appendCustomEntry('memora.session-meta', { archived: true/false })` nativo di Pi SDK. La custom entry non partecipa al contesto LLM (vedi documentazione SDK: CustomEntry non partecipa a buildSessionContext). L'ultima entry determina lo stato corrente. Endpoint: `PATCH /api/sessions/:id/archive` con body `{ archived: boolean }`.
- **GET /api/sessions**: restituisce `name` (da session_info nativa) e `archived` (da custom entry). Per default esclude le sessioni archiviate; con `?archived=true` le include. Non aggiunge `modelId` alla lista perché richiederebbe di aprire ogni sessione (operazione costosa); `modelId` è disponibile via `GET /api/sessions/:id`.
- **Restart test**: integration test vitest che simula dispose + nuova istanza AgentService con stessa data directory, usando mock dell'SDK (nessuna chiamata OpenRouter reale).
- **Branching**: documentato come supportato nativamente da Pi SDK ma non esposto in Task 03.
- **Nessun database separato**: JSONL Pi rimane fonte autorevole; metadata Memora (nome, archiviazione) vive come entry nel JSONL stesso.

### Consequenze
- `tsc --build`, `eslint`, `vitest run`, `pnpm build` passano.
- 13 test passano (11 esistenti + 2 nuovi integration test restart).
- Nessuna API key nel repository.
- Nessun percorso hardcoded.
- Nessun nuovo database creato.
- UI: sidebar mostra `name ?? firstMessage`, tasto archivia/ripristina, tasto rinomina, vista archiviate toggle.
- Decisione architetturale documentata: "Pi session JSONL remains the source of truth for session metadata; Memora-specific lightweight metadata is stored as Pi custom entries."

---
## ADR-004a — Session delete esplicito e irreversibile
**Data:** 2026-11-14
**Stato:** accepted

### Contesto
La gestione sessioni richiede ora anche la cancellazione definitiva delle chat. La precedente decisione MVP che la escludeva è superata.

### Decisione
- Archive resta reversibile: `memora.session-meta` è metadata soft nel JSONL.
- Delete è un'azione esplicita e irreversibile: `DELETE /api/sessions/:id` elimina il solo JSONL identificato dal `SessionManager`.
- Il backend dispone/aborta prima una sessione caricata, rimuove lo stato runtime e verifica con `realpath` che il file sia direttamente sotto `$MEMORA_DATA_DIR/pi-sessions/`; il client non invia mai filepath.
- Il frontend richiede conferma accessibile e normalizza la selezione dopo la cancellazione.

### Conseguenze
- Una chat eliminata non ricompare dopo refresh e non può essere ripristinata.
- Un ID stale in URL/localStorage viene scartato senza effettuare richieste di resume/messages.
- Nessuna chiamata OpenRouter è necessaria per i test di delete.

---
## ADR-004 — Second Brain: Markdown scanner, SQLite FTS5, retrieval
**Data:** 2026-11-10
**Stato:** accepted

### Contesto
Task 04 richiede l'integrazione di un Second Brain: scanner Markdown, indicizzazione SQLite FTS5, retrieval semantico basato su full-text search, iniezione di contesto nelle sessioni Pi tramite hook `before_agent_start`, e UI per la consultazione delle fonti.

### Decisione
- **Dati runtime**: tutti i file Markdown della knowledge base risiedono sotto `$MEMORA_DATA_DIR/{memory,projects,journal,documents}/`. Più nulla è hardcoded.
- **Scanner**: `scanMarkdown()` scandisce ricorsivamente solo file `.md` nelle quattro directory. Esclude JSONL, segreti, .env, database, codice sorgente. Protegge contro path traversal e symlink che escono dalla data directory.
- **Chunking**: deterministico, basato su heading Markdown (`#`, `##`, `###`...) e paragrafi. Massimo 2000 caratteri per chunk. Stesso input produce sempre gli stessi chunk.
- **Indice**: SQLite + FTS5 sotto `$MEMORA_DATA_DIR/index/memora.sqlite`. Tabella `memory_sources` (metadati file), `memory_chunks` (chunk di testo), `memory_chunks_fts` (indice full-text). Indice ricostruibile da zero in qualsiasi momento.
- **Reindex incrementale**: confronta content hash (SHA-256) e mtime. File nuovi → indicizzati; modificati → aggiornati; cancellati → rimossi; invariati → lasciati.
- **MemoryService**: package `@memora/memory`. Espone `initialize()`, `reindex()`, `search()`, `listSources()`, `getSource()`, `close()`.
- **Retrieval automatico**: prima di ogni nuovo turno utente, l'hook `before_agent_start` del Pi SDK 1.5.2 (registrato tramite `session.extensionRunner.on()`) esegue `memoryService.search()` e inietta i chunk recuperati nel system prompt del turno. I chunk NON vengono scritti nei JSONL né modificano il testo utente. Il contesto è transitorio per singolo turno.
- **API HTTP**: `GET /api/memory/search?q=`, `POST /api/memory/reindex`, `GET /api/memory/sources`.
- **UI**: pannello "Memoria utilizzata" nella chat che mostra le fonti usate nell'ultimo turno; sezione Second Brain con elenco fonti e ricerca manuale.
- **Template open source**: `templates/memory/profile.md`, `templates/memory/preferences.md`, `templates/memory/decisions.md`, `templates/projects/esempio-progetto.md`. Nessun dato personale reale nel repository.
- **Test**: 13 test automatici (scan, chunking, search, reindex idempotente, path traversal, symlink escape, DB cancellato e ricostruito, retrieval con/senza risultati). Nessuna chiamata OpenRouter reale.
- **Collaudo E2E finale del retrieval**: eseguito con un token univoco casuale assente dal repository e mantenuto nel runtime. FTS ha recuperato la fonte corretta, `memory_sources` è stato emesso, il token è arrivato al modello tramite il context transitorio e non è stato persistito nei messaggi `user`/`system` o nelle entry `custom` del JSONL. Resume e cleanup con reindex sono passati.
- La risposta finale non ha restituito il token per il comportamento del modello selezionato da `openrouter/free`, non per un fallimento del retrieval. `openrouter/free` non è quindi deterministico per acceptance test che validano il testo della risposta.

### Consequenze
- `tsc --build`, `eslint`, `vitest run`, `pnpm build` passano.
- 26 test totali passano (13 agent + 13 memory).
- Nessuna API key nel repository.
- Nessun percorso hardcoded.
- Nessun nuovo database oltre all'indice SQLite ricostruibile.
- `MEMORA_DATA_DIR` rispettato come directory principale dei dati runtime.
- L'SDK Pi rimane dipendenza esterna aggiornabile (versione 1.5.2).
- Decisione architetturale documentata: "Markdown = knowledge source of truth; SQLite/FTS5 = rebuildable search index; Pi JSONL = conversation source of truth."

---
## ADR-005 — Acceptance E2E con modello esplicito e dati semanticamente neutri
**Data:** 2026-11-13
**Stato:** accepted

### Contesto
Il collaudo E2E ha verificato la catena completa del retrieval: token runtime assente dal repository, ricerca FTS della fonte, emissione di `memory_sources`, trasferimento nel context transitorio del modello, user message invariato nel JSONL, assenza del retrieval context dalla history, resume e cleanup riusciti. Il router `openrouter/free` ha però scelto un modello che ha rifiutato di restituire il token; il tool call effettuato non ha recuperato il token.

### Decisione
- `openrouter/free` non deve essere usato come modello deterministico per acceptance test che confrontano la risposta assistant.
- I futuri test E2E devono configurare un modello fisico esplicito e registrare il modello effettivamente usato quando disponibile.
- I dati di test devono essere fittizi e semanticamente neutri, evitando formulazioni come "riservato", "segreto" o equivalenti che possono attivare rifiuti del modello.
- Le asserzioni sul retrieval (FTS, `memory_sources`, context transitorio e isolamento JSONL) restano separate dalle asserzioni sul testo generato dal modello.

### Conseguenze
- Il retrieval pipeline di Task 04 è considerato verificato.
- L'acceptance della risposta LLM richiede un nuovo collaudo con modello esplicito e dati semanticamente neutri.
- Nessuna chiamata LLM è necessaria per validare FTS, reindex, isolamento del context, resume o cleanup.

---
## ADR-006 — Web Chat: normalizzazione dei content block e streaming SSE
**Data:** 2026-11-13
**Stato:** accepted

### Contesto
Il test manuale della Web Chat ha evidenziato due problemi indipendenti dal retrieval: il frontend leggeva il payload SSE annidato al livello sbagliato e la history trasformava i content block Pi non testuali in JSON grezzo. Inoltre la chiusura dello stream usava uno snapshot React obsoleto di `streamingContent`.

### Decisione
- Il backend mantiene l'envelope SSE esistente; il client espone al frontend il `payload` reale dell'`AgentSessionEvent` Pi.
- `normalizePiContent()` è l'unica regola condivisa per estrarre i blocchi `text`. Thinking/reasoning, firme, tool call, tool result e blocchi sconosciuti non diventano testo UI.
- Lo streaming concatena i `text_delta` in un ref e in uno state React, finalizzando una sola volta su `message_end`/`turn_end` conclusivo o `agent_end`.
- `memory_sources` resta un evento separato e alimenta esclusivamente il pannello delle fonti.
- La history espone solo messaggi user/assistant con testo visibile; system e tool messages restano nel JSONL Pi ma non vengono renderizzati nella chat.

### Conseguenze
- User message e assistant placeholder sono visibili senza refresh.
- La risposta assistant si aggiorna progressivamente e non viene duplicata alla finalizzazione o al refresh.
- Lo storico e lo streaming usano la stessa normalizzazione dei content block.
- Sono coperti i casi text + thinking, thinkingSignature, text multipli, parità storico/streaming e separazione di `memory_sources`.

---
## ADR-007 — Viste sessioni disgiunte e cancellazione osservabile
**Data:** 2026-11-13
**Stato:** accepted

### Contesto
Il flusso sessioni aveva due ambiguità operative: `archived=true` includeva anche le sessioni attive e il frontend cambiava solo l'etichetta della vista senza ricaricare il filtro corrispondente. Inoltre il dialog DELETE veniva chiuso prima di sapere se la richiesta e il refresh fossero riusciti, nascondendo gli errori all'utente.

### Decisione
- `GET /api/sessions` restituisce esclusivamente sessioni non archiviate.
- `GET /api/sessions?archived=true` restituisce esclusivamente sessioni archiviate; non esiste più una modalità "include archived".
- Il frontend ricarica esplicitamente il filtro quando cambia vista e ignora le risposte di richieste obsolete, così una lista precedente non può sovrascrivere quella corrente.
- Il DELETE valida metodo, ID e body `{ sessionId, deleted: true }`; il refresh viene eseguito solo dopo una risposta valida. Un errore mantiene aperto il dialog e viene mostrato in modo leggibile.
- Le richieste senza body (GET e DELETE) non inviano `Content-Type: application/json`: Fastify rifiuterebbe un body JSON vuoto con `400 FST_ERR_CTP_EMPTY_JSON_BODY`. Il content-type viene impostato solo quando viene serializzato un body JSON.
- Dopo una cancellazione riuscita il JSONL resta la fonte autorevole: la lista viene ricaricata dal backend e la selezione, URL e localStorage vengono puliti solo quando riferiscono la sessione cancellata.
- Il controllo della vista archiviate usa solo un'icona SVG archive/tray, con `aria-label`, `title`, `aria-pressed` e stato attivo visibile.

### Conseguenze
- Archive/restore sposta una sessione tra le due viste senza duplicazioni.
- Delete di una sessione selezionata svuota la chat e pulisce i riferimenti persistiti; delete di una non selezionata non cambia la chat aperta.
- I test automatici coprono filtro archive/restore, delete del JSONL, 404 al secondo DELETE, contratto HTTP e transizione della selezione senza chiamate OpenRouter.

---
## ADR-008 — Nuove chat visibili subito come bozze in memoria
**Data:** 2026-11-13
**Stato:** accepted

### Contesto
Pi SDK crea il file JSONL solo quando la sessione contiene il primo messaggio user/assistant. Una sessione appena creata esiste quindi nel runtime ma non in `SessionManager.list()`, e scompariva dalla sidebar fino al primo messaggio. Creare un JSONL vuoto o un messaggio artificiale avrebbe violato il formato e il contesto della sessione Pi.

### Decisione
- `AgentService.listSessions()` unisce alle sessioni persistite le sessioni caricate in memoria che non hanno ancora un JSONL, marcandole con `draft: true`.
- Le bozze compaiono solo nella vista attive, con titolo “Nuova chat”.
- Rename/archive di una bozza restituiscono `409 session_not_persisted`; la UI nasconde quelle azioni e consente comunque la cancellazione, che rimuove la sessione solo dal runtime.
- Dopo il primo turno la UI ricarica la lista: il JSONL è stato materializzato da Pi e la bozza viene sostituita dalla sessione persistita, senza duplicati.
- “Nuova chat” riporta sempre alla vista attive, anche se l'utente stava guardando l'archivio.

### Conseguenze
- La nuova chat è visibile immediatamente senza file vuoti, entry artificiali o chiamate OpenRouter.
- Le bozze non sopravvivono a un riavvio del backend: non contengono ancora dati conversazionali.
- Le viste attive e archiviate restano disgiunte anche con sessioni appena create.

---
## ADR-009 — Layout responsive: shell, topbar e pannelli collassabili
**Data:** 2026-11-13
**Stato:** accepted

### Contesto
La UI mescolava stili inline e CSS, la barra del modello occupava una riga separata, il Second Brain aperto riduceva lo spazio della chat e su mobile la sidebar restava sempre visibile lasciando poco spazio alla conversazione.

### Decisione
- Shell unica `app → sidebar + main-panel`, con topbar contenente titolo della conversazione e selettore modello.
- Chat con larghezza massima leggibile, messaggi differenziati per ruolo e composer ancorato al fondo.
- Second Brain convertito in pannello `<details>` collassabile, chiuso per default, senza perdere ricerca e fonti.
- Su viewport inferiori a 900px la sidebar diventa un drawer con backdrop e pulsante di chiusura; su mobile la topbar espone il toggle del pannello.
- Stili spostati in `index.css` con variabili colore, stati focus visibili e rispetto di `prefers-reduced-motion`.

### Conseguenze
- La chat dispone di più spazio verticale e la lettura è più stabile su desktop e mobile.
- Nessuna modifica al protocollo API o al formato delle sessioni.
- `pnpm build`, typecheck, lint e test restano la verifica riproducibile del layout.

---
## ADR-010 — Memory Writer con approvazione esplicita
**Data:** 2026-11-13
**Stato:** accepted — esteso da ADR-044 per l’auto-salvataggio opzionale dei nuovi ricordi

### Contesto
Il Second Brain aveva già Markdown come fonte autorevole, SQLite/FTS5 come indice ricostruibile e retrieval automatico. Mancava la scrittura. Scrivere direttamente ogni informazione emersa dalla conversazione avrebbe reso la knowledge base rumorosa e difficile da correggere.

### Decisione
- La pipeline è `conversazione → MemoryCandidate → dedup/conflict → Memory Inbox → approvazione → Markdown → reindex`.
- I candidate vivono append-only in `$MEMORA_DATA_DIR/memory-inbox/candidates.jsonl`; l'ultima versione per ID è lo stato corrente e le versioni precedenti costituiscono audit minimale. Non vengono inseriti nell'indice FTS né nei JSONL di conversazione.
- `MemoryCandidate` contiene testo proposto, categoria, progetto, destinazione, sezione, rationale sintetica, stato, origine, priorità, duplicato/conflitto e campi di revisione. Non contiene chain-of-thought.
- Le richieste esplicite (`ricorda che...`, `salva questa informazione...`, `aggiungi al second brain...`, `da ora in poi...`) sono estratte localmente e producono sempre un candidato pending, anche con writer automatico OFF.
- L'estrazione automatica è conservativa, locale, basata su indicatori testuali e disattivata di default con `MEMORA_MEMORY_WRITER_ENABLED=false`. Il Task 05 non introduce una chiamata LLM aggiuntiva.
- Dedup/conflict usano `MemoryService.search()` e normalizzazione/Jaccard testuale. Un duplicato probabile resta pending e viene segnalato; un possibile aggiornamento/contraddizione diventa `conflict` con contenuto esistente visibile.
- Approve valida il target (solo `memory/`, `projects/`, `journal/`, `.md`, niente traversal/symlink), scrive atomicamente un bullet nella sezione scelta, senza duplicare heading o bullet identici, poi esegue reindex. Reject non modifica Markdown.
- Il rilevamento segreti blocca API key, password, token, private key, cookie e credenziali comuni. Per una richiesta esplicita viene conservato solo un audit redatto; per l'estrazione automatica il candidato viene scartato.
- La UI espone Memory Inbox nella sezione Second Brain con Approva, Modifica, Rifiuta, testo, categoria, progetto, destinazione e confronto con il contenuto esistente.

### Conseguenze
- Conversazione ≠ memoria e candidate ≠ approved memory: solo il Markdown approvato è conoscenza autorevole.
- Dopo Approva il contenuto è subito recuperabile senza riavvio, perché il reindex è automatico.
- Il diff completo del file non è ancora mostrato; la preview MVP mostra cosa verrà aggiunto, dove e l'eventuale conflitto.
- I conflitti approvati aggiungono il nuovo contenuto senza cancellare quello vecchio: la risoluzione automatica delle contraddizioni resta fuori scope.
- I candidate non approvati non sono recuperabili e non modificano il Second Brain.

---
## ADR-011 — Runtime production: Fastify unico processo e static React
**Data:** 2026-11-13
**Stato:** accepted

### Contesto
Il runtime richiedeva backend Fastify e Vite dev server avviati manualmente. Per un servizio self-hosted permanente servono un solo processo in production, frontend già compilato, gestione SIGTERM e avvio systemd.

### Decisione
- `NODE_ENV=production` attiva `@fastify/static` (Fastify 5) con root sulla build React e `wildcard: false`.
- La build Vite attuale resta in `apps/dist/web` (`outDir: ../dist/web`) ed è sovrascrivibile con `MEMORA_WEB_DIST_DIR`.
- SPA fallback: `setNotFoundHandler` restituisce `index.html` solo per GET/HEAD non-API senza estensione. `/api/*` sconosciute restano JSON 404 e gli asset mancanti restano 404.
- In development Fastify non registra static e Vite continua a usare il proxy `/api` su :3000.
- `pnpm start` esegue il server compilato con `NODE_ENV=production`, senza Vite e senza `tsx`.
- Shutdown: SIGTERM/SIGINT chiudono prima Fastify e poi AgentService/MemoryService, con guardia contro doppio shutdown.
- Unit systemd di esempio in `deploy/memora.service`, con `EnvironmentFile` assoluto perché systemd non espande `~`, `User=memora`, `WorkingDirectory=/opt/memora`, `Restart=on-failure` e journald.
- Bind predefinito `127.0.0.1`; accesso remoto tramite SSH tunnel anche su Tailscale. Nessun Tailscale Serve.

### Conseguenze
- Production richiede solo `pnpm build && pnpm start`.
- `pnpm smoke:prod` avvia solo il server compilato e verifica frontend, API, SPA fallback, 404 e graceful shutdown.
- La unit contiene path di deployment, non percorsi hardcoded nel codice applicativo.
- La build frontend deve esistere prima dell'avvio production: in sua assenza il server fallisce con un errore esplicito.

---
## ADR-012 — Gestione delle memorie approvate direttamente sul Markdown
**Data:** 2026-11-13
**Stato:** accepted

### Contesto
Dopo l'approvazione, l'utente poteva creare e recuperare memorie ma non gestirle dalla Web UI. Serviva chiudere il ciclo crea → recupera → modifica → elimina senza introdurre un database separato delle memorie approvate.

### Decisione
- Markdown resta la fonte autorevole; SQLite/FTS5 resta un indice ricostruibile.
- La lista fonti espone path relativo, categoria, modifiedAt, chunkCount e titolo principale; il dettaglio restituisce il contenuto completo tramite source ID.
- Il client invia solo `source id`. Il backend risolve il path dall'indice e non accetta mai path arbitrari.
- Edit e delete verificano: path sotto `MEMORA_DATA_DIR`, root ammessa (`memory`, `projects`, `journal`, `documents`), estensione `.md`, assenza di symlink/path traversal e parent realpath dentro la data directory.
- Edit scrive atomicamente il file completo con temp + rename, preserva un modo sicuro e reindicizza. Delete elimina solo il file target, senza rimuovere directory parent, e reindicizza.
- Dopo ogni operazione il source viene restituito aggiornato o rimosso; `search()` vede subito il nuovo contenuto o l'assenza.
- La UI mostra le fonti, apre il dettaglio, permette modifica Markdown in textarea e delete con conferma esplicita. I risultati di ricerca aprono la fonte con heading/line range evidenziati.
- Nei file core `memory/profile.md`, `memory/preferences.md`, `memory/decisions.md` la UI nasconde il delete completo perché possono contenere più memorie; la modifica del file completo resta disponibile.
- Rename/move non è implementato nel MVP: edit e delete sono prioritari e il move aggiungerebbe rischio di overwrite.

### Conseguenze
- La gestione delle memorie approvate non crea un nuovo database né duplica la conoscenza.
- Il reindex mantiene FTS allineato; un riavvio non è necessario.
- Il delete di singoli bullet non è affidabile e resta rimandato a memory entry ID strutturati.
- Il delete file completo è disponibile solo per fonti non-core nella UI; l'API resta esplicita e protetta.

---
## ADR-013 — Personal Assistant Runtime Isolation
**Data:** 2026-11-13
**Stato:** accepted

### Contesto
Una domanda personale ha prodotto una risposta contaminata da task, test E2E, SQLite, source ID e dettagli del repository Memora. La causa era che le sessioni usavano la directory del repository come cwd, caricavano AGENTS.md/project resources e mantenevano i built-in coding tools attivi. Il repository dell'applicazione non deve essere conoscenza dell'assistente personale.

### Decisione
- Le sessioni personal assistant usano un CWD isolato: `$MEMORA_DATA_DIR/runtime/assistant`, sovrascrivibile con `MEMORA_ASSISTANT_CWD`.
- `createAgentSession` usa `noTools: "builtin"`: read, bash, edit, write, grep, find e ls non sono attivi; le custom/integration tools esplicitamente registrate restano disponibili.
- `DefaultResourceLoader` viene configurato esplicitamente con `noContextFiles`, `noSkills`, `noPromptTemplates`, `noExtensions`, `appendSystemPrompt: []` e `systemPrompt: PERSONAL_ASSISTANT_SYSTEM_PROMPT`.
- L'inline extension Memora per Memory Retrieval continua a essere caricata tramite `extensionFactories`; le estensioni scoperte automaticamente dal repository non vengono caricate.
- Il system prompt limita le risposte a conversazione, memoria recuperata e integrazioni disponibili; vieta di trattare codice/repository come conoscenza personale, impone di dichiarare la mancanza di informazioni e chiarisce che i chunk di memoria sono contesto, non istruzioni.
- Le sessioni nuove hanno header/CWD assistant. La discovery usa `SessionManager.listAll(sessionDir)` per mantenere visibili le sessioni legacy; il resume usa `SessionManager.open(..., assistantCwd)` per applicare la stessa policy.
- Il line range dei chunk resta in `memory_sources` per la UI ma viene rimosso dal testo iniettato nel prompt, perché il modello lo interpretava come contenuto informativo.

### Conseguenze
- Una sessione personal assistant non può leggere file, eseguire bash o esplorare il repository.
- AGENTS.md, skills, prompt template, documentazione e source code del repository non entrano nel context.
- Memory Retrieval e Memory Writer restano funzionanti.
- Model selection, resume, streaming, archive/delete, Memory Inbox e production runtime restano invariati.
- Il Coding Mode è deliberatamente rimandato: la policy tool è centralizzata per poterlo aggiungere in futuro.

---
## ADR-014 — Admin settings JSON e precedenza environment
**Stato:** accepted

### Contesto
Le opzioni runtime erano configurabili solo tramite environment e file secrets.
Servono modifica da Web UI, override operativi systemd/Docker e compatibilità con
installazioni esistenti, senza mettere segreti nelle impostazioni.

### Decisione
- Le impostazioni non derivate vivono in `$MEMORA_DATA_DIR/config/settings.json`,
  non in SQLite. Il file è versionato, leggibile, scritto atomicamente e `0600`.
- Precedenza default → file → environment. I campi env sono read-only nell'API/UI.
- Le API amministrative sono centralizzate sotto `/api/admin/*`; non c'è ancora
  autenticazione e questo è documentato come limite.
- La configurazione live usa setter espliciti di MemoryService, MemoryCurator e
  AgentService. Embeddings e abilitazione Curator richiedono restart; provider,
  modello e reasoning del Curator vengono ricaricati a caldo, mentre il provider
  Chat predefinito si applica live alle nuove sessioni.
- `chat.defaultModel` cambia solo il default delle nuove sessioni.
- PATCH usa una whitelist, validazione di enum/range e rifiuto ricorsivo delle
  chiavi che sembrano segreti.
- Lite/Standard sono preset UI con preview; non vengono applicati silenziosamente.

### Conseguenze
- Il runtime può essere amministrato senza modificare secrets.env.
- Le installazioni con sole variabili d'ambiente continuano a funzionare e non
  viene creato settings.json fino al primo salvataggio.
- Un file corrotto non blocca l'avvio; viene ignorato con warning.
- Un cambio di embeddings o abilitazione Curator richiede un riavvio esplicito;
  provider/modello/ragionamento Curator e provider Chat sono live. Il processo web
  non riceve privilegi sudo.

---
## ADR-015 — Provider multipli, secret store e cataloghi modello
**Stato:** accepted

### Contesto
La configurazione chat era legata a OpenRouter e le API key vivevano solo
nell'environment. Serve selezione provider/modello dalla Web UI, con OpenCode Go
già supportato dal Pi SDK installato, senza esporre credenziali.

### Decisione
- `openrouter` e `opencode-go` sono i provider supportati. Pi fornisce entrambi;
  gli ID OpenCode Go sono bare (`deepseek-v4.1-flash`).
- Le API key sono in `$MEMORA_DATA_DIR/config/secrets.json`, mode `0600`,
  scrittura atomica; l'environment ha precedenza e rende il campo read-only.
  GET espone solo `{configured, source, editable}`.
- Il catalogo OpenRouter usa il catalogo Pi (375+ modelli con metadata). OpenCode
  Go usa l'endpoint remoto ufficiale filtrato sui modelli che il Pi installato
  può eseguire, con cache 10 minuti, refresh esplicito e fallback cache/Pi.
- La UI Chat e Curator hanno provider e modello indipendenti. Il Curator
  riutilizza la stessa credenziale del provider e accetta solo modelli
  OpenAI-compatible su OpenCode Go.
- Il default Chat si applica alle nuove sessioni; quelle esistenti conservano il
  modello persistito. Il Curator provider/model viene ricaricato a caldo.
- Il test connessione usa endpoint catalogo/key, non inferenza, e restituisce
  errori sanitizzati.

### Conseguenze
- Le API key non vengono mai restituite né scritte nei settings.
- La ricerca modelli è case-insensitive su nome, ID e provider; OpenRouter espone
  il filtro Free basato sui metadata.
- Se il catalogo remoto fallisce, Memora continua con cache/Pi e warning.
- Non c'è ancora autenticazione admin: il limite resta documentato.
- La verifica di inferenza OpenCode Go richiede una chiave fornita dall'utente e
  non può essere eseguita nei test automatici.

---
## ADR-016 — Guardrail della memoria e redazione PII
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
La memoria recuperata entra nel prompt della chat e un estratto viene inviato al
Curator remoto. I documenti Markdown possono contenere testo ostile o dati
personali; l'output del Curator non è fidato. Servono difese verificabili senza
cambiare il formato Markdown-first.

### Decisione
- La memoria viene inserita in un blocco JSON delimitato da
  `<memora-memory-json>`; `<`, `>` e `&` sono escapati e i marcatori di confine
  e i caratteri di controllo vengono neutralizzati. Il prompt base resta il
  prefisso e dichiara che la memoria è dato, non istruzione.
- Prima del Curator cloud i segreti bloccano l'analisi; email, telefoni, IBAN,
  carte valide secondo Luhn e codici fiscali italiani vengono redatti. I chunk
  di memoria con PII ad alta confidenza non vengono inviati.
- L'output del Curator viene rifiutato se contiene segreti, PII o segnaposto di
  redazione. Restano validazione del path, approvazione umana e log di soli
  metadata.
- La UI Impostazioni mostra quali provider Chat/Curator ricevono dati, che gli
  embeddings sono locali e quali categorie vengono redatte.
- La redazione è euristica: nomi, indirizzi e altre PII non riconoscibili
  possono ancora raggiungere il provider. Il rischio residuo è documentato in
  `docs/MEMORY-SECURITY.md`.
- L'autenticazione admin resta un prerequisito del task `09-hardening.md` per
  qualsiasi esposizione di rete.

### Conseguenze
- Aumenta la dimensione del prompt per via del JSON, ma il confine è
  strutturalmente più difficile da chiudere.
- Un turno con PII può perdere il contesto delle memorie che le contengono; è
  preferibile a un invio non necessario.
- I test di prompt injection e redazione diventano parte della suite.
- La protezione non è una garanzia contro prompt injection semantico né contro
  tutte le PII; il modello di minaccia e i rischi residui restano espliciti.

---
## ADR-017 — Evaluation harness e baseline della memoria
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Il benchmark esistente misurava solo poche query sintetiche e non copriva
Curator, regressioni, ambiguità o modalità live. Serve una valutazione
riproducibile che non introduca dati personali e che possa girare in CI senza
rete.

### Decisione
- I dataset sono JSON sintetici in `evaluation/`: 46 query di retrieval e 15 casi
  Curator. Nessun dato reale, personale o runtime entra nel repository.
- Le metriche di retrieval sono Recall@k, Precision@k, MRR, nDCG@k, latenza e
  token stimati (`caratteri / 4`). Le modalità sono separate.
- Il Curator replay usa output provider congelati e misura la pipeline di
  validazione, le soglie e le classi. La modalità live è esplicita, usa la
  credenziale locale e non può scrivere la baseline.
- `evaluation/baseline.json` è versionata. Il check usa una tolleranza assoluta
  di `0.02`; la latenza è misurata ma non è un gate.
- La CI esegue lexical e Curator replay senza modello o rete. Semantic/hybrid
  richiedono `MEMORA_DATA_DIR` con il modello locale.
- Il dataset è volutamente piccolo e sintetico; i risultati non sostituiscono
  una valutazione su conversazioni reali anonimizzate.

### Conseguenze
- Ogni modifica a retrieval o Curator può essere confrontata con una baseline
  stabile.
- I cambi intenzionali di qualità richiedono l'aggiornamento esplicito della
  baseline.
- La misura live del reasoning è indicativa e non riproducibile; non viene usata
  come gate.
- La precision@10 va letta insieme a Recall e nDCG, perché molte query hanno una
  sola evidenza gold.

---
## ADR-018 — Metadata per bullet e lineage delle memorie
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Il Markdown era la fonte autorevole, ma non conservava identità, provenienza,
confidenza o storico degli aggiornamenti. SQLite non poteva essere l'unica copia
di questi dati senza violare il principio di indice ricostruibile.

### Decisione
- I metadata vivono in un commento HTML sulla riga del bullet
  (`<!-- memora-memory:v1 ... -->`), invisibile nel Markdown renderizzato.
- `memoryId` identifica la lineage stabile; `versionId` identifica la singola
  versione; `version`, `status`, `supersedes` e `supersededBy` descrivono la
  catena.
- Provenienza: sessione, messaggio, turno, timestamp, confidenza, scope,
  progetto, entità, tag, provider e modello Curator.
- Un aggiornamento conserva il bullet precedente come `superseded` e aggiunge un
  bullet `active`. Il reindex rimuove i commenti, svuota le righe superseded e
  indicizza solo le versioni attive.
- SQLite aggiunge `memory_records` e `metadata` sui chunk. Entrambi sono derivati
  e ricostruibili dai file.
- La migrazione dei bullet legacy è esplicita e non distruttiva: dry-run
  predefinito, `--apply` aggiunge solo commenti, `--backup` opzionale.
- Metadata invalidi o riferimenti rotti producono warning con file, riga e
  codice; non vengono mai loggati contenuti.

### Conseguenze
- Le memorie sono più verbose nel sorgente, ma restano leggibili e modificabili.
- Il retrieval non restituisce versioni storiche.
- Il database può essere eliminato e ricostruito senza perdere la provenienza,
  purché i commenti Markdown siano conservati.
- La migrazione automatica non modifica i dati dell'utente all'avvio.
- I commenti non sono firmati: la provenienza è affidabile quanto il filesystem.

---
## ADR-019 — Memoria storica, retention e integrità
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Le versioni `superseded` erano conservate ma non consultabili. L'utente poteva
chiedere “che cosa usava prima?” e ricevere “non è in memoria”, anche se la
versione storica esisteva nel Markdown. Mancavano inoltre policy esplicite per
retention, cancellazione propagata e verifica dell'indice.

### Decisione
- Le versioni superate restano fuori dal retrieval normale.
- Per query con indicatori temporali espliciti, l'estensione cerca solo versioni
  `superseded` nei path delle fonti attive pertinenti e aggiunge un blocco
  `Memoria storica` separato e marcato come non corrente.
- La ricerca storica è lessicale e conservativa; non viene usata per domande sul
  presente.
- La vista di una fonte espone lo storico completo con stato, versione, data,
  provenienza e testo.
- La retention è manuale: `memory:history:prune` è dry-run di default, richiede
  `--apply`, supporta backup e non rimuove mai versioni attive.
- La cancellazione di una fonte propaga a indice, vettori e candidate; i
  candidati pendenti diventano `rejected` con `source_deleted`, quelli approvati
  ricevono `purgedAt`.
- `memory:integrity` esegue controlli read-only su SQLite, foreign key e metadata
  Markdown senza loggare contenuti.
- I riassunti gerarchici sono valutati e rimandati: con il corpus attuale
  aggiungono complessità e rischio di perdita di dettaglio.

### Conseguenze
- La chat può rispondere a domande storiche senza trattare il passato come
  verità corrente.
- La retention è prevedibile e non cancella automaticamente dati dell'utente.
- Backup e restore hanno una procedura verificabile.
- La ricerca storica è euristica e non copre query temporali implicite.

---
## ADR-020 — Retrieval runtime con budget, filtri e diversità
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Il retrieval restituiva i risultati grezzi di FTS/vector/RRF. Mancavano un
budget token, filtri espliciti, protezione dalla ridondanza e uso dei metadata
per il ranking. Il benchmark misurava le modalità grezze, non la pipeline reale.

### Decisione
- `MemoryService.search()` applica overfetch, filtri per progetto/tipo/confidenza,
  reranking con confidenza/importanza/recency, diversità Jaccard e budget
  `maxChars` + `maxTokens`.
- `MEMORA_MEMORY_MAX_TOKENS` (default 1000) usa una stima `caratteri/4`;
  `MEMORA_MEMORY_DIVERSITY` (default 0.15) controlla la penalità MMR. Entrambi
  sono modificabili da **Impostazioni → Memoria** e si applicano live.
- Le modalità dirette restano disponibili per benchmark e diagnostica. La
  baseline non cambia; la pipeline runtime ha test dedicati.
- Non viene caricato un cross-encoder locale: RAM, latenza e mancanza di un
  modello italiano verificato rendono il costo non giustificato.
- Query rewriting e multi-query sono valutati e rimandati; l'ibrido fonde già
  lexical e semantico.
- `memory_sources` espone source ID e metadata delle versioni usate; i log non
  contengono contenuti.

### Conseguenze
- Il contesto è più prevedibile e meno ridondante.
- La pipeline runtime può divergere dalla baseline grezza; serve un futuro
  benchmark dedicato per misurarla end-to-end.
- I pesi e la diversità sono deterministici e richiedono taratura su query reali.
- I bullet legacy senza metadata restano inclusi e ricevono boost neutri.

---
## ADR-021 — Coda Curator durevole e idempotenza
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
La coda del Curator era volatile: crash o chiusura forzata potevano perdere
proposte. Un retry dopo una scrittura già avvenuta poteva duplicare candidate.
Il consolidamento dell'intera memoria era assente.

### Decisione
- I job vengono persistiti in `$MEMORA_DATA_DIR/memory-inbox/writer-queue.jsonl`
  con permessi `0600`, retry, backoff e limite di 100 pending.
- Ogni job ha un `idempotencyKey` da `turnId`, `sourceMessageId` o hash del testo.
- I job `running` vengono rimessi in coda dopo un riavvio.
- Il writer ignora un turno se esiste già un candidate con lo stesso
  `turnId`/`sourceMessageId`.
- In shutdown durevole si attende il job corrente e si lasciano i pending su
  disco; la coda volatile dei test mantiene il drain completo.
- `memory:consolidate` è un audit deterministico read-only delle memorie attive
  simili; il consolidamento LLM automatico è rimandato.
- `memory:integrity` aggiunge le metriche dell'Inbox e il pannello admin mostra
  coda, job falliti e tentativi.

### Conseguenze
- Un crash non perde silenziosamente i job.
- Un retry non duplica proposte già persistite.
- La coda persistita contiene dati del turno e va inclusa nella retention e nei
  backup cifrati.
- Il consolidamento automatico con LLM, il feedback loop e il batching restano
  lavoro futuro.

---
## ADR-022 — Metriche aggregate e runbook operativo
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Lo stato admin mostrava fonti, chunk, vettori e lunghezza coda, ma non latenza,
errori, token recuperati, età della coda o tasso di approvazione. Mancava un
runbook per backup, restore, migrazione e degrado.

### Decisione
- `RuntimeMetrics` aggrega in memoria retrieval e Curator senza query, prompt o
  contenuto. Le metriche sono esposte in `/api/admin/status` e nella pagina
  **Sistema → Osservabilità**.
- La coda espone job falliti, tentativi, età del job più vecchio e ultimo esito.
- La Memory Inbox espone pending/conflict/approved/rejected e approval rate.
- Alert: coda bloccata, job falliti, backlog, errori Curator/retrieval.
- `docs/OPERATIONS.md` contiene backup, restore, reindex, migrazione e
  comportamento con embeddings assenti, SQLite corrotto, metadata invalidi e
  disco pieno.
- Il degrado embeddings→lexical e i metadata invalidi sono coperti da test;
  disco pieno e SQLite corrotto sono procedure operative documentate.

### Conseguenze
- Un operatore può capire lo stato senza leggere contenuti personali.
- Le metriche sono per processo: un riavvio azzera i contatori, non i dati.
- La coda persistita contiene input personali e va inclusa in backup/retention.

---
## ADR-023 — Consolidamento LLM read-only e feedback advisory
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Il consolidamento deterministico trovava solo similarità lessicali. Serviva un
controllo semantico di duplicati e contraddizioni oltre il set per-turno, senza
introdurre merge automatici rischiosi o tuning non controllato delle soglie.

### Decisione
- `MemoryConsolidator` usa una completion JSON con schema versionato
  (`schemaVersion: 1`) e accetta solo ID presenti nel batch.
- `memory:consolidate:llm` è esplicito, read-only, con limiti di record e batch;
  produce un report, non candidate o Markdown.
- Il Curator per-turno accetta `schemaVersion` assente o `1` e rifiuta versioni
  future.
- `memory:feedback` calcola tasso di approvazione e punteggi medi e fornisce un
  suggerimento sulle soglie; non modifica la configurazione.
- Nessun merge automatico e nessun tuning automatico.

### Conseguenze
- Il consolidamento semantico è disponibile senza rischio di scritture errate.
- Il report è locale e va trattato come dato personale se contiene memorie.
- Il feedback richiede un numero minimo di revisioni per essere utile.
- Costi e latenza restano controllati da batch e timeout.

---
## ADR-024 — Progetti di prima classe
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
I progetti esistevano solo come directory Markdown e campo `project`. Mancavano
configurazione, fonti dichiarate, prompt, associazione sessioni e isolamento del
retrieval.

### Decisione
- `projects/<slug>/project.json` è la configurazione; `memory.md` resta memoria e
  `sources/**/*.md` e `sources/**/*.txt` sono fonti.
- Lo slug è immutabile; il nome è modificabile.
- Il prompt di progetto è uno strato subordinato alla policy Memora e precede la
  memoria recuperata.
- Le sessioni usano la custom entry `memora.project`; le sessioni legacy restano
  globali.
- Il retrieval usa `searchScoped()` con RRF tra memoria globale e progetto.
- Il Curator instrada i fatti di progetto nel progetto corrente.
- Le fonti hanno CRUD, include/exclude e reindex; la cancellazione propaga a
  indice, vettori e candidate.
- L'UI offre selettore progetto, pagina progetto, prompt, fonti, sessioni
  filtrate e Second Brain filtrato.
- Archive è reversibile; purge richiede `confirm` e sposta la directory in
  `.trash/projects`; export è JSON.

### Conseguenze
- Un progetto non vede fonti o memoria di un altro progetto.
- I progetti legacy restano compatibili.
- La migrazione a `project.json` è esplicita.
- Il purge non è un pulsante UI distruttivo.

---
## ADR-025 — Preferenze aspetto locali e sidebar comprimibile
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
La UI usava un solo tema chiaro con colori in parte hardcoded, non offriva
controlli di leggibilità e la sidebar occupava sempre spazio prezioso anche su
schermi piccoli.

### Decisione
- Le preferenze di aspetto sono locali al browser (`localStorage`), non fanno
  parte di `settings.json` e non vengono inviate al server.
- Tema `system`/`light`/`dark`, dimensione testo, densità, larghezza chat,
  movimento ridotto e stato della sidebar sono applicati tramite attributi su
  `<html>` e variabili CSS.
- Un bootstrap inline in `index.html` applica il tema prima del primo render per
  evitare il flash chiaro/scuro.
- La sidebar desktop è comprimibile con il pulsante in topbar, `Ctrl+B` o
  l’opzione nelle impostazioni; su mobile resta un drawer.
- Il composer riceve il focus quando cambia la sessione attiva, quindi una nuova
  chat è subito pronta per la scrittura.

### Conseguenze
- Le preferenze non seguono l’utente su altri browser/dispositivi.
- I colori semantici passano da variabili CSS, così il tema scuro non dipende da
  override fragili.
- La UI deve mantenere accessibili i controlli anche quando la sidebar è
  compressa.

---
## ADR-026 — Allegati chat e file progetto con anteprima locale
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
La chat accettava solo testo. I progetti avevano fonti Markdown/TXT indicizzate,
ma non un modo per esplorare la cartella o consultare PDF, HTML e documenti Word.
Serviva anche passare allegati al modello senza inserirli nel messaggio utente.

### Decisione
- Il pannello **File progetto** elenca solo `projects/<id>/`, con protezione da
  symlink e traversal; supporta ricerca e anteprime per Markdown, testo, PDF,
  HTML, `.docx` e immagini.
- HTML è sempre in iframe sandboxed; `.docx` usa Mammoth; PDF usa il viewer
  nativo; nessun file viene eseguito.
- Gli allegati chat sono copiati in `chat-attachments/<sessionId>/` con permessi
  `0600`; il client invia il contenuto in JSON base64.
- Testo, PDF e Word vengono estratti localmente e iniettati nel system prompt
  transitorio come dati non fidati; le immagini usano il blocco immagini Pi.
- Il testo utente e il JSONL Pi restano invariati; i metadati degli allegati
  sono una custom entry `memora.attachments`.
- Il delete sessione rimuove anche la directory degli allegati; il delete esplicito
  di un allegato rimuove il file.

### Conseguenze
- PDF e Word richiedono `pdf-parse` e `mammoth` nel server.
- Gli allegati sono dati personali: backup e retention devono includere
  `chat-attachments/`.
- Gli upload non inviati possono restare orfani finché non viene aggiunta una
  retention automatica.
- I modelli senza supporto immagini possono rifiutare gli allegati immagine.

---
## ADR-027 — Contesto per chat, archivio file progetto e artefatti
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
I file caricati in chat erano solo allegati temporanei; il pannello progetto era
a sinistra; non era possibile scegliere per chat quali fonti usare; gli output
strutturati non avevano un contenitore dedicato.

### Decisione
- Gli allegati di una chat di progetto vengono archiviati anche in
  `projects/<id>/files/`; `files/` è esclusa dal retrieval e dalla memoria.
- Il contesto di retrieval è per sessione (`memora.context`) con tre toggle:
  memoria globale, memoria progetto, fonti progetto. I default del progetto
  restano un limite superiore.
- Il pannello contestuale è a destra, con schede File/Contesto/Artefatti.
- Gli artefatti sono file testuali in `artifacts/<sessionId>/`, creati dal tool
  `create_artifact`; HTML/SVG sono sandboxed. Non c’è esecuzione Python.
- Gli allegati e gli artefatti vengono rimossi con la sessione.

### Conseguenze
- La cartella `files/` è consultabile ma non è conoscenza del modello finché non
  viene promossa esplicitamente a fonte.
- I toggle di contesto non riscrivono il progetto e sono reversibili.
- Gli artefatti non sono un ambiente di esecuzione: per calcoli/grafici servirà
  un sandbox separato.

---
## ADR-028 — PDF token-efficient
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Un tool PDF che riceve il documento completo duplicherebbe il contenuto nel
tool call e nei turni successivi, aumentando i token di input. Serviva inoltre
una generazione PDF leggera sulla N95.

### Decisione
- Il rendering PDF usa `pdfkit` lato server, senza browser headless o Python.
- `create_pdf` riceve solo `title` e `filename`; il contenuto viene preso dalla
  risposta finale dell’assistente dopo il turno.
- Il pulsante **PDF** esporta il testo già presente nella risposta: zero token
  LLM aggiuntivi.
- Gli artefatti PDF sono binari in `artifacts/<sessionId>/` e non vengono mai
  reinseriti nel contesto.
- Limiti: 30.000 caratteri Markdown, 30 pagine, 5 MB.
- HTML/SVG restano sandboxed; i PDF usano il viewer del browser.

### Conseguenze
- La generazione PDF non consuma token; consuma CPU solo al momento della
  richiesta.
- Il modello deve scrivere il documento nella risposta finale quando usa
  `create_pdf`.
- Template e skill PDF potranno essere aggiunti senza cambiare il confine di
  sicurezza.

---
## ADR-029 — HTML verso PDF senza browser headless
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
PDFKit produce documenti leggibili ma poco impaginati; i modelli sanno generare
HTML con CSS molto più curato. Chromium headless non è disponibile in modo
affidabile sulla macchina di destinazione e aggiungerebbe browser, RAM e
superficie di sicurezza.

### Decisione
- Il formato HTML viene convertito con `html-to-pdfmake` + `pdfmake` dopo aver
  inlineato i CSS base con `inline-css`.
- Script, iframe, object, embed, link esterni, handler inline e `@import` vengono
  rimossi. Le risorse remote sono bloccate.
- Il renderer supporta un sottoinsieme CSS: colori, font, bordi, tabelle,
  dimensioni. Flex/grid e layout complessi non sono garantiti.
- Il tool `create_pdf` supporta `format: "html"` con contenuto preso dalla
  risposta finale, senza duplicarlo nel tool call.
- Gli artefatti HTML/Markdown hanno **Esporta PDF**.
- L’anteprima PDF usa PDF.js, non il plugin del browser.

### Conseguenze
- I PDF HTML sono più curati dei PDF Markdown ma non sono una resa browser
  pixel-perfect.
- Non aumentano il consumo di token né richiedono Chromium.
- Per template complessi sarà possibile aggiungere in futuro un renderer
  browser opzionale.

---
## ADR-030 — Chromium opzionale per PDF HTML fedeli
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
PDFMake/HTML-to-PDFMake non supportano layout CSS complessi. I PDF risultavano
semplici rispetto all’HTML prodotto dai modelli.

### Decisione
- Il rendering HTML prova prima Chromium headless (`@sparticuz/chromium` +
  `puppeteer-core`), con JavaScript disabilitato, richieste di rete bloccate e
  una sola generazione alla volta.
- Se Chromium non è disponibile, usa il fallback `html-to-pdfmake`/`pdfmake`.
- Le librerie Debian mancanti (`libnspr4`, `libnss3`) vengono installate in
  `$MEMORA_DATA_DIR/browser-libs/` tramite `pnpm pdf:browser:setup`, senza root.
- Il tool `create_pdf` resta metadata-only; il contenuto HTML viene preso dalla
  risposta finale.

### Conseguenze
- I PDF HTML possono usare layout, font, sfondi e CSS complessi.
- Il primo PDF avvia Chromium e richiede più RAM; il processo viene chiuso dopo
  ogni conversione.
- Il fallback garantisce continuità ma produce PDF più semplici.

---
## ADR-031 — Versioni artefatti e controlli conversazione
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Rigenerare un artefatto con lo stesso nome creava file duplicati. Inoltre la
chat non permetteva di copiare, correggere una domanda o riformulare una
risposta, e il composer perdeva il focus dopo il turno.

### Decisione
- `ArtifactStore` mantiene un solo artefatto corrente per nome/sessione; le
  versioni precedenti vengono archiviate in `.versions/<artifactId>/`.
- `ChatArtifact` espone `version` e `updatedAt`; `ArtifactStore` espone
  `listVersions`/`getVersion` e la UI permette di selezionare la versione.
- La modifica di una domanda usa `navigateTree` di Pi: il nuovo ramo sostituisce
  la vecchia domanda nel contesto attivo, senza cancellare il JSONL storico.
- Le risposte hanno copia Markdown, PDF e Riformula; le domande hanno copia
  testuale e modifica con editor ampio auto-ridimensionato.
- Il composer riceve un focus token dopo ogni turno completato o annullato.

### Conseguenze
- Un artefatto revisionato resta lo stesso file logico con versione crescente.
- La modifica di una domanda non riscrive lo storico Pi: crea un ramo.
- Riformula è un nuovo turno esplicito, non una rigenerazione silenziosa.

---
## ADR-032 — Second Brain dedicato e memoria dalle risposte
**Data:** 2026-11-15
**Stato:** accepted

### Contesto
Il vecchio pannello “Second Brain” era un drawer sotto la chat che mescolava
ricerca della conoscenza, Memory Inbox e dettaglio fonti. Non era chiaro dove
fossero le memorie di tutte le chat/progetti e mancava un modo esplicito per
salvare una risposta dell’assistente.

### Decisione
- La sidebar ha due icone: Second Brain e Impostazioni.
- La pagina Second Brain elenca tutte le fonti indicizzate, con filtro
  globale/progetto, ricerca e modifica Markdown.
- Il pannello inferiore viene rinominato **Memoria della chat** e contiene la
  Memory Inbox e i collegamenti alle memorie globali/di progetto.
- Una risposta può essere promossa con il pulsante **Memoria**; il candidato ha
  `sourceKind: assistant`, origine esplicita e richiede approvazione.
- L’estrazione automatica continua a considerare solo le affermazioni
  dell’utente. Le risposte dell’assistente non diventano mai memoria implicita.

### Conseguenze
- La conoscenza indicizzata ha una destinazione unica e riconoscibile.
- Il salvataggio di una risposta è intenzionale, tracciato e reversibile.
- La memoria non si autoalimenta con output del modello.

---
## ADR-033 — Artefatti Office leggeri e PPTX HTML-first
**Data:** 2026-11-16
**Stato:** accepted

### Contesto
Memora produce PDF, Markdown e HTML, ma non DOCX, XLSX o PPTX. Un renderer
Office universale richiederebbe LibreOffice, molto pesante per il target N95 e
per un'installazione open source riproducibile. La generazione deve inoltre
restare economica in token.

### Decisione
- DOCX, XLSX e PPTX sono nuovi `ArtifactKind` binari, con storage in
  `artifacts/<sessionId>/`, versioni e limiti dedicati.
- I tool `create_docx`, `create_xlsx` e `create_pptx` ricevono solo titolo e nome
  file; il contenuto viene preso dalla risposta finale, come per `create_pdf`.
- DOCX: Markdown → `docx`; preview Mammoth in iframe sandboxed.
- XLSX: tabelle Markdown → `exceljs`; preview JSON limitata renderizzata in
  React, senza valutare formule.
- PPTX: deck HTML con `<section class="slide">` → `jsdom` + `pptxgenjs`; lo
  stesso HTML sanificato viene salvato in `.previews/<artifactId>.html` e usato
  come anteprima.
- I PPTX caricati dall'utente restano senza anteprima nella prima versione.
- HTML delle anteprime: sandbox, CSP, nessuno script, nessuna rete esterna.
- LibreOffice non è una dipendenza.

### Conseguenze
- L'installazione resta leggera e senza servizi esterni.
- La preview PPTX è fedele all'HTML, mentre il `.pptx` supporta un sottoinsieme
  di titoli, testi, liste, tabelle e immagini `data:`.
- Le formule Excel e i layout Office complessi non sono perfettamente
  riprodotti, ma il file resta apribile e modificabile con strumenti esterni.
- Un converter Office universale potrà essere aggiunto solo come opzione
  esplicita in futuro.

---
## ADR-034 — Login Web single-user
**Data:** 2026-11-16
**Stato:** accepted

### Contesto
Memora contiene sessioni, memoria personale, segreti provider e API
amministrative. Il default è localhost, ma l’accesso da LAN e Tailscale rende
necessario un confine di autenticazione prima dell’uso reale.

### Decisione
- Login single-user, password-only, senza username né registrazione.
- Prima password: il primo setup valido crea `config/auth.json`; le API
  applicative sono bloccate finché il setup non è completato.
- Hash `scrypt` con salt e parametri espliciti, file `0600`.
- Cookie `memora_session` `HttpOnly`, `SameSite=Lax`, durata 24 ore.
- Logout e reset password invalidano tutte le sessioni tramite
  `sessionVersion`.
- Tutte le `/api/*` sono protette, eccetto health, login, setup e stato auth.
- Controllo `Origin` per le richieste di scrittura, rate limit sul login.
- Reset password solo da CLI (`pnpm memora:set-password`).
- Nessun token API nella v0.1.
- HTTP LAN ammesso per uso domestico; `Secure` attivabile con
  `MEMORA_COOKIE_SECURE=true` quando esiste HTTPS.

### Conseguenze
- La Web UI è utilizzabile su LAN/Tailscale senza esporre direttamente le API.
- La prima password deve essere impostata subito dopo l’installazione: chi
  raggiunge la pagina di setup per primo può sceglierla.
- Se `auth.json` viene perso, serve un reset da shell o un ripristino backup.
- Non è ancora multiutente, OAuth, 2FA o gestione permessi.

---
## ADR-035 — Pannello laterale unificato della chat
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
Le chat di progetto e quelle senza progetto usavano due pannelli diversi:
il primo con tab File/Contesto/Artefatti, il secondo con contesto, artefatti e
fonti web impilati. La scheda Fonti non era raggiungibile nelle chat di
progetto, il pannello si apriva automaticamente solo in alcuni casi e le fonti
web non si aggiornavano dopo una ricerca.

### Decisione
- Un solo `ChatSidePanel` con header e tab fissi: File, Contesto, Artefatti,
  Fonti.
- File esiste solo nelle chat di progetto; senza progetto restano Contesto,
  Artefatti e Fonti.
- Fonti indica le fonti web; le fonti indicizzate del progetto restano
  un’opzione del Contesto.
- Il pannello è collassato per default in ogni chat.
- Su desktop (> 900 px) si apre automaticamente su Fonti quando arriva una
  nuova fonte web e su Artefatti, con il dettaglio del nuovo artefatto, quando
  viene creato un artefatto. Su mobile non si apre automaticamente.
- Gli aggiornamenti immediati usano gli eventi `tool_execution_end` di Pi;
  un refresh completo a fine turno recupera gli artefatti generati dopo la
  risposta (PDF, DOCX, XLSX, PPTX).
- La selezione dell’artefatto è controllata dall’esterno per aprire il nuovo
  artefatto e viene consumata una sola volta.
- Ogni area ha contatore, refresh e stato vuoto; il refresh è disponibile
  anche manualmente.
- La tab attiva e lo stato aperto/chiuso non vengono persistiti tra sessioni
  diverse: una nuova chat parte sempre collassata.

### Conseguenze
- Il pannello è coerente tra chat con e senza progetto.
- L’auto-apertura è volutamente limitata al desktop per non coprire la chat
  su schermi piccoli.
- Le fonti web sono sempre raggiungibili, anche nei progetti.
- Il pannello richiede che il client interpreti i dettagli dei tool; se un
  evento non contiene dettagli, il refresh di fine turno resta la fallback.

---
## ADR-036 — Fonti web numerate e citazioni
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
Le fonti web erano mostrate senza un identificatore stabile e il modello poteva
citare URL o omettere la provenienza. Le citazioni dovevano restare coerenti tra
ricerche successive e dopo il limite delle 50 fonti.

### Decisione
- Ogni `WebSource` ha un `number` opzionale, assegnato alla prima acquisizione.
- Il numero viene persistito in `memora.web-sources` insieme a `nextNumber`;
  una fonte ritrovata mantiene il proprio numero e i numeri non vengono
  riutilizzati quando le fonti più vecchie escono dal limite.
- Le fonti legacy senza numero vengono normalizzate in lettura.
- `web_search` e `web_fetch` restituiscono al modello fonti con `number`;
  il system prompt impone di citare ogni informazione con `[n]` e di usare più
  riferimenti quando una frase combina fonti.
- La UI mostra `[n]` nella scheda Fonti e trasforma `[n]` in link cliccabili
  nella risposta, solo per URL HTTP/HTTPS.
- Le citazioni dentro il codice non vengono trasformate in link.

### Conseguenze
- Le citazioni restano coerenti tra turni e fonti.
- Il modello deve seguire il formato; se non lo fa, la risposta non viene
  modificata artificialmente con fonti inventate.
- Il limite di 50 fonti resta, ma i numeri non collassano.

---
## ADR-037 — Aggiornamento toolchain e dipendenze (novembre 2026)
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
La toolchain era ferma alle versioni risolte alla creazione del monorepo
(TypeScript 5.6, ESLint 9, Vitest 2, Vite 5, React 18, better-sqlite3 11,
pnpm 12.18). Si voleva riallineare tutto senza rompere la DoD
(`tsc --build`, `eslint`, `vitest run`, `pnpm build`) e senza toccare i pin
intenzionali.

### Decisione
Aggiornati (con verifica a ogni stadio):

| Pacchetto | Da | A |
|---|---|---|
| pnpm (`packageManager`) | 12.18.0 | 12.21.0 |
| ESLint / `@eslint/js` | 9.39.5 | 10.15.0 / 10.0.1 |
| typescript-eslint | 8.72.2 | 8.73.0 |
| Prettier | 3.9.10 | 3.10.1 |
| Vitest | 2.1.9 | 5.1.0 |
| Vite | 5.4.21 | 8.3.8 |
| `@vitejs/plugin-react` | 4.7.0 | 6.3.0 |
| React / React DOM (+ tipi) | 18.3.1 | 19.3.1 |
| pdfjs-dist | 5.4.296 | 6.5.438 |
| better-sqlite3 (+ tipi) | 11.10.0 | 13.2.0 / 9.6.0 |
| `@fastify/static` | 8.3.0 | 10.1.11 |
| Fastify | 5.0.0 | 5.12.8 |
| `@types/node` | 24.19.2 | 26.6.6 |
| TypeScript | 5.6.0 range | 5.6.3 (range invariata) |

Adattamenti al codice resi necessari dagli aggiornamenti:
- ESLint 10 abilita `no-useless-assignment` e `preserve-caught-error`: risolti
  i 7 rilievi nel codice (inizializzazioni ridondanti rimosse,
  `new Error(..., { cause })` sul curator error). Nessuna regola disabilitata.
- `@fastify/static` v10 passa la `FastifyReply` a `setHeaders`: sostituito
  `response.setHeader(...)` con `response.header(...)` (stessa semantica di
  cache-control sugli asset).
- pdfjs-dist v6 rimuove `PDFDocumentProxy.destroy()`: `PdfPreview` chiude il
  documento distruggendo il loading task (`task.destroy()`).
- `apps/web` dichiara `"type": "module"` (Vite 8 carica la config come ESM) e
  `vitest.config.ts` usa `import.meta.dirname` invece di `__dirname`.
- `pnpm-workspace.yaml`: `allowBuilds` allineato a `better-sqlite3@13.2.0`
  (senza questo il binding nativo non verrebbe costruito).

### Pin mantenuti volutamente
- `typebox` resta **1.3.27 esatto**: è la stessa identica versione dipendenza di
  `@earendil-works/pi-coding-agent@1.5.2`. Un bump disallineerebbe gli schemi
  dei tool rispetto al runtime Pi.
- TypeScript resta **5.6.x**: `typescript-eslint@8.73` dichiara supporto
  `typescript >=4.8.4 <6.1.0` e va in hard error con TS 7; con TS 7.0.2 anche
  `tsc --build` fallisce sulla risoluzione dei tipi `@types/pdfmake`. Il major
  verrà ripreso quando typescript-eslint supporterà TS 7.
- `pdfjs-dist`, `@huggingface/transformers`, `sqlite-vec`, `typebox` restano
  versioni esatte (riproducibilità degli artefatti e allineamento al runtime).

### Conseguenze
- `pnpm outdated -r` resta con solo i due pin intenzionali (`typebox`,
  TypeScript).
- Verifica riproducibile: `pnpm install && pnpm typecheck && pnpm lint &&
  pnpm test && pnpm build` (72 file di test, 373 test verdi), `pnpm peers check`
  senza problemi, `pnpm smoke:dist` verde.
- Il binding `better-sqlite3@13.2.0` funziona su Node 24 (SQLite 3.54.1).

---
## ADR-038 — Metadati e tooltip delle fonti web
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
Il tooltip nativo delle citazioni mostrava solo “Fonte n”, mentre l’utente
voleva riconoscere subito sito, titolo e contenuto senza aprire la fonte. Le
etichette `WEB` e `HTML` della scheda Fonti non spiegavano la differenza tra un
risultato di ricerca e una pagina letta.

### Decisione
- Le citazioni `[n]` contengono un tooltip HTML/CSS con dominio, titolo e uno
  snippet breve; il tooltip compare su hover e su focus da tastiera.
- I metadati provengono dalla `WebSource` e vengono passati al renderer Markdown;
  testo e attributi sono sempre escapati.
- Le etichette della scheda Fonti diventano:
  - **Ricerca**: risultato del motore, non ancora letto;
  - **Letta**: pagina recuperata e letta;
  - **PDF**: PDF letto.
- Una legenda nella scheda spiega le etichette.
- Per le pagine lette vengono salvati anche titolo reale e un estratto iniziale;
  per i PDF viene salvato un estratto del testo estratto.

### Conseguenze
- Il tooltip non dipende da JavaScript e resta disponibile anche con la UI
  statica.
- Il tooltip è informativo ma non sostituisce l’apertura della fonte.
- I vecchi riferimenti senza metadati restano testo `[n]`.

---
## ADR-039 — Sezioni personalizzabili e sidebar ad albero
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
La sidebar usava un selettore progetto e una lista piatta di sessioni. Il modello
mentale più familiare è invece: sezioni → progetti → sessioni. Servono inoltre
icone stabili per sezioni e progetti, senza caricare SVG arbitrari.

### Decisione
- Le sezioni sono entità persistenti in
  `$MEMORA_DATA_DIR/config/project-sections.json`, con `id`, `name`, `icon`,
  `order` e timestamp.
- `project.json` accetta `sectionId` e `icon` opzionali; un progetto senza
  sezione finisce in **Senza sezione**.
- Le icone sono un elenco chiuso e validato lato server; non vengono caricati
  SVG o file esterni.
- La sidebar mostra un albero con sezioni, progetti e sessioni. Sezioni e
  progetti hanno stato aperto/chiuso indipendente, persistito in `localStorage`.
- Selezionare una sezione la apre; selezionare un progetto lo apre e mostra le
  sue sessioni. Il progetto selezionato non filtra più l’intera lista.
- Le chat senza progetto sono raggruppate sotto **Chat senza progetto**.
- La creazione di un progetto può partire dalla sezione (`+`), e le impostazioni
  del progetto permettono di cambiare sezione e icona.
- L’eliminazione di una sezione è consentita solo se non contiene progetti.

### Conseguenze
- La sidebar è più familiare ma richiede un caricamento separato delle sezioni.
- I dati delle sezioni non sono contenuti nei `project.json`: vanno inclusi nei
  backup della data directory.
- Un progetto orfano da una sezione mancante resta visibile in **Senza sezione**.
- Lo stato di apertura è locale al browser; non viene sincronizzato tra device.

---
## ADR-040 — Azioni contestuali e chat in evidenza
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
I pulsanti inline di rinomina, archiviazione ed eliminazione occupavano spazio
nelle righe della sidebar e rendevano i nomi troppo corti. Serviva un modello
più leggibile e un modo per tenere in evidenza le chat importanti.

### Decisione
- Le azioni delle righe sono in un menu verticale `⋮`, visibile solo su hover o
  focus; il trigger non occupa larghezza nel layout del nome.
- Sessioni: rinomina, archivia/ripristina, elimina e metti/rimuovi evidenza.
- Sezioni: nuovo progetto, modifica, elimina.
- Progetti: nuova chat, impostazioni progetto.
- Le chat in evidenza sono locali al browser (`localStorage`) e vengono ordinate
  prima delle altre nello stesso gruppo.
- Il menu si chiude con click esterno o `Escape`.

### Conseguenze
- I nomi hanno più spazio e la sidebar è meno rumorosa.
- L’evidenziazione non è sincronizzata tra browser o dispositivi.
- Le azioni distruttive restano sempre a due passaggi (menu + conferma).

---
## ADR-041 — Titoli automatici delle sessioni
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
Pi usa `session_info` per il nome visualizzato, ma una nuova chat non ha un
nome finché l’utente non la rinomina; la sidebar ricade sul primo messaggio,
che è spesso lungo e poco leggibile.

### Decisione
- Al primo turno viene salvato subito un titolo locale deterministico, con
  fallback `Nuova chat`.
- Lo stesso turno avvia in background un titolo LLM usando il primo messaggio
  utente e la prima risposta dell’assistente (massimo 1200 caratteri ciascuno),
  senza memoria o allegati.
- Il titolo LLM viene salvato con `session_info` nativa e un metadata
  `memora.title` con `source: auto`.
- `renameSession` scrive `source: manual`; la generazione non può sovrascrivere
  un titolo manuale.
- La generazione avviene solo al primo turno completato, con timeout e fallback
  locale in caso di errore/provider non disponibile.
- Il titolo LLM si può disabilitare da **Amministrazione → Chat**
  (`chat.autoTitleEnabled` in `settings.json`); il fallback locale resta attivo.
  Non è una variabile d’ambiente.
- Un evento SSE `session_title` aggiorna la sidebar senza polling.

### Conseguenze
- La sidebar mostra un titolo utile già dal primo turno.
- Ogni nuova chat può produrre una piccola chiamata LLM aggiuntiva; il testo
  inviato è il primo scambio richiesta + risposta, senza memoria o allegati.
- Se il primo titolo automatico resta il fallback, viene ritentato al turno
  successivo fino a due tentativi.
- Il nome manuale resta sempre prioritario.

---
## ADR-042 — Turni in background e coda
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
L’esecuzione di un turno era legata alla connessione SSE del browser. Cambiando
chat o chiudendo il browser il lavoro poteva continuare senza controllo, e non
esisteva uno stato condiviso tra sessioni o dispositivi.

### Decisione
- Un `TurnManager` server-side possiede i turni, indipendentemente dalla
  connessione del client.
- Massimo 2 turni concorrenti globali; gli altri vengono accodati.
- Una sessione ha un solo turno attivo; i messaggi successivi vengono messi in
  coda, non iniettati nella risposta in corso.
- La disconnessione del browser non interrompe il turno; solo un abort esplicito
  o un riavvio del server lo fermano.
- Gli eventi hanno una sequenza e un buffer per consentire la riconnessione;
  il client usa EventSource e riprende da `after` quando la chat torna visibile.
- `GET /api/turns` espone lo stato sintetico; la sidebar usa polling leggero e
  mostra giallo per turni in corso fuori dalla chat attiva e verde per risposte
  completate non ancora lette.
- Lo stato sintetico dei turni viene persistito in `config/turns.json`; al
  riavvio i turni `running`/`queued` diventano `interrupted`. Il contenuto degli
  eventi non viene persistito.
- I turni completati sostituiti vengono rimossi dalla mappa in memoria; i
  turni falliti/interrotti hanno un indicatore rosso nella sidebar.

### Conseguenze
- L’utente può leggere una chat mentre un’altra lavora.
- Il browser può essere chiuso durante la generazione; il risultato viene
  recuperato alla riapertura.
- Servono un limite di concorrenza e una coda per proteggere RAM, CPU e quota
  provider.
- La consegna cross-device può arrivare con il ritardo del polling.

---
## ADR-043 — Robustezza dei turni in background (P2)
**Data:** 2026-11-18
**Stato:** accepted

### Contesto
Dopo il primo rilascio dei turni in background restavano cinque limiti: il
limite di concorrenza era fisso, lo stato “letta” viveva solo nel browser, i
messaggi in coda potevano sparire dopo un reload, non c’erano notifiche e i test
coprivano il manager ma non il percorso HTTP con più client.

### Decisione
- La concorrenza è configurabile in **Amministrazione → Chat** con
  `chat.maxConcurrentTurns` (intero 1–4, default 2). È applicata a caldo tramite
  `TurnManager.setMaxConcurrent()` e non usa variabili d’ambiente.
- Lo stato letto è persistito dal server in `config/turn-reads.json` con mode
  `0600`; il localStorage resta un fallback ottimistico. La mappa è
  `sessionId → turnId` e non contiene testo delle conversazioni.
- `TurnInfo.text` espone il testo della richiesta in memoria, così la UI può
  mostrare subito i messaggi in coda anche dopo un reload. `turns.json` non
  persiste quel testo: i turni interrotti dopo un riavvio restano senza prompt
  duplicato e il contenuto autorevole resta nel JSONL.
- `GET /turns/current` restituisce il turno in esecuzione quando esiste, anche
  se c’è una richiesta in coda; `/api/turns` continua a esporre l’ultimo turno
  per sessione.
- Le notifiche sono notifiche browser opt-in, con permesso richiesto da un gesto
  esplicito. Richiedono la scheda Memora aperta e non sono push notification.
  Telegram non è implementato e non viene simulato.
- I test end-to-end HTTP avviano due client SSE, verificano la chiusura al
  completamento e il replay di un turno già completato; restano test del manager
  per coda, abort, aumento di concorrenza e riavvio.

### Conseguenze
- L’amministratore può adattare il parallelismo alla RAM disponibile senza
  riavviare il servizio.
- “Letta” è coerente tra browser e dispositivi, con un ulteriore file di stato
  da includere nei backup.
- Le notifiche browser non raggiungono un browser chiuso; una futura integrazione
  Telegram o Web Push potrà aggiungere la consegna esterna.
- Il polling può ancora arrivare con circa 2 secondi di ritardo.

---
## ADR-044 — Auto-approvazione conservativa dei nuovi ricordi
**Data:** 2026-11-19
**Stato:** accepted

### Contesto
La revisione manuale di ogni proposta del Curator creava attrito: molte proposte
erano accurate e chiaramente utili. Approvare tutto automaticamente avrebbe
indebolito il modello di sicurezza, soprattutto per gli aggiornamenti che possono
sostituire o rimuovere conoscenza esistente.

### Decisione
- Aggiungere `curator.autoApproveEnabled` (default **off**),
  `curator.autoApproveMinConfidence` (default **0,90**) e
  `curator.autoApproveMinSalience` (default **0,85**), modificabili da
  **Amministrazione → Curator** e applicati a caldo.
- L’auto-approvazione vale solo per candidati con `action: "new"`, stato
  `pending`, nessun duplicato/conflitto, nessun segreto o PII ad alta confidenza
  e entrambi gli score sopra le soglie configurate.
- La destinazione deve essere la memoria globale (`memory/…`) o il progetto
  corrente della chat (`projects/<currentProjectId>/memory.md`). Le scritture
  cross-project non sono mai automatiche.
- L’auto-approvazione usa lo stesso percorso di validazione, scrittura Markdown e
  reindex dell’approvazione manuale. Il candidato risultante registra
  `approvedBy: "auto"` e `autoApprovedAt`; un errore di scrittura lascia il
  candidato pending.
- Aggiornamenti, conflitti, duplicati e dati personali restano sempre in
  revisione manuale. Le approvazioni automatiche sono visibili in **Memory Inbox
  → Salvati automaticamente** e restano tracciate nel candidate store.
- Non viene introdotta una variabile d’ambiente: è una preferenza
  dell’amministratore.

### Conseguenze
- I nuovi fatti comuni possono essere conservati senza un click manuale, mentre
  le modifiche rischiose restano protette.
- Le soglie possono essere tarate osservando la qualità reale delle proposte.
- L’auto-approvazione non è ancora annullabile dalla Inbox; le memorie restano
  modificabili o eliminabili dal Second Brain.
- Una fase futura potrà valutare auto-update protetti o undo in un click, ma è
  deliberatamente fuori scope per questa decisione.

---
## ADR-045 — Download in chat e revisione visuale manuale
**Data:** 2026-11-19
**Stato:** accepted

### Contesto
Gli artefatti erano raggiungibili dal pannello laterale, ma la risposta
dell’assistente non offriva un download diretto. La qualità di PDF e presentazioni
variava; un modello con visione potrebbe valutare l’impaginazione, ma i tool
metadata-only generano il contenuto solo dopo la tool call, quindi non esiste
un’anteprima nello stesso turno.

### Decisione
- Gli artefatti possono avere `sourceMessageId`, `sourceTurnId` e
  `sourceTimestamp`, salvati in un sidecar nella directory dell’artefatto. I
  nuovi artefatti vengono associati al messaggio utente corrente dopo il turno;
  le versioni successive mantengono l’associazione originale.
- Le risposte dell’assistente mostrano card di download per i propri artefatti.
  La card espone nome, versione, dimensione, apertura e download, con fallback per
  artefatti legacy senza metadati sorgente.
- Aggiungere un’azione manuale **Rivedi anteprima** per PDF, HTML e PPTX quando il
  modello attivo dichiara il supporto immagini. Il server genera un’anteprima PNG
  (PDF.js per i PDF, Chromium per HTML/PPTX), la salva come allegato immagine e
  avvia un normale turno di revisione con una checklist visuale.
- Il turno di revisione può creare una nuova versione dello stesso artefatto. La
  versione precedente resta disponibile. Non c’è alcun loop automatico né QA
  visuale in background in questa milestone.
- La revisione visuale di DOCX e XLSX è rimandata finché non saranno disponibili
  i rispettivi renderer. La funzione è opt-in per singola azione e non consuma
  token se non viene usata.

### Conseguenze
- L’utente può scaricare i deliverable direttamente dalla risposta e ricaricare
  senza perdere l’associazione artefatto-messaggio.
- Il feedback visuale è controllato e verificabile; non può riscrivere
  silenziosamente un artefatto.
- La revisione PDF usa per ora la prima pagina; contact sheet per PDF lunghi e
  revisione automatica potranno essere aggiunti in seguito.
- La revisione dipende dai metadati del provider/modello e dalla disponibilità di
  Chromium/PDF.js sul server.

---
## ADR-046 — Ragionamento visibile durante e dopo il turno
**Data:** 2026-11-19
**Stato:** accepted

### Contesto
Alcuni modelli configurati espongono blocchi `thinking`/reasoning. La chat li
scartava, quindi l’utente non poteva seguire una fase di ragionamento lunga e non
aveva feedback durante l’attesa. Il ragionamento è già memorizzato da Pi nel
transcript del messaggio assistant.

### Decisione
- Il client SSE legge gli eventi `thinking_delta` dai payload Pi
  `message_update` e accumula il ragionamento separatamente dal testo visibile.
- La UI mostra un pannello **Ragionamento** chiuso, con anteprima live dell’ultima
  riga; premendolo si apre il pensiero completo in testo semplice, in un’area
  scrollabile che segue lo stream.
- Il pannello compare solo nei messaggi assistant e solo quando esiste
  ragionamento. Non viene mai mescolato al Markdown della risposta né usato come
  candidato memoria.
- Il ragionamento completato viene estratto dai blocchi `thinking` Pi quando si
  carica lo storico, quindi resta disponibile dopo un reload o da un altro
  dispositivo.
- Il ragionamento è output del modello, non istruzione né memoria autorevole. Non
  viene esportato, indicizzato o inviato al Curator come parte della risposta.

### Conseguenze
- L’utente può seguire il pensiero durante l’attesa e consultarlo dopo.
- La UI può esporre contenuti sensibili su cui il modello ha ragionato; restano
  locali alla chat autenticata e seguono la retention della sessione.
- I modelli che non restituiscono delta di thinking non mostrano il pannello.

---
## ADR-047 — Anteprime PDF affidabili e paginazione A4
**Data:** 2026-11-20
**Stato:** accepted

### Contesto
**Rivedi anteprima** su un PDF poteva fallire con HTTP 500. Il processo usa anche
`pdf-parse` per allegati PDF e pagine web. Quella libreria include PDF.js 5 e
`@napi-rs/canvas` 0.1.80 e lascia su `globalThis` una classe `Path2D` e un fake
worker di quella versione. PDF.js 6 riceveva quindi un path canvas incompatibile
o un worker di versione diversa, con un TypeError in `fill`.

I PDF HTML generati da layout da una pagina potevano inoltre superare l’altezza
A4. Chromium spezzava una scheda con bordo e il suo testo tra due pagine,
lasciando la parte inferiore del testo su una seconda pagina quasi vuota.

### Decisione
- Il render della preview PDF salva i globals PDF del processo, installa
  `Path2D`/`DOMMatrix`/`ImageData` di `@napi-rs/canvas` 1.1.1, rimuove il fake
  worker estraneo e ripristina i valori precedenti in `finally`.
- I render delle preview sono serializzati con una piccola coda in-process, così
  due render non possono scambiarsi i globals contemporaneamente.
- Il render HTML→PDF inietta CSS di paginazione solo per la stampa: i titoli
  restano con il contenuto seguente, paragrafi/schede/tabelle evitano interruzioni
  interne, le intestazioni di tabella si ripetono e widows/orphans sono limitati.
  Il CSS non cambia l’anteprima a schermo.
- Le linee guida del prompt PDF ora chiedono blocchi multipagina espliciti e
  `break-inside: avoid` su schede, callout e tabelle, invece di un unico
  contenitore `min-height: 297mm` che trabocca.

### Conseguenze
- **Rivedi anteprima** funziona dopo l’estrazione testo da PDF o la lettura di PDF
  web.
- I PDF esistenti non cambiano; i nuovi PDF HTML spostano una scheda alla pagina
  successiva invece di tagliarne il testo al confine.
- Il CSS non può correggere un layout intrinsecamente più alto dell’area utile:
  il modello deve comunque progettare contenuti leggibili da una o più pagine.

---
## ADR-048 — Profili agente come preset di sessione circoscritti
**Data:** 2026-11-20
**Stato:** accepted

### Contesto
Chat diverse richiedono competenze e metodi diversi (brainstorming, contabilità,
coding, social media) condividendo progetto, memoria e policy di sicurezza.
Caricare tutte le competenze in ogni prompt sprecherebbe contesto e renderebbe
il comportamento imprevedibile.

### Decisione
- I profili sono file-based in `$MEMORA_DATA_DIR/agents/<id>/` con
  `agent.json`, `PROMPT.md` e `skills/<name>/SKILL.md` opzionali.
- Il server crea 15 esempi (`brainstorming`, `commercialista`, `sviluppatore`,
  `social-media`, `tutor`, `avvocato`, `traduttore`, `scrittore`, `chef`, `viaggi`,
  `finanza`, `marketing`, `designer`, `ricercatore`, `business`). Su una data
  directory esistente aggiunge una sola volta i default mancanti. Profili reali e
  dati personali non stanno mai nel repository pubblico.
- Un profilo aggiunge un blocco di istruzioni dopo il prompt base immutabile di
  Memora e prima delle istruzioni di progetto. Non può cambiare policy di ruolo,
  permessi, tool o regole di memoria.
- Le competenze complete non vengono iniettate nel system prompt. Il prompt
  elenca nomi e descrizioni; il tool `load_skill` carica una competenza on demand,
  confinata alla directory del profilo.
- Il primo messaggio blocca il profilo. La sessione salva uno snapshot del prompt
  e l’indice delle competenze in una custom entry `memora.agent`; la sidebar e il
  composer mostrano solo il riepilogo del profilo. Nome, icona e colore vengono
  risolti live dal profilo corrente; **Aggiorna profilo** applica esplicitamente
  un nuovo prompt/catalogo competenze a una chat esistente dal messaggio
  successivo.
- Le nuove chat mostrano i chip dei profili sopra il composer fino al primo
  turno. Selezionare **Memo base** significa nessun profilo. Dopo l’invio il
  selettore sparisce e il profilo scelto compare come icona colorata non interattiva
  accanto ai controlli allegati e web. La stessa icona compare accanto alla
  sessione nella sidebar solo per i profili diversi da base.
- I profili non aggiungono tool builtin. Un profilo coding può revisionare codice
  incollato o allegato, ma non leggere il repository finché non viene progettata
  una policy workspace/tool separata.
- **Amministrazione → Agenti** modifica gli stessi file, valida gli ID e sposta
  profili/competenze eliminati in `.trash/agents`; le chat esistenti mantengono
  lo snapshot di prompt/competenze, mentre nome, icona e colore vengono risolti
  dal profilo corrente per la visualizzazione.

### Conseguenze
- L’utente cambia competenza per chat senza duplicare progetti o memoria.
- Il costo del prompt resta limitato: le istruzioni del profilo sono brevi e le
  competenze sono caricate on demand.
- Le chat esistenti mantengono lo snapshot del profilo quando il file viene
  modificato; le modifiche valgono per le nuove chat. Rimuovere una competenza
  può far fallire un successivo `load_skill` senza rompere la conversazione.
- I file dei profili sono configurazione controllata dall’amministratore.
  Profili importati o di terze parti vanno revisionati prima dell’uso.

---
## ADR-049 — Aggiornamento esplicito del profilo e metadati visivi live
**Data:** 2026-11-20
**Stato:** accepted

### Contesto
Una chat conserva uno snapshot del profilo per evitare che il prompt cambi
silenziosamente a metà conversazione. È corretto per la riproducibilità, ma chi
migliora un profilo può volerlo applicare a una chat esistente. Nome, icona e
colore, invece, non devono restare vecchi solo perché il prompt è congelato.

### Decisione
- Nome, icona e colore vengono risolti dal profilo corrente quando le sessioni
  vengono elencate e riprese; lo snapshot resta il fallback se il profilo viene
  rimosso.
- Prompt e catalogo competenze restano nello snapshot della sessione.
- `POST /api/sessions/:id/agent/refresh` rilegge lo stesso profilo e sostituisce
  lo snapshot della sessione. Viene rifiutato durante uno streaming o se la
  sessione non ha un profilo.
- La chat espone **Aggiorna profilo**, con una conferma esplicita. Il nuovo
  prompt/competenze valgono dal messaggio successivo e il transcript non cambia.
- Una entry `memora.agent` registra l’aggiornamento nel JSONL Pi.

### Conseguenze
- Le modifiche a icona/nome/colore aggiornano subito le chat esistenti.
- Le modifiche a prompt/competenze richiedono un aggiornamento esplicito per le
  chat esistenti.
- Nessuna chat cambia comportamento senza un’azione dell’utente.
- Un profilo eliminato non può essere aggiornato; lo snapshot precedente
  continua a funzionare.
