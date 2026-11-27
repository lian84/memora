# Amministrazione

Impostazioni runtime, autenticazione e lingua dell’interfaccia.

L’icona **Impostazioni** nella sidebar permette di modificare le opzioni runtime
senza editare manualmente i file. La configurazione è salvata in
`$MEMORA_DATA_DIR/config/settings.json` con scrittura atomica, JSON leggibile,
schema versionato e mode `0600`. Il file contiene solo override e viene creato
al primo salvataggio; le installazioni esistenti continuano a funzionare con
default + environment senza migrazioni automatiche.

Precedenza: default applicativi → `settings.json` → environment. I campi
provenienti dall'ambiente sono marcati “Gestito dall'ambiente” e non modificabili
dalla UI. Le API sono centralizzate sotto `/api/admin/*`:

```text
GET   /api/admin/settings
PATCH /api/admin/settings
GET   /api/admin/status
```

La sezione **Chat** permette di scegliere OpenRouter o OpenCode Go, salvare la
chiave nel secret store locale, testare la connessione, cercare e selezionare un
modello dal catalogo reale. Il nuovo default vale per le nuove sessioni; le
sessioni esistenti non vengono modificate. Da questa sezione si possono anche
abilitare o disabilitare i titoli automatici delle nuove chat; il fallback
locale resta sempre disponibile. La sezione **Memory Curator** sceglie
provider e modello separati e riutilizza la stessa chiave del provider, senza
chiederne una seconda. Il catalogo OpenRouter usa il catalogo Pi; OpenCode Go usa
l'endpoint remoto con cache di 10 minuti e fallback al catalogo Pi.

Retrieval mode, topK/maxChars, soglie Curator, reasoning, provider/modello Curator,
default Chat e titoli automatici si applicano a caldo; embeddings e abilitazione/disabilitazione del
Curator richiedono un riavvio esplicito. La UI
mostra “Riavvio Memora necessario” e non esegue mai `systemctl` o comandi sudo.
I preset Lite e Standard mostrano le modifiche prima dell'applicazione. Lite è
pensato per VPS con 1–2 GB RAM; Standard per host da almeno 4 GB RAM.

Le API amministrative sono protette dalla login single-user. Le chiavi sono
salvate solo in `$MEMORA_DATA_DIR/config/secrets.json` (mode `0600`, scrittura
atomica) oppure lette dall'environment; `GET` restituisce soltanto stato e
provenienza, mai il valore. La configurazione è adatta a systemd, Docker futuro,
VPS, Proxmox, mini PC e installazioni locali, senza path hardcoded oltre
`MEMORA_DATA_DIR`.

## Telegram in ingresso

**Amministrazione → Telegram** può abilitare un canale in ingresso opt-in per
ogni account bot. Usa il long polling: Memora apre solo connessioni in uscita
verso Telegram, quindi non servono porte pubbliche, webhook o certificati TLS.

- Il pairing usa un codice monouso con scadenza di dieci minuti e un deep link al
  bot; il codice viene salvato solo come hash.
- L’accesso è controllato da ID utente Telegram numerici, mai dagli username.
  Sono supportate DM private e supergruppi privati con forum; gruppi pubblici e
  gruppi base senza Topics vengono rifiutati.
- Il poller possiede `getUpdates`; la scoperta delle chat legge la cache osservata
  quando l’ingresso è attivo.
- I messaggi diventano turni normali nelle stesse sessioni Memora della web UI,
  quindi cronologia, memoria, progetti e profili agente sono condivisi. Comandi:
  `/new`, `/sessions`, `/switch`, `/current`, `/rename`, `/stop`, `/status`,
  `/ping`, `/help`.
- Il bot invia l’indicatore di digitazione durante il turno, la risposta finale e
  gli eventuali artefatti PDF/Office creati. Segna il turno come letto dopo una
  consegna riuscita.
- Una chat web può attivare la consegna Telegram dal composer. Il target è una
  chat già associata; il default è solo risposte, la conversazione completa rende
  quella chat la sessione attiva Telegram e i turni nati da Telegram non vengono
  mai duplicati.
- I gruppi si associano con un codice separato `group` inviato in General. Il bot
  deve essere amministratore con Manage Topics; il gruppo deve essere un forum
  privato. General è la sessione predefinita, ogni topic è una sessione e `/new`
  crea un topic solo da General; `/help` e `/commands` spiegano i comandi
  contestuali, mentre il menu nativo Telegram mostra descrizioni brevi. Il
  pannello del gruppo imposta progetto e
  profilo agente predefiniti e il prefisso progetto opzionale; `/new *<id-progetto> [agente]
  <titolo>` può usare progetto e agente diversi per topic. **Riallinea
  titoli e icone** aggiorna i titoli esistenti e applica l’icona a spunta dopo un
  cambio di prefisso. Il pannello
  elenca gruppi, topic, General, i progetti e gli utenti autorizzati del gruppo.
- Lo stato è in `config/telegram-inbound.json` e `config/telegram-groups.json`
  con permessi `0600`. Non contengono token né testo dei messaggi; i backup
  cifrati li includono, gli export leggibili escludono `config/`.
- Un secondo processo che fa polling sullo stesso token riceve `409 Conflict`; il
  pannello mostra il conflitto senza cancellare webhook esistenti.

## Login e accesso

Al primo avvio, se non esiste `$MEMORA_DATA_DIR/config/auth.json`, Memora entra
in modalità setup: le API applicative restano bloccate finché non viene scelta
la prima password. Non esiste un nome utente: Memora è personale e single-user.
La prima password impostata vince, quindi completa il setup subito dopo
l'installazione.

- password minima: 12 caratteri;
- hash `scrypt` con salt casuale;
- nessuna password in chiaro;
- cookie `memora_session`, `HttpOnly`, `SameSite=Lax`;
- sessione di 24 ore;
- logout che invalida tutte le sessioni;
- tutte le `/api/*` protette tranne `/api/health`, login, setup e stato auth;
- rate limit sugli accessi falliti;
- nessun token API nella v0.1.

Per il reset della password, dalla macchina che ospita Memora:

```bash
MEMORA_DATA_DIR=/percorso/dati pnpm memora:set-password
```

Il comando chiede la nuova password in modo nascosto e sostituisce
`config/auth.json`. Riavvia Memora dopo il reset. Se il servizio è raggiungibile via HTTP sulla LAN, il cookie
non ha il flag `Secure`; impostare `MEMORA_COOKIE_SECURE=true` solo quando
l'accesso avviene tramite HTTPS. Tailscale cifra il trasporto, ma il login resta
necessario.

## Lingue dell’interfaccia

La UI supporta:

```text
Italiano
English
Français
```

La lingua viene rilevata dal browser, salvata in `localStorage` con la chiave
`memora-language` e può essere cambiata dal selettore in
**Amministrazione → Aspetto**. Il fallback è l’inglese.

Il dizionario è in `apps/web/src/i18n/`: `it` è la lingua sorgente, mentre
`en.ts` e `fr.ts` contengono le traduzioni. Per aggiungere una lingua si copia
un dizionario e si registra il codice in `SUPPORTED_LANGUAGES`.

La lingua della UI non forza la lingua di Memo: l’assistente risponde nella
lingua del messaggio dell’utente.
