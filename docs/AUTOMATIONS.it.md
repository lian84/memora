# Attività pianificate

**Italiano** | [English](AUTOMATIONS.md)

Memora può eseguire prompt su una pianificazione senza browser aperto. Lo
scheduler fa parte del processo server: funziona finché `memora.service` (o il
processo equivalente) è attivo. Non richiede una sessione web autenticata.

## Dove crearle

La sidebar principale mostra **Nuova chat** (due terzi) e **Nuova automazione**
(un terzo) affiancati. Le automazioni sono oggetti di primo livello: compaiono
nel progetto di appartenenza, accanto alle chat, oppure in **Automazioni senza
progetto** quando non è associato un progetto. Aprendone una si vedono editor,
cronologia e impostazioni Telegram nello spazio principale, senza passare da
Amministrazione.

Se un progetto è selezionato, **Nuova automazione** lo preseleziona; il progetto
può comunque essere cambiato nel form. Il menu del progetto include anche
**Nuova automazione nel progetto**.

## Come funziona una esecuzione

1. Lo scheduler legge l’elenco persistito dei job.
2. Quando `nextRunAt` è scaduto crea una sessione Pi dedicata.
3. La sessione riceve il progetto, il profilo agente e i server MCP del job.
4. Il prompt viene eseguito come un normale messaggio in chat.
5. Il testo finale dell’assistente e lo stato vengono salvati nella cronologia.
6. La sessione temporanea viene rinominata e archiviata, per non sporcare
   l’elenco delle chat attive.
7. Se abilitato per il job, Telegram riceve il risultato.

I job sono in `$MEMORA_DATA_DIR/automations/jobs.json` (permessi `0600`).
La cronologia è un file JSON per esecuzione in
`$MEMORA_DATA_DIR/automations/runs/`. Job e run contengono prompt e risultati:
sono dati utente e devono restare fuori dal repository.

## Formato della pianificazione

L’espressione è un cron standard a cinque campi:

```text
minuto ora giorno-del-mese mese giorno-della-settimana
```

Esempi:

```text
0 9 * * *      ogni giorno alle 09:00
0 18 * * 1-5   feriali alle 18:00
30 8 * * 1     lunedì alle 08:30
0 * * * *      ogni ora
```

Il fuso orario è un nome IANA valido, ad esempio `Europe/Rome` o `UTC`. Il
prossimo run viene calcolato in quel fuso, inclusi i cambi di ora legale. Dopo
un riavvio un job scaduto viene eseguito una volta; le occorrenze perse non
vengono replicate più volte.

## Limiti e comportamento

- Un’automazione alla volta, per proteggere macchine self-hosted piccole.
- Timeout configurabile (default 10 minuti, massimo 120). Allo scadere la
  sessione viene interrotta e la run è marcata `timeout`.
- `maxAttempts` è 1 per default e al massimo 3. I retry servono per errori
  transitori del provider; per le scritture conviene un solo tentativo.
- Una run ancora `running` al riavvio del servizio viene marcata `interrupted`.
- Il servizio deve essere attivo. Il browser chiuso va bene; un server fermo o
  una macchina sospesa no.
- La cronologia viene limitata per job, mantenendo le esecuzioni più recenti.

## MCP

Ogni job può abilitare Notion e/o Todoist. MCP è spento di default. Quando è
attivo, gli account vengono risolti con la precedenza normale:

```text
binding del progetto → account predefinito → primo account del server
```

Le scritture sono disattivate di default e richiedono l’opzione esplicita
**Consenti scritture MCP**. Valgono le regole di privilegio minimo: meglio un
account project-scoped condiviso solo con la pagina/database del progetto.

## Consegna Telegram

Telegram è un canale di notifica in uscita. Gli account si creano una volta in
**Amministrazione → Telegram**, poi qualsiasi numero di automazioni può usarli.

1. Crea un bot con BotFather.
2. In **Amministrazione → Telegram** crea un nuovo account con nome e token del
   bot. Il token viene scritto in `config/telegram-secrets.json` con permessi
   `0600` e non viene mai restituito dall’API.
3. Invia `/start` al bot dall’account/chat Telegram che deve ricevere i
   risultati, poi usa **Cerca chat** per trovare e selezionare il Chat ID.
4. Usa **Invia test** per verificare l’account.
5. In un’automazione abilita **Invia risultato su Telegram** e scegli l’account.
   Lo stesso account può essere scelto da più automazioni.

Se non viene scelto un account, Memora usa il primo account abilitato.
Un’automazione il cui account è disattivato o mancante registra la run ma marca
la consegna Telegram come saltata.

Gli account sono in `config/telegram-accounts.json` (senza token) e i token in
`config/telegram-secrets.json`. I vecchi file `telegram.json` /
`telegram-secrets.json` vengono migrati automaticamente. L’override
`MEMORA_TELEGRAM_BOT_TOKEN` è supportato solo per l’account predefinito legacy.

I messaggi vengono spezzati sotto il limite Telegram di 4096 caratteri. I
risultati possono contenere dati personali: collega solo un bot/chat che
controlli. Un errore di consegna Telegram non cambia lo stato della run: il
risultato resta nella cronologia web e l’errore viene registrato a parte.

## Limiti noti

- Un solo processo server, nessun lock distribuito o coordinamento multi-istanza.
- Nessun bot Telegram in ingresso, comandi slash o elenco sessioni Telegram.
- Nessun editor visuale tipo calendario; la UI offre preset cron e un campo
  cron libero.
- Il modello/provider eredita le impostazioni del progetto/chat, non è scelto
  per singolo job.
