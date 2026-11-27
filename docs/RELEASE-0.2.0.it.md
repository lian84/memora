# Memora v0.2.0

**Data della release:** 27 novembre 2026

Memora 0.2.0 è la prima release che rende Telegram un secondo client completo:
chat private, gruppi forum con Topics, sessioni con progetto e agente,
allegati, condivisione dalla web UI e pannello amministrativo.

## Novità principali

- **DM Telegram bidirezionali** — long polling senza porte pubbliche, pairing
  monouso, allowlist numerica, stesse sessioni Pi della web UI, typing, risposte
  finali, artefatti PDF/Office e read state condiviso.
- **Allegati Telegram in ingresso** — foto, PDF, DOCX, testo e immagini fino a
  15 MB; i formati non supportati vengono rifiutati con una spiegazione.
- **Condivisione web → Telegram** — opt-in per chat, solo risposte o
  conversazione completa, artefatti PDF/Office opzionali e ultimo errore visibile.
- **Gruppi forum privati** — un supergruppo privato con Topics. General è la
  sessione predefinita e ogni topic secondario è una sessione Memora.
- **Progetti e agenti per topic** — `/new *<progetto> [agente] <titolo>` da
  General. Progetto e agente sono opzionali; i topic manuali usano i default del
  gruppo. La scelta viene fissata alla creazione della sessione.
- **Prefisso progetto nei titoli** — `[Progetto]` opzionale, configurabile per
  gruppo, con **Riallinea titoli e icone** esplicito.
- **Icone dei topic e menu comandi** — icona a spunta predefinita per i topic
  secondari, menu comandi nativo Telegram e `/help` / `/commands` contestuali.
- **Pannello amministrativo Gruppi** — progetto/agente predefiniti, valori
  effettivi ereditati, progetto/agente dei topic, toggle prefisso, revoca e
  riallineamento.

## Aggiornamento da 0.1.4

Usa il normale flusso di aggiornamento:

```bash
cd /opt/memora
sudo ./update.sh
```

`update.sh` crea un backup cifrato prima di applicare la release e fa rollback
in caso di errore. Sessioni, memoria, progetti e configurazione esistenti
restano compatibili.

Nuovi file opzionali compaiono in `$MEMORA_DATA_DIR/config/` quando le funzioni
vengono configurate:

- `telegram-groups.json` (`0600`) per gruppi forum e metadata dei topic;
- il già presente `telegram-inbound.json` per binding DM e allowlist.

Per un nuovo gruppo Telegram:

1. crea un supergruppo privato e attiva Topics;
2. aggiungi il bot come amministratore con **Manage Topics**;
3. disattiva la privacy mode di BotFather;
4. genera un codice gruppo in **Amministrazione → Telegram → Ingresso**;
5. invia `/start <codice>` in General;
6. nel pannello del gruppo scegli progetto/agente predefiniti, prefisso e
   riallineamento icone.

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

- Gruppi pubblici, permessi multi-utente e canali pubblici non sono supportati.
- Le sessioni dei gruppi Telegram hanno un solo proprietario; tutti i membri del
  gruppo possono leggere messaggi del bot e titoli dei topic.
- La condivisione web verso i topic forum arriverà in una milestone successiva;
  questa release condivide verso DM private associate.
- Il recupero di topic chiusi/eliminati è limitato.
- I menu comandi Telegram sono per chat/gruppo, non per topic; l’aiuto completo è
  disponibile con `/help` e `/commands`.
