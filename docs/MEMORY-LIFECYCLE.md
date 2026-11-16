# Ciclo di vita e memoria storica

La memoria attiva e la memoria storica sono separate. La prima risponde alle
domande correnti; la seconda serve per audit, rollback e domande sul passato.

## Versioni attive e superate

Un aggiornamento conserva il bullet precedente con `status: superseded` e
aggiunge un bullet `active` con lo stesso `memoryId`.

Il retrieval normale:

- usa solo le versioni `active`;
- ignora completamente le righe superseded;
- non mostra la storia nella chat se la domanda è sul presente.

La versione storica resta nel Markdown e in `memory_records`.

## Domande storiche in chat

Per query con indicatori temporali espliciti — `prima`, `precedente`, `storico`,
`storia`, `in passato`, `originariamente`, `cambiato`, `before`, `previous` — Pi
Hub:

1. esegue il retrieval normale;
2. limita la ricerca storica ai path delle fonti attive pertinenti;
3. cerca nelle versioni `superseded` il testo e i metadata;
4. aggiunge un blocco separato `Memoria storica` al prompt.

Il blocco storico è marcato come non corrente. Il modello deve usarlo per
domande su cambiamenti e passato, non come verità attuale.

Esempio:

```text
Memoria attiva: Demo usa MySQL.
Memoria storica: Demo usava PostgreSQL (versione 1, superata).
```

Il comportamento è volutamente conservativo: senza una query storica esplicita
la vecchia versione non entra nel contesto.

## Vista Storico versioni

Nella vista di una fonte del Second Brain è disponibile **Storico versioni**.
Mostra:

- versione attiva e versioni superate;
- numero di versione;
- data di aggiornamento;
- provider/modello Curator, quando presenti;
- sessione di origine;
- testo della versione.

API:

```text
GET /api/memory/sources/:id/history
GET /api/memory/history?q=<query>[&path=<relativePath>]
```

## Retention policy

Default: **nessuna cancellazione automatica**. Le versioni superate restano
finché l'utente non decide diversamente.

Per applicare una retention esplicita:

```bash
# Dry-run: mostra quanti file/versioni sarebbero rimossi
pnpm memory:history:prune -- --older-than-days=180

# Applica con backup
pnpm memory:history:prune -- --older-than-days=180 --apply --backup
```

Il comando:

- rimuove solo righe interamente `superseded` più vecchie della soglia;
- non rimuove mai la versione attiva;
- aggiorna i riferimenti `supersedes` rimasti;
- non modifica il testo delle versioni conservate;
- richiede `--apply` per scrivere;
- crea backup `.bak-<timestamp>` con `--backup`.

Dopo il prune eseguire **Reindex Second Brain**.

La soglia può essere fornita anche con
`MEMORA_MEMORY_HISTORY_RETENTION_DAYS`; non è una cancellazione automatica.

## Cancellazione di una fonte

L'eliminazione di una fonte:

- elimina il file Markdown;
- rimuove source, chunk, record e vettori dall'indice;
- marca i candidati pendenti/conflict come `rejected` con motivo
  `source_deleted`;
- marca i candidati già approvati con `purgedAt`/`purgeReason`, conservandone
  l'audit;
- esegue il reindex.

Non esiste una cache in memoria separata da invalidare.

## Backup, restore e integrità

Backup consigliato:

1. fermare il servizio;
2. copiare `MEMORA_DATA_DIR` con un archivio cifrato;
3. conservare separatamente le credenziali environment;
4. riavviare il servizio.

Restore:

1. fermare il servizio;
2. ripristinare `MEMORA_DATA_DIR`;
3. verificare permessi `0600` sui segreti;
4. avviare il servizio;
5. eseguire **Reindex Second Brain**;
6. eseguire il controllo integrità.

Controllo read-only:

```bash
pnpm memory:integrity
```

Verifica:

- `PRAGMA integrity_check` e `foreign_key_check` SQLite;
- metadata Markdown e riferimenti di versione;
- conteggi di fonti, chunk, record ed embeddings.

Non stampa contenuti personali. Esce con errore se trova metadata invalidi,
riferimenti rotti o violazioni SQLite.

## Memoria episodica, stabile e riassunti

- **Stabile**: `memory/` e `projects/`, versionata con metadata e lineage.
- **Episodica**: `journal/YYYY-MM-DD.md` e le sessioni Pi JSONL.
- **Riassunti gerarchici**: valutati ma non implementati. Con la dimensione
  attuale aggiungono complessità e rischio di perdita di dettaglio; sono
  rimandati a quando esisterà una valutazione su conversazioni reali.

## Privacy e retention

La storia aumenta il valore della memoria ma anche la quantità di dati
conservati. Le versioni superate possono contenere PII o informazioni che
l'utente non vuole più mantenere.

Regole:

- non conservare per sempre dati personali non necessari;
- usare il prune per una retention esplicita;
- usare la cancellazione della fonte per una rimozione completa;
- includere i backup nella policy di retention;
- non usare dati personali reali nei test o nella valutazione.

## Limiti

- Il rilevamento delle domande storiche è euristico.
- La ricerca storica è lessicale, non semantica.
- La vista storico mostra solo fonti con metadata; i bullet legacy non migrati
  non hanno storia.
- Il prune non aggiorna da solo l'indice: serve un reindex.
- La catena di versioni non è firmata: chi può modificare il Markdown può
  alterare la provenienza.
