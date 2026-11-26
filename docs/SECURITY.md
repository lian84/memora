# Security baseline

Memora contiene dati personali e può invocare tool di filesystem/shell.

## Regole iniziali
- VM dedicata;
- processo non root;
- niente Internet pubblico;
- SSH tunnel/Tailscale;
- segreti in environment/file 600;
- nessuna extension Pi di terze parti non revisionata;
- log senza segreti;
- directory dati dedicate (`MEMORA_DATA_DIR`);
- documenti non fidati trattati come input potenzialmente ostile;
- nessun segreto nel repository pubblico;
- nessun dato personale nel repository pubblico;
- `.env` mai committato (solo `.env.example`);
- backup cifrati se contengono dati personali.

## Ricerca web

- Web disattivato per default e abilitato per singola chat.
- Provider Brave/SearXNG configurabile dall’amministrazione.
- `web_fetch` accetta solo HTTP/HTTPS pubblici; blocca loopback, IP privati,
  link-local e metadata cloud.
- Redirect limitati, timeout, limite byte e caratteri.
- HTML estratto con Readability, PDF solo testo; niente JavaScript, cookie o
  login.
- Il contenuto web è dato non fidato: non viene eseguito e non può cambiare
  ruolo, policy, permessi o strumenti.
- Le fonti sono persistite nella sessione e mostrate nel pannello Web.
- I log non contengono query, URL completi o contenuto delle pagine.

## Telegram in ingresso

- Accesso solo per ID utente numerici in allowlist; nessun auto-pairing.
- Codice di pairing monouso, hashato, con TTL di dieci minuti e limite di
  tentativi per utente.
- Solo chat private; gruppi, canali, bot e utenti non autorizzati non entrano
  nelle sessioni.
- Long polling senza porte pubbliche; un solo processo può consumare un token.
  Un conflitto `409` non cancella webhook esistenti.
- Token nel secret store; nessun token o testo dei messaggi in
  `config/telegram-inbound.json`, nei log o nelle risposte API.
- Allegati in ingresso trattati come non fidati: limite 15 MB, estensioni
  supportate, nessuna esecuzione, estrazione testo/immagine soltanto.
- Il contenuto Telegram non può cambiare tool, ruoli, permessi o impostazioni.
  Il bot non espone comandi amministrativi.
- Telegram conserva i messaggi sui propri server; il canale non è cifrato
  end-to-end da Memora.
- Backup cifrati inclusivi dello stato del bridge; export leggibili senza
  `config/`.
- Poller sospesi durante i backup e fermati prima dello shutdown; i turni
  interrotti ricevono un solo avviso dopo il riavvio.
- Condivisione web → Telegram solo opt-in per chat; il target è validato
  contro binding/allowlist, non è un chat ID arbitrario. La modalità completa
  cambia la sessione attiva Telegram ed è indicata nella UI.

## Memoria e provider esterni

Il confine di fiducia tra conversazione, memoria, Curator e provider è descritto
in dettaglio in [`MEMORY-SECURITY.md`](MEMORY-SECURITY.md). Retention,
cancellazione, backup e rischi delle memorie conservate a lungo sono in
[`MEMORY-LIFECYCLE.md`](MEMORY-LIFECYCLE.md).

In sintesi:
- la memoria recuperata è dato non fidato, mai istruzione;
- il prompt la isola in JSON con delimitatori neutralizzati;
- i segreti bloccano l'analisi e le PII ad alta confidenza vengono rimosse prima del Curator cloud;
- l'output del Curator viene validato e resta soggetto ad approvazione umana;
- i log contengono solo metadata, mai contenuti;
- nomi, indirizzi e altre PII non riconoscibili possono ancora essere inviati
  al provider scelto.

## Autenticazione Web

- L’accesso è single-user, senza username e senza registrazione.
- La password è memorizzata come hash `scrypt` con salt in
  `$MEMORA_DATA_DIR/config/auth.json` (0600).
- La sessione usa un cookie `HttpOnly`, `SameSite=Lax`, con scadenza di 24 ore.
- Il logout e il reset password invalidano le sessioni esistenti.
- Tutte le API sono protette, eccetto health, login, setup e stato auth.
- La prima password può essere impostata da chi raggiunge la pagina di setup:
  completare il setup immediatamente dopo l’installazione.
- Su HTTP in LAN il cookie non ha il flag `Secure`; usare HTTPS per proteggere
  password e sessione in transito. Tailscale cifra il trasporto.
- Le API amministrative restano comunque da non esporre su Internet senza
  reverse proxy e HTTPS.
