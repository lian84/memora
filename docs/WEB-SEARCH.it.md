# Ricerca web

Configurazione e limiti di sicurezza della ricerca web opzionale.

L’accesso web è **disattivato per default**. Si configura da
**Amministrazione → Web** scegliendo Brave Search o SearXNG; la chiave Brave
resta in `$MEMORA_DATA_DIR/config/web.json` con permessi `0600` e non viene mai
restituita dall’API.

Nella chat il pulsante **Web**, accanto agli allegati, abilita la ricerca per
quella sessione. Le fonti consultate compaiono nella scheda **Fonti** del
pannello laterale destro, insieme a File (solo nei progetti), Contesto e
Artefatti. Il pannello è chiuso per default; su desktop si apre automaticamente
sulla scheda pertinente quando arriva una nuova ricerca o viene creato un
artefatto.

Sono supportiti:

- ricerca di pagine;
- lettura del testo HTML con Readability;
- estrazione testo da PDF;
- fonti numerate con citazioni `[n]` nel testo, cliccabili verso la fonte;
- blocco di URL privati/locali, redirect limitati, timeout e limiti di
  dimensione.

Il contenuto web è trattato come **dato non fidato**: non viene mai eseguito e
non può modificare istruzioni, permessi o strumenti. `web_fetch` non usa
JavaScript, cookie o sessioni.

Ogni fonte riceve un numero stabile, mostrato come `[1]`, `[2]` nella scheda
Fonti. Memo deve inserire il riferimento subito dopo ogni informazione ricavata
dal web; se una frase usa più fonti può scrivere `[1][3]`. I riferimenti nella
risposta sono cliccabili e aprono la fonte corrispondente. Passando il mouse o
il focus su un riferimento compaiono sito, titolo e una breve descrizione. I
numeri non vengono riutilizzati quando la cronologia supera le 50 fonti.

Nella scheda Fonti:

- **Ricerca** indica un risultato del motore di ricerca, con titolo e snippet,
  ma la pagina non è ancora stata letta;
- **Letta** indica una pagina effettivamente recuperata e letta da Memo;
- **PDF** indica un PDF letto e convertito in testo.
