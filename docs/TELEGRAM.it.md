# Telegram

**Italiano** | [English](TELEGRAM.md)

Telegram è un secondo client di Memora, non un assistente separato. I messaggi in
ingresso usano le stesse sessioni Pi, la stessa memoria e gli stessi progetti
della web UI. Questa pagina copre configurazione, comandi, allegati, sicurezza e
limiti.

Riferimenti: [`FEATURES.it.md`](FEATURES.it.md),
[`ADMINISTRATION.it.md`](ADMINISTRATION.it.md),
[`DECISIONS.it.md`](DECISIONS.it.md) (ADR-068, ADR-070, ADR-071).

## Requisiti

- Un token bot Telegram da [BotFather](https://t.me/BotFather).
- Un account abilitato in **Amministrazione → Telegram**.
- Il bot deve essere raggiungibile dall’utente, ma Memora **non** richiede porte
  pubbliche o webhook: usa long polling in uscita.

Un solo processo Memora può fare polling su un determinato token. Un secondo
processo riceve `409 Conflict`, mostrato nel pannello Telegram senza cancellare
webhook esistenti.

## Configurazione

1. Crea un bot con BotFather e copia il token.
2. In **Amministrazione → Telegram**, crea o modifica l’account, incolla il token
   e salva. Usa **Invia test** per verificare l’invio.
3. Apri **Ingresso** sulla scheda dell’account.
4. Abilita l’ingresso e scegli progetto e profilo agente predefiniti per le nuove
   sessioni. La modalità disponibile è la risposta finale.
5. Genera un codice di pairing. Scade dopo dieci minuti ed è salvato solo come
   hash.
6. Invia `/start <codice>` al bot oppure apri il deep link generato.
7. L’account viene aggiunto alla allowlist numerica; la chat privata diventa la
   chat di notifica dell’account se era vuota.

Per il pairing DM sono accettate solo chat private. Un **supergruppo privato con
Topics** può essere associato separatamente (vedi sotto); canali, gruppi
pubblici, gruppi base senza Topics, bot e utenti non associati vengono ignorati
o ricevono un avviso di autorizzazione.

## Gruppi e forum topic

Il gruppo è opzionale. È una seconda interfaccia sulle stesse sessioni, pensata
per chat lunghe e progetti. Un supergruppo privato con Topics attivi è il
workspace; **General** è la sessione predefinita e ogni topic secondario è una
sessione Memora separata.

Requisiti:

- il gruppo deve essere **privato** (nessun username pubblico);
- nel gruppo devono esserci solo il proprietario e il bot;
- **Topics** deve essere attivo;
- il bot deve essere amministratore con **Manage Topics** /
  `can_manage_topics`;
- la privacy mode di BotFather deve essere **disattivata**, altrimenti il bot non
  riceve i messaggi normali nei topic. Se il bot era già nel gruppo, rimuovilo e
  riaggiungilo dopo la modifica.

Configurazione:

1. Crea il gruppo privato, aggiungi il bot e attiva Topics.
2. Promuovi il bot ad amministratore con Manage Topics.
3. In **Amministrazione → Telegram → Ingresso → Gruppi forum**, genera un
   **codice di associazione gruppo**.
4. Invia `/start <codice>` nel topic **General**. Il codice ha scope `group`:
   autorizza il mittente in quel gruppo, non la DM privata.
5. Il bot verifica che il gruppo sia un forum privato e che possa gestire i
   topic. In caso positivo salva il gruppo in
   `config/telegram-groups.json` (`0600`).

Comandi nel gruppo:

| Comando | Effetto nel gruppo |
|---|---|
| `/start <codice>` | Associa il gruppo da General |
| `/new [titolo]` | Crea un nuovo topic e una sessione (solo General) |
| `/sessions` | Elenca General e i topic del gruppo |
| `/switch N` | Invia il link al topic scelto; il topic resta collegato alla sua sessione |
| `/current` | Mostra la sessione del topic corrente |
| `/rename Titolo` | Rinomina la sessione e il topic corrente |
| `/stop` | Interrompe il turno del topic corrente |
| `/status` | Stato di gruppo, topic e sessione |
| `/ping`, `/help` | Verifica e elenco comandi |

Un topic creato manualmente da Telegram viene collegato a una nuova sessione
quando il bot riceve `forum_topic_created`; se il messaggio di servizio va perso,
il collegamento nasce al primo messaggio. Risposte, typing, documenti e artefatti
usano il `message_thread_id` del topic. Il topic General non usa thread ID.

L’eliminazione di una sessione Memora rimuove il collegamento al gruppo/topic; il
topic Telegram resta. La revoca di un gruppo dal pannello amministrativo ferma il
routing del gruppo ma lascia le sessioni nella web UI.

Tutti i membri del gruppo Telegram possono leggere i messaggi del bot e i titoli
dei topic. Usa un gruppo privato dedicato, con solo proprietario e bot.

## Comandi

| Comando | Effetto |
|---|---|
| `/start` | Verifica l’associazione o completa il pairing con un codice |
| `/new [titolo]` | Crea una nuova sessione; il titolo viene applicato dopo il primo turno |
| `/sessions` | Elenca le sessioni attive recenti, numerate |
| `/switch N` | Passa alla sessione dell’ultimo elenco `/sessions` |
| `/current` | Mostra la sessione attiva e il numero di messaggi |
| `/rename Titolo` | Rinomina la sessione attiva; invia prima un messaggio |
| `/stop` | Interrompe il turno corrente |
| `/status` | Stato canale, poller, allowlist e turno attivo |
| `/ping` | Verifica senza chiamare il modello |
| `/help` | Elenco comandi |

La selezione di `/sessions` scade dopo dieci minuti; esegui di nuovo `/sessions`
se `/switch` chiede un numero valido.

## Sessioni e turni

- Il primo messaggio testuale crea una sessione con i default configurati oppure
  riusa quella associata.
- I turni usano lo stesso `TurnManager` della web UI: un turno attivo per
  sessione, coda, stato SSE e read state condiviso.
- I turni nati da Telegram compaiono nella cronologia e nella sidebar web.
- Una sessione archiviata, cancellata o mancante viene sostituita da una nuova
  sessione con un breve avviso.
- `/stop` interrompe il turno corrente, anche se avviato dalla web UI sulla stessa
  sessione.
- Il bot mostra il typing durante il turno, poi invia la risposta finale. Il
  reasoning nascosto non viene mai inviato.
- Le risposte lunghe sono divise a 4.000 caratteri. Dopo tre blocchi, il testo
  completo viene inviato anche come documento Markdown.
- Gli artefatti PDF, DOCX, XLSX e PPTX creati nel turno vengono inviati come
  documenti.
- Dopo una consegna riuscita il turno è marcato letto, così la web UI non mostra
  un falso non letto.
- Dopo un riavvio, un turno rimasto in sospeso e marcato interrotto riceve un solo
  avviso nella chat Telegram.

## Condivisione di una chat web con Telegram

Una chat web può inviare esplicitamente i propri turni su Telegram. Il controllo
è un pulsante Telegram nel composer, accanto a Web e allegati. È disattivato di
default ed è salvato per sessione sul server, quindi vale su tutti i dispositivi.

- **Destinazione**: una chat Telegram già associata. In questa milestone la
  destinazione è una DM privata; le destinazioni forum/topic arrivano nella
  milestone successiva. Il target viene risolto dal binding/allowlist; chat ID
  arbitrari vengono rifiutati.
- **Solo risposte** (default): viene inviata su Telegram la risposta finale dei
  turni nati dalla web UI. I turni nati da Telegram non vengono duplicati.
- **Conversazione completa**: viene inviato anche il testo scritto nella web UI e
  la chat diventa la sessione attiva Telegram, così le risposte da Telegram
  tornano nella stessa chat. Il testo utente arriva alla fine del turno, insieme
  alla risposta; non è un mirror live carattere per carattere. Gli allegati web
  non vengono copiati.
- È possibile includere gli artefatti PDF/Office creati dal turno.
- Dopo una consegna riuscita il turno è marcato letto nella web UI. Una consegna
  fallita lascia il turno non letto e salva un breve `lastError` visibile nella
  finestra.
- Le consegne sono accodate per sessione; il mirror è incluso nell’idle dei backup
  e nello shutdown graceful.
- L’impostazione vale dal turno successivo. Non è un mirror globale: solo le chat
  con il flag attivo inviano risposte web su Telegram.

Un riavvio tra la fine del turno web e la consegna Telegram può perdere la copia
Telegram; la risposta resta nella sessione web. In questa milestone non c’è
retry/outbox.

## Allegati

Allegati in ingresso supportati:

- foto;
- PDF e DOCX;
- file di testo: Markdown, TXT, CSV, JSON, log e HTML;
- immagini inviate come documento: PNG, JPG, WEBP, GIF e SVG.

Limiti e comportamento:

- massimo 15 MB per file;
- un allegato per messaggio; gli album Telegram vengono elaborati come messaggi
  separati;
- i formati non supportati (per esempio XLSX, PPTX, archivi, vocali, audio, video
  e sticker) vengono rifiutati con una spiegazione;
- i file sono salvati nella stessa area degli allegati web e inclusi nei backup
  cifrati e negli export leggibili;
- gli allegati sono input non fidato: estrazione testo e input immagine, mai
  esecuzione.

## Sicurezza e dati

- I codici di pairing sono monouso, hashati, scadono dopo dieci minuti e hanno un
  limite di tentativi per utente Telegram.
- L’accesso usa ID utente Telegram numerici, mai gli username.
- Lo stato del bridge è in `config/telegram-inbound.json` con permessi `0600`.
  Contiene allowlist, binding delle sessioni, offset e impostazioni, ma nessun
  testo dei messaggi e nessun token.
- I token restano nel secret store esistente. Non vengono restituiti dall’API né
  scritti nei log.
- Il bot non può modificare impostazioni, allowlist o stato amministrativo. Il
  modello non può invocare Telegram.
- I messaggi transitano e sono conservati sui server Telegram. Il canale non è
  cifrato end-to-end da Memora.
- Telegram conserva gli update per un periodo limitato; i messaggi inviati mentre
  Memora è offline oltre quella finestra vanno persi.
- Messaggi e allegati in ingresso seguono la stessa politica anti prompt-injection
  del contenuto web. Non possono cambiare tool, ruoli o permessi.
- I backup cifrati includono lo stato del bridge; gli export leggibili escludono
  `config/`.
- Durante i backup i poller sono in pausa e il bridge è incluso nel controllo di
  idle, così nessuna nuova scrittura Telegram parte durante lo snapshot.

## Operazioni e problemi

**Stato Disabilitato** — account o ingresso disabilitati, oppure token mancante.
Abilita l’account e poi l’ingresso.

**Stato Errore / Non autorizzato** — controlla il token; il poller si ferma sugli
errori di autenticazione e riparte quando l’account viene salvato di nuovo.

**Stato Conflitto webhook** — un altro processo o un webhook sta consumando
`getUpdates`. Ferma l’altro consumatore; Memora non cancella webhook
automaticamente.

**Il bot non risponde** — controlla che l’account sia attivo, l’ingresso abilitato,
l’utente autorizzato e lo stato In esecuzione. Invia `/ping`.

**Il pairing fallisce** — il codice può essere scaduto o già usato. Generane uno
nuovo. I tentativi errati sono limitati per utente.

**Nessun messaggio dopo un riavvio** — binding e offset persistono; invia `/ping`.
Se il turno precedente era in corso, il bot invia un avviso di interruzione nella
DM o nel topic.

**Il pairing del gruppo fallisce** — verifica che il gruppo sia un forum privato,
che il bot sia amministratore con Manage Topics, che la privacy mode sia
disattivata e che il codice sia stato inviato in General. Il bot riporta il
controllo fallito in General.

**Allegato rifiutato** — controlla il limite di 15 MB e i formati supportati.
Vocali, video, sticker, XLSX e PPTX non sono accettati in ingresso; gli artefatti
PDF/Office vengono comunque consegnati in uscita.

## Limiti noti

- I gruppi sono limitati a un forum privato con proprietario e bot; niente
  gruppi pubblici o permessi multi-utente.
- Un topic chiuso o eliminato mantiene il suo binding nel registry finché la
  sessione non viene eliminata o il gruppo non viene revocato; il recupero dei
  topic obsoleti è limitato.
- Nessun raggruppamento degli album Telegram; ogni elemento è un messaggio
  separato.
- Le foto richiedono un modello che accetti input immagine.
- Nessuna trascrizione vocale.
- Nessuna modifica progressiva dei messaggi; la risposta è finale.
- Nessuna modalità webhook; solo long polling.
- Nessun mirroring globale: la condivisione è opt-in per chat; la modalità
  completa invia il testo utente ma non gli allegati web.
- Condivisione single-user: ogni utente Telegram autorizzato accede alle stesse
  sessioni e alla stessa memoria. Autorizza solo i tuoi dispositivi.
