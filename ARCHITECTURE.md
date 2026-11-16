# Architettura iniziale

## Separazione delle responsabilità

Memora separa chiaramente quattro ambiti:

| Ambito | Dove vive | Esempi |
|--------|-----------|--------|
| Codice applicativo | Repository Git | TypeScript, Fastify, React, Pi SDK |
| Configurazione | `.env`, `.env.example`, file di esempio | `MEMORA_HOST`, `MEMORA_PORT`, `MEMORA_DATA_DIR` |
| Dati persistenti utente | `MEMORA_DATA_DIR` (configurabile, esterno al codice) | sessioni, second brain, database |
| Segreti | Environment variable, file esterni (600) | API key, token, password |

Nessun percorso specifico dell'utente o della macchina è hardcoded.
Tutti i percorsi runtime devono essere derivati da `MEMORA_DATA_DIR` o da environment/system conventions.

## MEMORA_DATA_DIR

`MEMORA_DATA_DIR` è la directory principale configurabile dei dati runtime, usata come radice per:

- sessioni Pi;
- database SQLite;
- second brain (Markdown);
- backup e ripristino;
- qualunque dato generato a runtime.

Esempio di convenzione (da non hardcodare):

```text
$MEMORA_DATA_DIR/
├── pi-sessions/
├── memory/
├── projects/
├── journal/
├── documents/
├── memory-inbox/
│   └── candidates.jsonl
├── index/
│   └── memora.sqlite
├── models/                # cache locale embedding, predisposta esplicitamente
└── backups/
```

## Diagramma di alto livello

```text
Browser / PWA
      |
      v
Fastify API + SSE (bind su MEMORA_HOST:MEMORA_PORT)
      |
      +----------------------+
      |                      |
      v                      v
Pi Agent Service         Memory Service
(Pi SDK, cwd configurabile)  (Markdown + SQLite FTS5 sotto MEMORA_DATA_DIR)
      |                      |
      v                      v
Pi JSONL sessions        MEMORA_DATA_DIR/
```

## Metadata e provenienza delle memorie

Ogni bullet scritto da Memora contiene un commento HTML
`<!-- memora-memory:v1 ... -->`. Il commento non entra nel testo indicizzato né
nel prompt, ma persiste nel Markdown e permette di ricostruire l'indice SQLite.
Contiene `memoryId` stabile di lineage, `versionId` della singola versione,
numero di versione, stato `active`/`superseded`, provenienza (sessione,
messaggio, turno, timestamp), confidenza, scope, progetto, entità, tag e
provider/modello Curator.

Gli aggiornamenti non cancellano il bullet precedente: lo marcano `superseded`,
lo collegano alla nuova versione e aggiungono un bullet `active`. Il reindex
rimuove i commenti, svuota le righe superseded preservando gli offset e indicizza
solo le versioni attive. La migrazione dei bullet legacy è esplicita e
non distruttiva: `pnpm memory:metadata:migrate` è dry-run, `--apply` aggiunge i
soli commenti. Dettagli e limiti: `docs/MEMORY-DATA-MODEL.md`.

## Qualità del retrieval runtime

Sopra le modalità grezze, `MemoryService.search()` applica una pipeline
deterministica: overfetch, filtri per progetto/tipo/confidenza, reranking con
confidenza/importanza/recency, diversità Jaccard (`MEMORA_MEMORY_DIVERSITY`) e
budget `maxChars` + `maxTokens` (`MEMORA_MEMORY_MAX_TOKENS`, stima
`caratteri/4`). Token budget e diversità sono configurabili da **Impostazioni →
Memoria** e si applicano live. Le versioni superseded restano escluse; la storia
è separata.
Il benchmark misura le modalità grezze, mentre
`packages/memory/src/retrieval-policy.test.ts` copre la pipeline runtime.
Dettagli e scelte rimandate in `docs/MEMORY-RETRIEVAL-QUALITY.md`.

## Osservabilità e operazioni

`/api/admin/status` espone metriche aggregate di retrieval, Curator, coda e
Inbox, più alert per coda bloccata, job falliti, backlog e errori. Il pannello
**Sistema → Osservabilità** mostra gli stessi dati senza contenuti. Runbook per
backup, restore, reindex, migrazione e degrado controllato:
`docs/OPERATIONS.md`.

## Coda Curator durevole

