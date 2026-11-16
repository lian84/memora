# Modello dati della memoria

Il Markdown resta la fonte autorevole. SQLite è un indice ricostruibile che
deriva dai file e dai commenti metadata presenti nei bullet.

## Formato di un bullet

Ogni memoria scritta da Memora ha un commento HTML sulla stessa riga:

```markdown
- Il progetto Vega usa PostgreSQL. <!-- memora-memory:v1 {"memoryId":"mem_...","versionId":"ver_...","version":2,"status":"active","createdAt":1760000000000,"updatedAt":1760000001000,"sourceSessionId":"session-...","sourceTimestamp":1759999000000,"confidence":0.92,"scope":"project:vega","project":"Vega","entities":[{"type":"project","name":"Vega"}],"tags":["project_fact"],"curatorProvider":"opencode-go","curatorModel":"deepseek-v4.1-flash","supersedes":["ver_..."],"supersededBy":null} -->
```

Il commento è invisibile nel Markdown renderizzato ma resta visibile nel sorgente
e nei backup. Non contiene il prompt, la conversazione o il testo della memoria:
il testo è già nel bullet.

## Identità e versioni

| Campo | Significato |
|---|---|
| `memoryId` | Lineage stabile della memoria attraverso gli aggiornamenti. |
| `versionId` | Identificatore univoco di una singola versione/stato. |
| `version` | Numero progressivo della versione, da 1. |
| `status` | `active` oppure `superseded`. |
| `supersedes` | Version ID sostituiti da questa versione. |
| `supersededBy` | Version ID che ha sostituito questa versione. |

Una nuova memoria usa `memoryId` e `versionId` derivati dal candidate ID. Un
aggiornamento conserva il `memoryId`, crea un nuovo `versionId`, incrementa
`version` e collega la catena.

I bullet legacy senza commento restano validi e vengono trattati come `active`.
Se vengono aggiornati, ricevono metadata legacy deterministiche; la migrazione
esplicita può annotare anche i bullet preesistenti.

## Provenienza e classificazione

| Campo | Significato |
|---|---|
| `createdAt` | Timestamp della prima creazione della lineage. |
| `updatedAt` | Timestamp dell'ultima versione. |
| `sourceSessionId` | Sessione Pi che ha originato la versione. |
| `sourceMessageId` | Messaggio Pi originale, se disponibile. |
| `sourceTurnId` | Identificatore del turno. |
| `sourceTimestamp` | Timestamp del messaggio originale. |
| `confidence` | Confidenza del Curator, `0..1`. |
| `importance`, `durability`, `futureUtility`, `novelty`, `salience` | Punteggi del Curator usati dal reranking runtime. |
| `scope` | Scope operativo, per esempio `project:vega`. |
| `project` | Nome del progetto, se applicabile. |
| `entities` | Entità riconosciute dal Curator. |
| `tags` | Tipo memoria e intento di aggiornamento. |
| `curatorProvider` | Provider che ha prodotto la proposta. |
| `curatorModel` | Modello che ha prodotto la proposta. |

Le memorie create dal writer esplicito senza Curator possono non avere
`curatorProvider`, `curatorModel` o `confidence`.

## Aggiornamento e storico

Un aggiornamento non cancella il vecchio bullet: lo marca `superseded` e aggiunge
un nuovo bullet `active` nella stessa sezione.

```markdown
- Il progetto Vega usa il turchese. <!-- ... "status":"superseded","supersededBy":"ver_2" ... -->
- Il progetto Vega usa il rosso. <!-- ... "version":2,"status":"active","supersedes":["ver_1"] ... -->
```

L'indicizzazione:

- rimuove i commenti metadata dal testo indicizzato;
- svuota le righe `superseded` prima del chunking, preservando gli offset di
  riga;
- espone solo le versioni `active` nei risultati di ricerca;
- conserva tutte le versioni in `memory_records` per audit e future viste
  storiche.

## SQLite

Tabelle derivate:

- `memory_sources`: file Markdown e hash del contenuto;
- `memory_chunks`: chunk indicizzati, con `metadata` JSON delle versioni attive;
- `memory_chunks_fts`: indice FTS5 contentless;
- `memory_records`: catalogo completo delle versioni, inclusi gli storici e il testo del bullet;
- `memory_embeddings` / `memory_vectors`: embeddings locali.

`memory_records` viene ricostruita a ogni reindex dai commenti Markdown. Se il
database viene eliminato, la memoria e la provenienza vengono ricostruite dai
file.

## Consultazione storica

Il testo delle versioni è conservato in `memory_records` per la vista
**Storico versioni** e per le domande temporali esplicite della chat.

```text
GET /api/memory/sources/:id/history
GET /api/memory/history?q=<query>[&path=<relativePath>]
```

La ricerca storica è lessicale, conservativa e limitata ai path delle fonti
attive pertinenti. Non viene usata per domande sul presente. Retention,
cancellazione e backup sono in `docs/MEMORY-LIFECYCLE.md`.

## Validazione

Durante il reindex:

- JSON invalido, campi mancanti, status sconosciuti e versioni non valide
  producono un warning con file, riga e codice, mai con il contenuto;
- riferimenti `supersedes`/`supersededBy` mancanti o con `memoryId` diverso
  producono un warning;
- le righe con metadata invalido restano indicizzate come testo normale, senza
  metadata;
- un errore metadata non blocca il reindex dell'intero file.

## Migrazione

I bullet esistenti senza metadata continuano a funzionare. Per annotarli:

```bash
# Mostra solo il conteggio, non modifica i file
pnpm memory:metadata:migrate

# Scrive i commenti e crea un backup .bak-<timestamp> per ogni file modificato
pnpm memory:metadata:migrate -- --apply --backup
```

La migrazione:

- aggiunge sola metadata, senza cambiare il testo dei bullet;
- ignora i blocchi di codice;
- usa ID deterministici da path, testo e occorrenza;
- non elimina e non riscrive memorie esistenti;
- richiede `MEMORA_DATA_DIR` o usa `./data`.

Non viene eseguita automaticamente all'avvio: la decisione di modificare i file
resta esplicita.

## Limiti

- I commenti non sono firmati: chi può modificare il Markdown può modificare la
  provenienza.
- La metadata occupa spazio nella riga e può essere rimossa da editor o script
  esterni.
- Non esiste ancora una policy di retention/archiviazione delle versioni
  superseded; è la Milestone D.
- Le entità e i tag dipendono dalla qualità del Curator.
- Un commento metadata è per definizione sulla stessa riga del bullet; non
  supporta metadata multilinea.
