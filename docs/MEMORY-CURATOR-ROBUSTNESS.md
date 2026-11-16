# Curator robusto e coda durevole

Il Curator resta fuori dal percorso SSE: la risposta della chat termina prima
dell'analisi memoria. La coda seriale ora può essere persistita e ripresa.

## Coda durevole

Quando il Curator è attivo, i turni vengono accodati in:

```text
$MEMORA_DATA_DIR/memory-inbox/writer-queue.jsonl
```

Il file è creato con permessi `0600` e non viene indicizzato nel Second Brain.
Contiene l'input del turno, quindi è un dato persistente da includere in backup
e retention.

Configurazione:

```text
MEMORA_MEMORY_QUEUE_MAX_ATTEMPTS=3
MEMORA_MEMORY_QUEUE_RETRY_DELAY_MS=5000
```

Comportamento:

- un solo job in esecuzione alla volta;
- limite di 100 job in attesa;
- retry con backoff lineare;
- dopo il numero massimo di tentativi il job è marcato `failed`;
- ogni job ha un `idempotencyKey` basato su `turnId`, `sourceMessageId` o hash
  del testo;
- un job già queued/running/completed non viene reinserito.

## Ripresa dopo riavvio

All'avvio:

- i job `queued` vengono ripresi;
- i job `running` vengono rimessi in coda se hanno tentativi disponibili;
- i job `failed` restano falliti;
- i job `pending` restano persistiti anche se il servizio viene fermato.

Il writer ha un secondo livello di idempotenza: se esiste già un candidate con
lo stesso `turnId`/`sourceMessageId`, il retry non crea un duplicato.

## Shutdown

Con la coda durevole, il graceful shutdown:

- attende il job in esecuzione;
- non avvia nuovi job;
- lascia i job in attesa nel file;
- al riavvio li riprende.

La coda volatile usata nei test mantiene invece il vecchio comportamento di
drain completo.

## Consolidamento periodico

È disponibile un audit deterministico e read-only:

```bash
pnpm memory:consolidate -- --min-similarity=0.82
```

Cerca coppie di memorie attive con similarità Jaccard elevata e stampa solo
conteggi, path e score. Non crea proposte, non modifica Markdown e non chiama
provider.

Può essere schedulato con cron o systemd timer per un controllo periodico:

```cron
30 3 * * 0 cd /percorso/memora && MEMORA_DATA_DIR="$MEMORA_DATA_DIR" pnpm memory:consolidate
```

## Consolidamento LLM read-only

Per analizzare semanticamente duplicati e contraddizioni su gruppi di memorie
attive:

```bash
MEMORA_MEMORY_CURATOR_PROVIDER=opencode-go \
MEMORA_MEMORY_CURATOR_MODEL=beam-free \
MEMORA_MEMORY_CURATOR_REASONING_LEVEL=low \
pnpm memory:consolidate:llm -- --max-records=20 --max-batches=2 --json=evaluation/consolidation.json
```

Il comando:

- invia solo memorie attive, in batch limitati;
- produce un report JSON `schemaVersion: 1`;
- propone `duplicate` o `conflict` con ID, path, testo consigliato e confidence;
- non crea candidate, non modifica Markdown e non applica merge.

È un'operazione LLM esplicita: consuma inferenza e invia dati al provider
configurato. Il report non va committato se contiene memorie personali.

## Feedback advisory

```bash
pnpm memory:feedback
```

Legge approvazioni/rifiuti, calcola tasso e punteggi medi e suggerisce se alzare,
abbassare o mantenere le soglie. Non modifica automaticamente la configurazione:
un tuning automatico su pochi dati sarebbe rischioso.

## Metriche operative

`pnpm memory:integrity` include anche:

- candidate totali, pending, conflict, approved e rejected;
- approval rate;
- stato SQLite, foreign key, record e metadata.

Il pannello amministrazione mostra:

- lunghezza coda Curator;
- job falliti;
- numero di tentativi totali.

Nessuna metrica include il contenuto delle memorie.

## Limiti attuali

Scelte deliberate:

- il consolidamento LLM è read-only e produce un report, non un merge automatico;
- il feedback loop è advisory e non cambia le soglie da solo;
- i batch hanno limiti espliciti di record e chiamate;
- lo schema del report di consolidamento è versionato (`schemaVersion: 1`);
- il Curator per-turno accetta `schemaVersion: 1` e rifiuta versioni future.

Queste scelte evitano modifiche automatiche rischiose alla memoria e mantengono
il costo del consolidamento prevedibile.