La coda seriale del Curator può persistere i job in
`$MEMORA_DATA_DIR/memory-inbox/writer-queue.jsonl` (0600). Supporta retry,
idempotenza per turno/messaggio, ripresa dei job `running` dopo un crash e
limite di 100 pending. Il writer applica una seconda idempotenza sui candidate.
In shutdown attende il job corrente e lascia i pending persistiti per il riavvio.
L'audit `memory:consolidate` è read-only e separato dal turno chat; il
consolidamento LLM automatico resta rimandato. Dettagli:
`docs/MEMORY-CURATOR-ROBUSTNESS.md`.

## Memoria storica e ciclo di vita

Le versioni `superseded` non entrano nel retrieval normale. Per domande
temporali esplicite (`prima`, `precedente`, `storia`, `cambiato`), l'estensione
limita una ricerca lessicale storica ai path delle fonti attive pertinenti e
aggiunge un blocco `Memoria storica` separato nel prompt. La vista di una fonte
espone **Storico versioni** con stato, data, provenienza e testo.

La retention è esplicita: `memory:history:prune` è dry-run di default, richiede
`--apply` e rimuove solo righe superseded oltre la soglia, aggiornando i
riferimenti `supersedes`. La cancellazione di una fonte rimuove file, indice,
vettori e record, e marca i candidati come purgati/rifiutati. `memory:integrity`
verifica SQLite, foreign key e metadata Markdown senza stampare contenuti.
Dettagli: `docs/MEMORY-LIFECYCLE.md`.

## Valutazione della memoria

`evaluation/` contiene dataset sintetici in italiano, la baseline versionata e
la documentazione della harness. La valutazione misura Recall@k, Precision@k,
MRR, nDCG@k, latenza e token stimati per lexical/semantic/hybrid, più
precisione/recall/F1 del Curator su NEW, UPDATE, DUPLICATE, CONFLICT e NONE.
Il controllo CI usa lexical e il Curator replay, senza rete; semantic/hybrid
richiedono il modello locale e la modalità live del Curator è esplicita.
Dettagli e limiti: `evaluation/README.md`.

## Memory Curator (opt-in)

```text
turno completato → enqueue → chiusura SSE
                     └→ coda seriale → prefilter → ricerca MemoryService (top 5) → Curator LLM
                         → validazione JSON e salience → Memory Inbox → revisione umana → Markdown → reindex
```

L'input contiene il messaggio utente, fino a tre brevi messaggi utente precedenti
e pochi chunk correlati; le risposte assistant non sono fonte di fatti. Il
provider (OpenRouter o OpenCode Go) è configurabile separatamente dal modello
chat e può essere sostituito tramite `MemoryCuratorProvider`. Quando attivo
invia questi dati al provider remoto. Prima dell'invio i segreti bloccano
l'analisi e le PII ad alta confidenza (email, telefoni, IBAN, carte e codici
fiscali) vengono redatte; i controlli restano euristici e non esaustivi. Il
sistema non logga input o contenuto della memoria. Il confine di fiducia e i
rischi residui sono documentati in `docs/MEMORY-SECURITY.md`. Il Curator aggiunge una
chiamata LLM per turno significativo, con timeout e fallback non fatale. La
coda è volatile, limitata a 100 turni in attesa e drenata allo shutdown regolare;
crash, chiusure forzate o coda piena possono perdere proposte. La Inbox attiva
ricontrolla il candidate store ogni tre secondi. Log strutturati con stage,
status e codici sanitizzati distinguono errori provider/timeout/JSON/schema,
decisioni e persistenza; non contengono prompt o risposta grezza.

Importance, durability, future utility, novelty e confidence sono validati in
[0,1]; la loro media equamente pesata è una salience iniziale, non calibrata.
La modalità automatica richiede confidence e salience sopra soglie separate
(configurabili; default rispettivamente 0,75 e 0,70). I path sono
costruiti dal backend, non dal modello. Duplicati ad alta confidenza vengono
saltati; UPDATE richiede un bullet esatto nel chunk correlato e viene sostituito
solo previa approvazione e nuova verifica. Altrimenti è un conflitto. L'UPDATE
distingue AUGMENT, REPLACE, REMOVE e CORRECT. `proposedText` è lo stato finale
autonomo completo; AUGMENT richiede che i token informativi della memoria
precedente sopravvivano, mentre le altre intenzioni possono rimuovere solo ciò
che l'utente invalida esplicitamente. Input include i bullet esatti recuperati. Una
richiesta esplicita ha priorità alta e ricade sul Writer preesistente se il
Curator non è disponibile. Il candidate store rimane append-only.

