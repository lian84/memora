# Qualità del retrieval

Il retrieval runtime usa una pipeline unica sopra FTS, embeddings e RRF. Il
benchmark misura ancora le modalità grezze; la pipeline runtime aggiunge
filtri, budget e diversità senza cambiare i dati Markdown.

## Pipeline

```text
query
  → retrieval lexical / semantic / hybrid
  → overfetch limitato
  → filtri progetto / tipo / confidenza
  → reranking con metadata
  → diversità MMR
  → budget maxChars + maxTokens
  → risultati per chat e UI
```

Il retrieval diretto (`searchLexical`, `searchSemantic`, `searchHybrid`) resta
disponibile per benchmark e diagnostica.

## Budget token

`maxChars` resta un limite di sicurezza. In aggiunta c'è il token budget,
configurabile da **Impostazioni → Memoria** (pagina dedicata) o tramite environment:

- `MEMORA_MEMORY_MAX_TOKENS` (default `1000`)
- stima: `ceil(caratteri / 4)`

Il budget viene applicato dopo filtri, reranking e diversità. Il primo risultato
viene sempre incluso, anche se supera il budget da solo; gli altri si fermano
prima di sforare. La stima non include JSON, metadati o system prompt.

## Filtri

`SearchOptions` supporta:

```text
project
memoryType
minConfidence
category
```

- `project`: metadata `project` oppure path `projects/<slug>/`.
- `memoryType`: tag della versione attiva.
- `minConfidence`: esclude chunk con metadata tutti sotto soglia. I bullet
  legacy senza metadata restano inclusi.
- `category`: filtro di categoria già esistente.

I filtri sono disponibili anche su `/api/memory/search` come query param.
`maxTokens` e `diversity` hanno un default runtime modificabile dal pannello
amministrazione; i parametri API li sovrascrivono per la singola richiesta.

## Reranking locale

Non viene caricato un cross-encoder: aggiungerebbe RAM e latenza senza una
valutazione reale sufficiente. Il reranker è deterministico e usa i metadata
della versione attiva:

- confidenza;
- importanza o salience;
- recency (`updatedAt`, decadimento a 30 giorni).

Il punteggio di ranking originale viene mantenuto come base. I boost sono
piccoli e non possono trasformare un risultato irrilevante in primo risultato
senza una base di ranking.

## Diversità

`MEMORA_MEMORY_DIVERSITY` (default `0.15`, range `0..1`, configurabile da
**Impostazioni → Memoria** (pagina dedicata)) applica una penalità di similarità Jaccard sui
token dei chunk. Serve a evitare di riempire il
contesto con versioni o paragrafi quasi identici.

`0` disabilita la penalità; valori alti favoriscono risultati diversi ma possono
penalizzare la precisione.

## Memoria superata e bassa confidenza

Le versioni `superseded` non entrano mai nel retrieval normale. La memoria
storica è gestita separatamente da `docs/MEMORY-LIFECYCLE.md`.

Le versioni attive con confidenza bassa possono essere filtrate con
`minConfidence` o scoraggiate dal reranker. Il valore predefinito non esclude
automaticamente i bullet legacy.

## Log e trasparenza

I risultati usati dal turno vengono esposti come `memory_sources` con source ID,
path, heading, line range e metadata delle versioni attive. I log applicativi
continuano a non contenere testo delle memorie o prompt.

## Benchmark

La baseline `evaluation/baseline.json` misura le modalità grezze. La pipeline
runtime è coperta da test dedicati in
`packages/memory/src/retrieval-policy.test.ts`:

- filtro progetto/tipo/confidenza;
- budget token;
- diversità configurabile;
- nessuna rottura con una sola fonte.

Per confrontare una modifica alla pipeline con la baseline usare comunque
`pnpm eval:memory:check`; per misurare l'effetto della pipeline runtime serve un
futuro benchmark dedicato, perché il benchmark attuale chiama le modalità dirette.

## Scelte rimandate

- **Query rewriting / multi-query**: valutato ma non implementato. Il retrieval
  ibrido fonde già lexical e semantico; un'espansione automatica delle query
  richiede una valutazione su query reali per evitare derive.
- **Cross-encoder locale**: valutato ma rimandato per RAM, latenza e mancanza di
  un modello italiano adatto già verificato offline.
- **Apprendimento dei pesi**: i pesi di reranking sono deterministici, non
  appresi. La calibrazione richiede un dataset reale anonimizzato.

## Limiti

- La tokenizzazione è una stima, non il tokenizer del provider.
- La diversità usa Jaccard sui token, non embedding.
- I boost di recency dipendono dall'orologio e dai metadata.
- Il benchmark attuale non misura la pipeline runtime completa.
- I filtri non cambiano il ranking di FTS/vector; vengono applicati dopo
  l'overfetch.
