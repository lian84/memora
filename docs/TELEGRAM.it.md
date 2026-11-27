# Telegram

**Italiano** | [English](TELEGRAM.md)

Telegram è un secondo client di Memora, non un assistente separato. I messaggi in
ingresso usano le stesse sessioni Pi, la stessa memoria e gli stessi progetti
della web UI. Questa pagina copre configurazione, comandi, allegati, sicurezza e
limiti.

Riferimenti: [`FEATURES.it.md`](FEATURES.it.md),
[`ADMINISTRATION.it.md`](ADMINISTRATION.it.md),
[`DECISIONS.it.md`](DECISIONS.it.md) (ADR-068, ADR-070, ADR-071, ADR-072, ADR-073, ADR-074, ADR-075, ADR-076).

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

### Progetti e agenti nel gruppo

Il **progetto è un metadata del topic/sessione**, non il titolo. Il prefisso nel
titolo è solo una scelta di visualizzazione.

- Il gruppo ha un **progetto predefinito** usato da General e dai nuovi topic. Se
  il default del gruppo non è impostato, viene usato il default dell’account
  inbound.
- `/new *<id-progetto> [agente] <titolo>` crea un topic in un altro progetto
  e/o con un altro profilo agente. Progetto e agente sono entrambi opzionali.
- I topic creati manualmente usano progetto e agente predefiniti del gruppo.
- Ogni topic salva `projectId` e `agentProfileId` risolti; cambiare un default
  del gruppo in seguito vale solo per i nuovi topic e per General se non è ancora
  stata creata. I topic creati prima di questi metadata vengono recuperati dai
  metadata della sessione all’avvio, quando possibile.
- Progetto e profilo agente non si possono cambiare su una sessione già
  esistente: crea un nuovo topic/sessione. Cambiare il default del gruppo non
  migra General né le sessioni dei topic esistenti.
- Usa un gruppo per progetto per una separazione visiva forte, oppure un solo
  gruppo con default e override per un’unica interfaccia Telegram.

L’opzione **Mostra il progetto nei titoli dei topic** è per gruppo. È attiva di
default per i gruppi appena associati e disattiva per i gruppi salvati prima
che esistesse questa opzione:

- `[Lavoro] Preventivo` se attiva;
- `Preventivo` se disattiva.

Il prefisso vale per i nuovi topic secondari e per `/rename`. Quando il prefisso
è attivo, un `[etichetta]` iniziale è considerato presentazione gestita e viene
rimosso dal titolo base salvato. Non viene mai applicato a General. Dopo aver cambiato l’opzione usa **Riallinea titoli e icone** nel
pannello del gruppo per aggiornare i topic esistenti. L’ID progetto resta la
fonte di verità; il titolo è solo presentazione. Se rinomini un progetto serve un
riallineamento dei titoli.

`/agents` elenca ID e nomi dei profili agente. La parte opzionale `[agente]` di
`/new` accetta l’ID o il nome del profilo (case-insensitive, spazi ammessi).

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
6. Dopo l’associazione, nel pannello del gruppo scegli progetto e profilo agente
   predefiniti e se mostrare il progetto nei titoli. I topic esistenti mantengono
   il loro progetto.

Comandi nel gruppo:

| Comando | Effetto nel gruppo |
|---|---|
| `/start <codice>` | Associa il gruppo da General |
| `/projects` | Elenca ID e nomi dei progetti attivi |
| `/agents` | Elenca ID e nomi dei profili agente |
| `/new *[id-progetto] [agente] [titolo]` | Crea un topic/sessione con progetto e agente opzionali (solo General) |
| `/sessions` | Elenca General e i topic del gruppo con il progetto |
| `/switch N` | Invia il link al topic scelto; il topic resta collegato alla sua sessione |
| `/current` | Mostra la sessione del topic corrente |
| `/rename Titolo` | Rinomina la sessione e il topic corrente |
| `/stop` | Interrompe il turno del topic corrente |
| `/status` | Stato di gruppo, topic e sessione |
| `/help`, `/commands` | Aiuto contestuale per General o il topic corrente |
| `/ping` | Verifica il bot |

Il bot registra un **menu comandi nativo Telegram** tramite `setMyCommands` con
scope `all_group_chats`. I menu Telegram sono per chat, non per topic: tutti i
topic di un gruppo vedono la stessa lista breve. Il menu include `/agents` e la
forma di `/new` con progetto/agente opzionali. `/help` e `/commands` sono
contestuali: riportano topic, progetto e sessione correnti e ricordano che
`/new` è disponibile solo da General.

Un topic creato manualmente da Telegram viene collegato a una nuova sessione
quando il bot riceve `forum_topic_created`, usando il progetto predefinito del
gruppo; se il messaggio di servizio va perso, il collegamento nasce al primo
messaggio. Per scegliere un altro progetto e/o agente usa `/new *<id-progetto> [agente]
<titolo>` da General. Il progetto è preceduto da `*`; il nome agente opzionale è
tra parentesi quadre, quindi può contenere spazi. Esempi: `/new *casa
Preventivo`, `/new [Sviluppatore] Preventivo`, `/new *casa [Sviluppatore]
Preventivo`. Risposte, typing, documenti e artefatti usano il `message_thread_id` del
topic. Il topic General non usa thread ID e non ha prefisso progetto.

L’eliminazione di una sessione Memora rimuove il collegamento al gruppo/topic; il
topic Telegram resta. La revoca di un gruppo dal pannello amministrativo ferma il
routing del gruppo ma lascia le sessioni nella web UI. Il progetto predefinito
del gruppo si può cambiare dal pannello; vale per General solo se non è ancora
stata creata e per i nuovi topic. I topic esistenti mantengono il progetto
salvato.

Un topic chiuso mantiene la sessione Memora e mostra `chiuso` in `/sessions` e nel
pannello amministrativo. La riapertura azzera lo stato. Se Telegram segnala che il
thread non esiste più, il topic viene marcato `eliminato`, il bot smette di
scrivere lì e invia un solo avviso in General; la sessione Memora resta e puoi
creare un nuovo topic con `/new`. Titoli e icone vengono riallineati un topic alla
volta con una pausa per rate limit e un risultato per singolo topic.

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
- Progetto e agente vengono fissati alla creazione della sessione e non possono
  essere spostati. Il prefisso nel titolo è solo presentazione e si può
  riallineare.
- Un topic chiuso resta nel registry e mantiene la sessione; un topic eliminato
  viene marcato e richiede un nuovo topic per i nuovi messaggi Telegram.
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
