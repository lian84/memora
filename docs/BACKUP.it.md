# Backup e ripristino

**Italiano** | [English](BACKUP.md)

Memora crea snapshot locali cifrati, scaricabili da **Amministrazione →
Backup**. L’archivio contiene dati applicativi e segreti; la password di cifratura viene
scelta dall’utente e non viene salvata nel manifest. L’archivio contiene anche
la configurazione cifrata, quindi la password serve per ripristinarlo.

## Cosa viene incluso

- `config/` (impostazioni, metadati auth, integrazioni e segreti);
- `agents/`;
- `projects/`;
- `memory/`;
- `pi-sessions/`;
- `automations/`;
- `memory-inbox/`;
- `artifacts/`;
- `chat-attachments/`;
- indice SQLite;
- altri piccoli metadati runtime.

Esclusi perché grandi o ricostruibili:

- `models/`;
- `browser-libs/`;
- `searxng/`;
- `runtime/`;
- `.trash/`;
- la directory dei backup stessa.

## Password e cifratura

- L’archivio è cifrato con AES-256-GCM.
- La chiave deriva dalla password con scrypt.
- La password è conservata localmente in `config/backup-secrets.json` con
  permessi `0600` per permettere i backup pianificati. Non viene mai restituita
  dall’API ed è parte della configurazione cifrata dell’archivio.
- In alternativa si può usare `MEMORA_BACKUP_PASSWORD`; in quel caso la UI non
  può modificarla.
- Se la password viene persa, il backup non è ripristinabile.
- Cambiare la password non ricifra i backup vecchi: conserva la password
  precedente.

## Destinazione locale

La directory predefinita è accanto a `MEMORA_DATA_DIR`:

```text
<MEMORA_DATA_DIR>/../memora-backups
```

Può essere sovrascritta con:

```bash
MEMORA_BACKUP_DIR=/percorso/memora-backups
```

La directory viene creata con permessi `0700`; archivi e manifest usano `0600`.

## Freeze durante il backup

Un backup è uno snapshot coerente:

1. Memora entra in manutenzione.
2. Nuovi turni, automazioni e scritture API vengono bloccati.
3. I turni/automazioni attivi possono terminare (fino a due minuti).
4. Viene creato l’archivio.
5. La manutenzione viene rilasciata.

Durante il freeze sono bloccate le letture diverse da health/auth/backup. Non
viene mai creato uno snapshot con attività ancora in corso.

## Backup automatici

Sono opzionali e disattivati di default. Quando attivi:

- frequenza giornaliera o settimanale;
- ora e fuso orario;
- retention: default **4** copie, massimo 20;
- l’archivio usa sempre la procedura di freeze;
- dopo un backup riuscito vengono eliminati gli archivi e i manifest più
  vecchi.

La pianificazione è in `config/backup.json`. Il timer gira dentro il server,
quindi il browser chiuso non è un problema. Il servizio deve essere attivo.

## Download ed eliminazione

Ogni archivio può essere scaricato dalla tabella. I file sono cifrati; per
aprirli serve la password. L’eliminazione è esplicita e richiede conferma nella
UI.

## Ripristino

Il ripristino non è disponibile da un’istanza Memora attiva. Il percorso
previsto è:

- ripristino durante un’installazione pulita;
- restore CLI di emergenza per gli amministratori.

Manifest e checksum vengono verificati prima di sostituire i dati.

## Limiti noti

- Upload remoto con rclone: milestone separata.
- `tar` deve essere disponibile sull’host (pacchetto Debian `tar`).
- Il backup non include i modelli grandi; possono essere scaricati di nuovo.
- Una password conservata localmente per i backup automatici protegge un backup
  rubato, non un host completamente compromesso.