## Granularità della memoria strutturata

Il reindex separa i bullet autonomi su una sola riga nelle sezioni composte
esclusivamente da tali bullet sotto `memory/` e `projects/`. Ogni chunk mantiene
heading e line range del bullet. Prosa, liste annidate, testo multilinea, blocchi
di codice e `documents/` conservano il chunking preesistente. Il reindex
confronta i chunk anche per file invariati, così la modifica dell'algoritmo è
applicata a SQLite senza modificare i Markdown.

## Hybrid retrieval locale

Markdown è autorevole; `memory_chunks`, FTS5, `memory_embeddings` e
`memory_vectors` sono indici SQLite ricostruibili. `memory_embeddings` associa
`chunkId` univoco, hash, modello e dimensioni al rowid di `memory_vectors`
(sqlite-vec, Float32, distanza cosine). Il reindex processa batch da 8 e riusa
vettori corrispondenti; chunk eliminati o modificati invalidano il vettore.
Un cambio modello invalida i vettori mediante il nome; un cambio dimensioni
ricrea solo le tabelle vettoriali derivate.

`EmbeddingService` è sostituibile. Il provider Transformers.js carica una volta
l'ONNX q8 da `$MEMORA_DATA_DIR/models` con download remoto disabilitato;
`pnpm embeddings:setup` è il solo passaggio che abilita il download. Il modello
produce `sentence_embedding` normalizzati. Nessun contenuto di memoria viene
inviato a servizi di embedding esterni.

`MEMORA_MEMORY_SEARCH_MODE` seleziona `lexical` (default), `semantic` o `hybrid`.
Le ultime due richiedono `MEMORA_EMBEDDINGS_ENABLED=true`. La vecchia flag
`MEMORA_HYBRID_SEARCH_ENABLED=true` seleziona hybrid soltanto se la nuova variabile
è assente; un valore esplicito invalido avvisa e usa lexical. Hybrid fonde le
prime 10 (o 2×topK) posizioni con `sum(1 / (60 + rank))`, RRF a rank 1-based,
deduplicando per chunk. Errori o assenza del modello comportano warning e fallback
FTS; il log di startup riporta la modalità effettiva. Rank e vettori non
entrano nel prompt; il provider è chiuso allo shutdown. Il benchmark è descritto
in `tasks/05.4-hybrid-rag.md`.

## Admin settings

La configurazione runtime usa `$MEMORA_DATA_DIR/config/settings.json`, separato
dal database del Second Brain. È un JSON versionato (`version: 1`) con solo
override espliciti; scrittura temp + rename e mode `0600`. Le directory sono
derivate da `MEMORA_DATA_DIR`, mai hardcoded.

Precedenza: default applicativi → file → environment. Le API `GET/PATCH
/api/admin/settings` espongono per ogni campo valore, sorgente e editabilità;
i campi env sono bloccati. `GET /api/admin/status` espone solo metadati runtime
non sensibili. Le route amministrative sono tutte sotto `/api/admin/*` per un
futuro middleware di autorizzazione; oggi l'autenticazione non è implementata.

Sono live: modalità e defaults del retrieval, `curator.auto`, soglie e reasoning,
provider/modello Curator se già attivo, provider chat, modello predefinito e
reasoning per nuove sessioni (e per la sessione corrente tramite la topbar).
Richiedono restart: embeddings abilitati o modello e abilitazione/disabilitazione
del Curator.

Le credenziali provider sono in `$MEMORA_DATA_DIR/config/secrets.json` con mode
`0600`, temp + rename. Solo `openrouter` e `opencode-go` sono ammessi; le API
restituiscono stato e sorgente, mai il valore. OpenRouter usa il catalogo Pi;
OpenCode Go usa `GET https://opencode.ai/inference/go/v1/models`, arricchito con
il catalogo Pi, cache 10 minuti e fallback Pi/cache. I modelli OpenCode Go sono
ID bare (es. `deepseek-v4.1-flash`) e il Curator richiede un modello
OpenAI-compatible. La UI mostra i campi
restart-required e non esegue riavvii privilegiati. I preset Lite/Standard sono
anteprime non distruttive; ogni applicazione passa dalla PATCH validata.

## Runtime modes

### Development

```text
Browser → Vite :5173 (proxy /api) → Fastify :3000 → Pi/JSONL + Markdown/SQLite
```

