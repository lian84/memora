# Memora v0.2.1

**Data della release:** 28 novembre 2026

Memora 0.2.1 è una patch di affidabilità per la release Telegram 0.2.0. Corregge
la distribuzione degli asset frontend, rende esplicito il ciclo di vita dei topic
forum e impedisce a Telegram di sostituire in silenzio sessioni archiviate o
eliminate.

## Novità principali

- **Asset frontend senza riavvio** — i bundle JavaScript e CSS con hash generati
  da Vite dopo l’avvio del servizio vengono serviti subito. Dopo `pnpm build`
  non serve più riavviare Memora solo per caricare i nuovi asset.
- **Ciclo di vita dei topic forum** — i topic chiusi ed eliminati vengono
  tracciati. Il bot smette di scrivere nei thread non disponibili e invia un solo
  avviso in General quando un topic viene eliminato, mantenendo la sessione
  Memora.
- **I topic eliminati spariscono da `/sessions`** — `/sessions` verifica i topic
  aperti con una chat action transitoria ed esclude quelli eliminati. I topic
  chiusi restano visibili con il loro stato.
- **Riallineamento titoli e icone per topic** — la sincronizzazione riporta un
  risultato per ogni topic, inserisce una pausa tra gli aggiornamenti per
  rispettare i limiti Telegram e salta i topic eliminati. Il pannello
  amministrativo mostra l’esito per singolo topic.
- **Sessioni archiviate ed eliminate rispettate** — Telegram non crea più una
  sessione sostitutiva nascosta. Il bot spiega che la sessione non è disponibile
  e chiede `/new` o un ripristino dalla web UI. Eliminando una sessione, i topic
  collegati e General vengono marcati come non disponibili.

## Aggiornamento da 0.2.0

Usa il normale flusso di aggiornamento:

```bash
cd /opt/memora
sudo ./update.sh
```

`update.sh` crea un backup cifrato prima di applicare la release e fa rollback
in caso di errore. Non serve alcuna migrazione del database.

`config/telegram-groups.json` può acquisire campi opzionali per lo stato dei
topic e per l’eliminazione di General. I file esistenti restano leggibili e
vengono aggiornati solo quando la funzione corrispondente viene usata.

## Comportamento

- Archiviare una sessione dalla web UI blocca i nuovi turni Telegram per quel
  binding. Ripristinando la sessione, la stessa conversazione Telegram torna
  utilizzabile.
- Eliminare una sessione marca come non disponibili i topic Telegram e General
  collegati. Il topic Telegram può restare visibile, ma i messaggi vengono
  rifiutati.
- Un topic eliminato da Telegram resta nel pannello amministrativo come stato
  diagnostico; viene rimosso da `/sessions` e la sua sessione Memora resta nella
  web UI.
- La creazione di una nuova sessione o di un nuovo topic è sempre esplicita con
  `/new`.

## Documentazione

- [Telegram](https://github.com/lian84/memora/blob/main/docs/TELEGRAM.it.md)
- [Installazione e aggiornamento](https://github.com/lian84/memora/blob/main/docs/INSTALL.it.md)
- [Controllo aggiornamenti](https://github.com/lian84/memora/blob/main/docs/UPDATES.it.md)
- [Amministrazione](https://github.com/lian84/memora/blob/main/docs/ADMINISTRATION.it.md)
- [Sicurezza](https://github.com/lian84/memora/blob/main/docs/SECURITY.md)
- [Funzionalità](https://github.com/lian84/memora/blob/main/docs/FEATURES.it.md)
- [Decisioni](https://github.com/lian84/memora/blob/main/docs/DECISIONS.it.md)
- [Processo di release](https://github.com/lian84/memora/blob/main/docs/RELEASING.it.md)

## Verifica

Il workflow di release verifica:

- corrispondenza versione/tag;
- typecheck TypeScript;
- lint;
- suite di test completa;
- build production;
- smoke test production.

## Limiti noti

- La condivisione web verso i topic forum arriverà in una milestone successiva;
  questa release condivide verso DM private associate.
- Un topic Telegram eliminato non viene ricreato automaticamente. La sua sessione
  Memora resta nella web UI e si può creare un nuovo topic con `/new`.
- Lo stato dei topic chiusi/eliminati viene riconciliato quando Telegram invia un
  aggiornamento di ciclo di vita o quando `/sessions` verifica il topic; le
  modifiche avvenute offline possono comparire solo all’interazione successiva.
- I menu comandi Telegram sono per chat/gruppo, non per topic; l’aiuto completo è
  disponibile con `/help` e `/commands`.
- Le sessioni dei gruppi Telegram hanno ancora un solo proprietario.
