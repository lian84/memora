# Operazioni e osservabilità

## Metriche

`GET /api/admin/status` e la pagina **Impostazioni → Sistema → Osservabilità**
espongono solo aggregati:

- retrieval: ricerche, errori, latenza media/max, risultati, token stimati;
- Curator: invocazioni, completati, declinati, falliti, JSON invalido, timeout;
- coda: lunghezza, job falliti, tentativi, età del job più vecchio;
- Inbox: pending, conflict, approved, rejected, approval rate;
- alert operativi.

I log non contengono query, prompt o contenuto delle memorie.

## Alert

Alert calcolati:

- job Curator falliti;
- coda Curator bloccata da oltre 2 minuti;
- oltre 50 job in coda;
- oltre 50 candidati pending/conflict;
- errori Curator nella sessione;
- errori di retrieval nella sessione.

Sono visibili nel pannello e restituiti in `status.metrics.alerts`.

## Coda Curator

File:

```text
$MEMORA_DATA_DIR/memory-inbox/writer-queue.jsonl
```

Contiene input personali dei turni: `0600`, da includere nei backup cifrati e
nella retention.

Configurazione:

```text
MEMORA_MEMORY_QUEUE_MAX_ATTEMPTS
MEMORA_MEMORY_QUEUE_RETRY_DELAY_MS
```

Se la coda è bloccata:

1. controlla `queueFailed`, `queueAttempts`, età del job più vecchio;
2. verifica provider e credenziali;
3. riavvia il servizio: i job pending vengono ripresi;
4. non cancellare il file se non si vuole perdere la coda.

## Backup

1. fermare il servizio;
2. copiare `MEMORA_DATA_DIR` in un archivio cifrato;
3. includere Markdown, `index/`, `memory-inbox/`, `chat-attachments/`, `artifacts/`, configurazione e modelli;
4. conservare separatamente le credenziali environment/secret store;
5. riavviare e verificare `/api/health`.

## Restore

1. fermare il servizio;
2. ripristinare `MEMORA_DATA_DIR`;
3. verificare permessi `0600` su segreti e coda;
4. avviare;
5. eseguire **Reindex Second Brain**;
6. eseguire `pnpm memory:integrity`.

## Reindex e migrazione

```bash
curl -X POST http://127.0.0.1:3000/api/memory/reindex
pnpm memory:metadata:migrate          # dry-run
pnpm memory:metadata:migrate -- --apply --backup
pnpm memory:integrity
```

Il reindex è ricostruibile: SQLite non è l'unica copia.

## Degrado controllato

### Modello embeddings assente o corrotto

- `semantic`/`hybrid` effettivo passa a `lexical`;
- la chat continua con FTS;
- `GET /api/admin/status` mostra `embeddings.available=false` e il modo effettivo;
- per ripristinare: `pnpm embeddings:setup`, poi reindex.

### Database SQLite corrotto

1. fermare il servizio;
2. spostare `$MEMORA_DATA_DIR/index/memora.sqlite*` in un backup;
3. riavviare;
4. eseguire reindex;
5. eseguire `pnpm memory:integrity`.

I Markdown e i metadata restano la fonte autorevole.

### Markdown con metadata invalidi

- il file viene indicizzato senza i metadata invalidi;
- il warning contiene file, riga e codice, mai contenuto;
- `pnpm memory:integrity` esce con errore e riporta gli errori;
- correggere i commenti `memora-memory:v1` e reindexare.

### Disco pieno

1. fermare il servizio;
2. liberare spazio senza cancellare `MEMORA_DATA_DIR`;
3. verificare SQLite con `pnpm memory:integrity`;
4. riavviare e controllare la coda;
5. reindexare se l'indice è incompleto.

Non esiste una cancellazione automatica dei dati per recuperare spazio: usare la
retention esplicita di `docs/MEMORY-LIFECYCLE.md`.

## Verifica periodica

```bash
pnpm memory:integrity
pnpm memory:consolidate -- --min-similarity=0.82
pnpm eval:memory:check
```

`memory:consolidate` e `eval:memory` sono read-only.


## Allegati chat e file progetto

- Gli allegati caricati sono in `$MEMORA_DATA_DIR/chat-attachments/<sessionId>/`
  con permessi `0600`; i metadati sono nel JSONL Pi.
- La directory viene rimossa insieme alla sessione dal delete della UI.
- I file rimasti da upload mai inviati non vengono ancora raccolti
  automaticamente: vanno inclusi nella retention/backup della data directory.