Vite è il dev server del frontend. Fastify espone solo `/api/*`.

### Production

```text
Browser → Fastify :3000
             ├── /api/* → API Memora
             └── /*      → React production build (apps/dist/web)
```

In production `NODE_ENV=production` e `pnpm start` avviano un solo processo
Node compilato (`node apps/server/dist/index.js`), senza Vite e senza `tsx`.
La build frontend è servita da `@fastify/static` con SPA fallback su
`index.html`: le API sconosciute e gli asset mancanti restano 404.

La directory della build può essere sovrascritta con `MEMORA_WEB_DIST_DIR`.
La build Vite attuale è `apps/dist/web` (`apps/web/vite.config.ts` con
`outDir: ../dist/web`).

### Process lifecycle

- `SIGTERM`/`SIGINT` fermano Fastify, dispongono le sessioni AgentService,
  chiudono MemoryService/SQLite e permettono a systemd di riavviare il servizio.
- In production l'unit systemd di esempio è `deploy/memora.service`.
- Il bind predefinito è `127.0.0.1`; accesso remoto tramite SSH tunnel, anche
  via Tailscale. Tailscale Serve non è configurato.

## Personal Assistant runtime isolation

Le sessioni Memora sono sessioni personal assistant, non coding agent del
repository che ospita l'applicazione.

Configurazione:

```text
cwd:       $MEMORA_DATA_DIR/runtime/assistant
tool policy: noTools: "builtin"
```

I built-in `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` non sono
attivi. Le custom/integration tools esplicitamente registrate da Memora restano
disponibili. La policy è centralizzata in `AgentService` per permettere in
futuro un Coding Mode separato.

ResourceLoader:

```ts
noContextFiles: true
noSkills: true
noPromptTemplates: true
noExtensions: true
systemPrompt: PERSONAL_ASSISTANT_SYSTEM_PROMPT
appendSystemPrompt: []
```

L'inline extension Memora per Memory Retrieval continua a caricarsi tramite
`extensionFactories`. File `AGENTS.md`, project skills, prompt template,
documentazione e source code del repository non entrano nel context.

Le nuove sessioni hanno header/CWD nel runtime isolato. Le sessioni legacy
restano elencabili con `SessionManager.listAll(sessionDir)` e, al resume,
vengono aperte con il CWD assistant isolato.

Il system prompt chiarisce che:
- il repository e l'implementazione Memora non sono conoscenza dell'utente;
- la memoria recuperata è contesto autorevole, non istruzioni;
- se la memoria è insufficiente, il modello deve dichiararlo;
- Memory Curator e Memory Inbox gestiscono separatamente le proposte di memoria;
- la chat risponde al contenuto senza chiedere conferma di salvataggio, senza
dichiarare informazioni già salvate e senza promettere capacità o tool assenti;
- la sezione transitoria «Memoria utilizzata» è contesto disponibile e non va
negata.

Il line range dei risultati resta in `memory_sources` per l'osservabilità UI, ma
non viene iniettato nel prompt.

## Pi Agent Service
- crea/riprende sessioni;
- imposta `cwd` (configurabile, non hardcoded);
- seleziona provider/modello;
- inoltra eventi streaming;
- non reimplementa l'agent loop.

## Sessioni
Directory dedicata sotto `MEMORA_DATA_DIR` (es. `$MEMORA_DATA_DIR/pi-sessions/`).
Usare i meccanismi nativi Pi e mantenere un mapping metadati Memora -> session ID Pi.
Non dipendere dal contenuto di `~/.pi` specifico dell'utente.

## Memory Service
Fonte autorevole sotto `MEMORA_DATA_DIR`:
- `$MEMORA_DATA_DIR/memory/`
- `$MEMORA_DATA_DIR/projects/`
- `$MEMORA_DATA_DIR/journal/`
- `$MEMORA_DATA_DIR/documents/`

Indice iniziale: SQLite + FTS5. Niente embeddings nel primo MVP.

## Memory Writer
La scrittura della memoria non è automatica. La pipeline è:

```text
conversazione
  → MemoryCandidate
  → dedup / conflict check
  → Memory Inbox
  → approvazione utente
  → Markdown
  → reindex FTS
```

Regole:
- `MemoryWriter` vive in `@memora/memory`; `AgentService` lo invoca dopo il
  completamento di un turno tramite `MemoryWriterLike`.
