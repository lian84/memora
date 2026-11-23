# Installazione, ripristino e aggiornamento

**Italiano** | [English](INSTALL.md)

Il target production supportato è **Debian 13 + systemd**. Docker non è
necessario.

## VM Debian pulita (Proxmox)

Punto di partenza consigliato per una VM di test:

```text
Debian 13
2 vCPU
3 GB RAM
20 GB disco
HTTPS in uscita abilitato
```

È sufficiente un utente con sudo; l’installer richiede root quando serve.

```bash
sudo apt update
sudo apt install -y git
sudo git clone https://github.com/lian84/memora.git /opt/memora
cd /opt/memora
sudo ./install.sh
```

L’installer chiede se ripristinare un backup o importare un export leggibile.
Per un primo test non scegliere nessuno dei due. Alla fine apri:

```text
http://<ip-vm>:3000
```

e crea la prima password di Memora.

### Repository privata

La repository è attualmente privata. `git clone` via HTTPS fallisce senza
credenziali. Scegli una di queste opzioni.

**Opzione A — repository temporaneamente pubblica**

Rendi pubblica la repository solo per il clone, poi rimettila privata. Funziona,
ma GitHub potrebbe aver già memorizzato o forkato lo stato pubblico: non è una
garanzia di riservatezza. Fallo solo se tutta la cronologia Git è già libera da
segreti e dati personali.

**Opzione B — deploy key read-only (consigliata)**

Sulla VM:

```bash
ssh-keygen -t ed25519 -C memora-vm -f ~/.ssh/memora_deploy
cat ~/.ssh/memora_deploy.pub
```

Aggiungi la chiave pubblica in GitHub → repository → **Settings → Deploy keys**,
senza write access. Poi:

```bash
GIT_SSH_COMMAND='ssh -i ~/.ssh/memora_deploy' \
  git clone git@github.com:lian84/memora.git /opt/memora
cd /opt/memora
sudo ./install.sh
```

La repository resta privata e `update.sh` può scaricare i tag futuri.

**Opzione C — bundle Git locale**

Crea un bundle da un clone esistente e copialo sulla VM:

```bash
git bundle create memora.bundle --all
# copia memora.bundle sulla VM
git clone memora.bundle /opt/memora
cd /opt/memora
git remote add origin git@github.com:lian84/memora.git
sudo ./install.sh
```

Senza remote o deploy key, `update.sh` non può scaricare le release future.

## Installare Memora

Clona la repository nella posizione in cui deve vivere il servizio, poi esegui
l’installer come utente con `sudo`:

```bash
git clone https://github.com/lian84/memora.git
cd memora
sudo ./install.sh
```

L’installer usa questi default:

```text
Codice:       /opt/memora
Servizio:     memora.service
Utente:       memora
Dati:         /var/lib/memora
Config:       /etc/memora/memora.env
Backup:       /var/lib/memora-backups
```

Sono modificabili con `MEMORA_HOME`, `MEMORA_USER`, `MEMORA_DATA_DIR`,
`MEMORA_CONFIG_DIR` e `MEMORA_BACKUP_DIR`.

L’installer:

- verifica o installa Node.js 24;
- installa pnpm e i prerequisiti di sistema;
- crea utente e directory del servizio;
- installa il binario rclone ufficiale con backend Mega;
- compila l’applicazione;
- crea il servizio systemd;
- permette di ripristinare un backup;
- avvia Memora e verifica `/api/health`.

Nessun segreto del checkout sorgente viene copiato. Chiavi provider e token
Telegram/MCP si configurano dopo il primo accesso.

Apri `http://127.0.0.1:3000` e crea la prima password. Per l’accesso remoto usa
HTTPS o un tunnel cifrato; non esporre pubblicamente la porta HTTP.

## Importare un export leggibile

L’installer può anche importare un export `.tar.gz` creato da Memora. Non è un
backup cifrato: contiene dati personali ma nessuna configurazione o segreto.
Usalo solo su una data directory pulita. Dopo l’import completa il primo accesso
e riconfigura provider e integrazioni.

```bash
sudo MEMORA_IMPORT_FILE=/percorso/memora-export-....tar.gz ./install.sh
```

La CLI equivalente è `scripts/import-export.mjs`.

## Ripristino durante l’installazione

L’installer chiede se ripristinare un backup. Servono:

- il file `.mbackup`;
- la password del backup;
- conferma prima di sostituire i dati.

Manifest e checksum vengono verificati prima dell’estrazione. L’eventuale data
directory esistente viene rinominata in:

```text
<data-dir>.restore-backup-<timestamp>
```

Non viene cancellata automaticamente.

### Ripristino di emergenza da CLI

Il ripristino non è disponibile dalla UI attiva.

```bash
sudo systemctl stop memora
MEMORA_BACKUP_PASSWORD='...' \
  node scripts/restore-backup.mjs \
  --file /percorso/memora-backup.mbackup \
  --data-dir /var/lib/memora \
  --yes
sudo systemctl start memora
```

Usa `--force` solo dopo aver verificato che il servizio è fermo. Leggi manifest e
checksum prima del ripristino. Conserva la copia di sicurezza finché l’istanza
ripristinata non è stata verificata.

## Aggiornare Memora

Gli aggiornamenti sono manuali e basati sulle release GitHub pubblicate, non su
ogni push su `main`.

```bash
cd /opt/memora
sudo ./update.sh
```

`update.sh`:

1. ferma Memora;
2. crea un backup locale cifrato con la password configurata;
3. annulla se il backup fallisce;
4. scarica i tag e sceglie l’ultima release `v*`;
5. installa dipendenze, compila ed esegue migrazioni idempotenti;
6. avvia il servizio e verifica `/api/health`;
7. fa rollback al commit precedente se l’aggiornamento fallisce.

Per scegliere un tag specifico:

```bash
MEMORA_UPDATE_TAG=v0.2.0 sudo -E ./update.sh
```

L’avviso di aggiornamento è in **Amministrazione → Sistema → Aggiornamenti**.
Deriva dalle GitHub Releases. Un push su `main` non genera avvisi.

## Requisito backup

La password del backup deve essere già configurata in Memora. Senza password
l’aggiornamento viene annullato invece di procedere senza copia di sicurezza.

Il backup è locale; se l’upload remoto automatico è attivo in Amministrazione,
il backup successivo può caricare l’ultima copia.

## Verifica manuale

```bash
curl -fsS http://127.0.0.1:3000/api/health
systemctl status memora.service
journalctl -u memora.service -n 100
```

## Limiti noti

- L’installer supporta Debian/systemd; non c’è ancora un’immagine Docker.
- Il restore è disponibile in installazione o da CLI di emergenza, non dalla UI
  attiva.
- Gli aggiornamenti usano i tag Git del checkout installato; un archivio sorgente
  senza `.git` non può essere aggiornato da `update.sh`.
- `rclone` viene installato localmente in `$MEMORA_DATA_DIR/tools/` per avere il
  backend Mega anche quando il pacchetto Debian non lo include.