- Il pannello progetto legge solo `$MEMORA_DATA_DIR/projects/<id>/`, rifiuta
  symlink e path traversal, e non esegue HTML o documenti.
- HTML viene mostrato in iframe sandboxed; PDF usa il viewer del browser;
  `.docx` viene convertito in HTML locale con Mammoth.


## Login e reset password

- Il file di autenticazione è `$MEMORA_DATA_DIR/config/auth.json` con permessi
  `0600`; contiene hash, salt e segreto di sessione, non la password.
- Includerlo nei backup cifrati.
- Se il file manca, Memora parte in modalità setup e le API restano bloccate.
- Se il file è corrotto, il servizio non parte: ripristinare un backup oppure
  usare `pnpm memora:set-password`.
- Reset da shell:
  ```bash
  MEMORA_DATA_DIR=/percorso/dati pnpm memora:set-password
  ```
  Riavviare il servizio dopo il reset per ricaricare il file.
- La sessione dura 24 ore. Il logout incrementa la versione di sessione e
  invalida tutti i cookie esistenti.
- HTTP in LAN è supportato per installazioni domestiche; per HTTPS impostare
  `MEMORA_COOKIE_SECURE=true`.

## Contesto chat e artefatti

- Il contesto di retrieval è per sessione (`memora.context`) e non modifica il
  progetto. Le modifiche valgono dal turno successivo.
- Gli artefatti sono file testuali, PDF, DOCX, XLSX o PPTX in
  `$MEMORA_DATA_DIR/artifacts/<sessionId>/` con permessi `0600`; vengono
  rimossi insieme alla sessione. I PPTX generati hanno una preview HTML in
  `.previews/<artifactId>.html`.
- I PDF Markdown sono generati in Node con `pdfkit`; l’HTML usa Chromium
  headless quando disponibile, con fallback a `html-to-pdfmake`/`pdfmake`.
  Limiti: 30.000 caratteri Markdown, 60.000 HTML, 30 pagine, 5 MB. Il PDF non
  viene mai inserito nel contesto del modello.
- Su Debian preparare Chromium con `pnpm pdf:browser:setup`; le librerie vanno
  in `$MEMORA_DATA_DIR/browser-libs/`. Il rendering è serializzato per limitare
  il consumo di RAM.
- HTML/SVG degli artefatti sono sempre serviti con CSP/sandbox.
- La creazione di artefatti non esegue Python né codice arbitrario.
- Dalla lista è possibile scaricare, eliminare (incluse le versioni archiviate)
  o allegare un artefatto al prossimo messaggio della chat. L’anteprima ha
  controlli zoom 50%–250% e il pannello laterale è ridimensionabile.
- Dalla pagina di anteprima un artefatto può essere aggiunto al progetto:
  Markdown/testo diventano fonti indicizzate, gli altri formati sono archiviati
  in `projects/<id>/files/` (non indicizzati). La conferma di eliminazione è una
  modale dedicata. La cancellazione del progetto sposta la directory in
  `.trash/projects/` e richiede la conferma dell’ID.

## Documenti Office

- Limiti iniziali: 20 MB e 50 slide per PPTX; 20 MB e 5 fogli/2.000 righe per
  XLSX; 20 MB per DOCX.
- La preview XLSX legge al massimo 5 fogli, 200 righe e 30 colonne.
- Le formule Excel non vengono ricalcolate dal server; le celle formula sono
  mostrate come testo.
- I DOCX sono convertiti in HTML con Mammoth, con impaginazione documento.
- I PPTX generati usano il deck HTML come preview; i PPTX caricati nei file
  progetto sono solo scaricabili.
- Le anteprime HTML non eseguono JavaScript e non caricano risorse esterne.
- Non installare LibreOffice per queste funzioni: non è richiesto.


## Esportazione PDF

- `POST /api/sessions/:id/artifacts/pdf` genera un artefatto PDF da Markdown.
- Il tool `create_pdf` riceve solo titolo/nome file; il contenuto viene preso
  dalla risposta finale dell'assistente, così non viene duplicato nel tool call.
- Il pulsante PDF sulla risposta usa il testo già prodotto: nessun token LLM
  aggiuntivo.
- Un artefatto HTML può essere convertito in PDF con **Esporta PDF**.
- `pdfkit`/Chromium/PDFMake sono server-side; Chromium è opzionale e ha un
  fallback senza browser.
- L’anteprima PDF usa PDF.js lato client.
