# Memoria

Retrieval, Curator e modello di memoria file-first. Vedi anche [Modello dati](MEMORY-DATA-MODEL.md), [Ciclo di vita](MEMORY-LIFECYCLE.md), [Qualità del retrieval](MEMORY-RETRIEVAL-QUALITY.md) e [Sicurezza della memoria](MEMORY-SECURITY.md).

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

### Profili agente

Prima del primo messaggio il composer mostra i **profili agente** disponibili
(15 esempi tra cui Brainstorming, Commercialista, Sviluppatore e Social media).
Un profilo aggiunge un prompt circoscritto e competenze caricate on demand; non aggiunge tool o
permessi. Se non ne viene scelto nessuno si usa Memo base. Dopo l’invio il
selettore sparisce e l’icona del profilo resta accanto ai controlli allegati e
web; la stessa icona compare accanto alla chat nella sidebar. Le chat esistenti
possono applicare esplicitamente il profilo corrente con **Aggiorna profilo**. I profili sono file-based in `$MEMORA_DATA_DIR/agents` e si gestiscono da
**Amministrazione → Agenti**; vedi
[`docs/AGENT-PROFILES.it.md`](docs/AGENT-PROFILES.it.md).

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