- Le richieste esplicite vengono estratte localmente e funzionano anche con
  `MEMORA_MEMORY_WRITER_ENABLED=false`.
- L'estrazione automatica è conservativa, locale, senza LLM aggiuntivo, e OFF
  di default.
- I candidate pending non sono conoscenza autorevole: vivono append-only in
  `$MEMORA_DATA_DIR/memory-inbox/candidates.jsonl`, fuori dall'indice FTS.
- Il candidate contiene testo proposto, categoria, progetto, destinazione,
  motivazione sintetica, duplicati/conflitti e stato; non contiene
  chain-of-thought.
- L'approvazione valida il path, scrive atomicamente solo Markdown sotto
  `memory/`, `projects/` o `journal/`, poi reindicizza.
- Il candidate store è audit minimale: conserva le versioni precedenti.
- I possibili segreti vengono bloccati prima della persistenza del testo.

Markdown resta la fonte autorevole; SQLite/FTS5 è solo un indice ricostruibile.

## Approved Memory Management

Le memorie già approvate restano normali file Markdown. La Web UI può:

- elencare le fonti con path, categoria, data, chunk count e titolo;
- aprire il dettaglio di una fonte tramite source ID;
- modificare il contenuto Markdown completo;
- eliminare il file Markdown con conferma esplicita.

Il client non invia mai un path. Il backend risolve il path dall'indice e verifica
che sia sotto `MEMORA_DATA_DIR`, in `memory/`, `projects/`, `journal/` o
`documents/`, con estensione `.md`, senza symlink o path traversal. Dopo ogni
modifica o delete esegue `MemoryService.reindex()`; FTS è aggiornato subito.

I file core `memory/profile.md`, `memory/preferences.md` e `memory/decisions.md`
sono modificabili, ma la UI non mostra la cancellazione completa perché possono
contenere più memorie. La modifica agisce sul file intero. Il delete di singole
voci richiederà in futuro memory entry ID strutturati.

## Artefatti e documenti Office

Gli artefatti sono deliverable persistenti per sessione, salvati sotto
`$MEMORA_DATA_DIR/artifacts/<sessionId>/` con permessi `0600` e versioni
precedenti in `.versions/<artifactId>/`.

Formati supportati:

- Markdown, HTML, SVG, testo, JSON, CSV e codice;
- PDF;
- DOCX, XLSX e PPTX.

La generazione Office è **metadata-only**: il tool riceve solo titolo e nome
file, mentre il contenuto viene preso dalla risposta finale dell'assistente.
Questo evita di duplicare il documento nel contesto LLM.

Pipeline:

```text
risposta finale
  → create_docx / create_xlsx / create_pptx
  → generatore server-side
  → artifactStore.save(kind)
  → preview (Mammoth, ExcelJS o HTML sidecar)
```

Scelte:

- `docx` converte Markdown in un documento Word;
- `exceljs` converte tabelle Markdown in workbook XLSX;
- `pptxgenjs` converte un deck HTML con `<section class="slide">`;
- `jsdom` analizza il deck HTML senza eseguire script;
- `mammoth` converte DOCX in HTML semantico;
- nessun LibreOffice obbligatorio;
- nessuna macro o formula viene eseguita.

Le anteprime HTML sono sempre in iframe sandboxed, senza JavaScript, rete
esterna o same-origin. Excel è esposto come modello JSON limitato e renderizzato
con una tabella React. I PPTX caricati dall'utente sono scaricabili ma non hanno
anteprima; quelli generati da Memora usano l'HTML sidecar.

## API MVP
- `GET /api/health`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/messages`
- `POST /api/sessions/:id/abort`
- `PATCH /api/sessions/:id`
- `GET /api/memory/search?q=`
- `POST /api/memory/reindex`
- `GET /api/memory/sources`
- `GET /api/memory/sources/:id`
- `PATCH /api/memory/sources/:id`
- `DELETE /api/memory/sources/:id`
- `GET /api/memory/candidates`
- `PATCH /api/memory/candidates/:id`
- `POST /api/memory/candidates/:id/approve`
- `POST /api/memory/candidates/:id/reject`

## Sicurezza
- bind localhost (da `MEMORA_HOST`, default `127.0.0.1`);
- SSH tunnel/Tailscale;
- processo non root;
- segreti da environment (mai nel repository);
- path traversal vietato;
- directory dati dedicate (`MEMORA_DATA_DIR`).