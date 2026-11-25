# Controllo aggiornamenti

**Italiano** | [English](UPDATES.md)

Memora controlla le **release pubblicate su GitHub**, non ogni push su `main`.
I push di sviluppo restano build di sviluppo e non generano notifiche di
aggiornamento.

## Modello di versione

- `currentVersion` viene da `MEMORA_VERSION` (impostata da installer/release),
  con fallback alla versione applicativa.
- `latestVersion` viene dal tag dell’ultima release GitHub, ad esempio
  `v0.2.0`.
- Un aggiornamento è disponibile solo se il tag è più recente della versione
  installata.

## Workflow di release

`.github/workflows/release.yml` parte quando viene pushato un tag `v*.*.*`:

1. verifica che la versione in `package.json` corrisponda al tag;
2. esegue typecheck, lint, test e build;
3. esegue lo smoke test production;
4. pubblica una GitHub Release con note generate.

Un push su `main` esegue solo la CI: non pubblica release e non crea notifiche
di aggiornamento.

## Configurazione

```bash
MEMORA_UPDATE_REPO=lian84/memora
MEMORA_VERSION=0.1.2
# Opzionali per repository privata o proxy:
MEMORA_UPDATE_CHECK_URL=https://api.github.com/repos/lian84/memora/releases/latest
MEMORA_UPDATE_CHECK_TOKEN=github_read_only_token
```

Il token viene letto solo dall’ambiente, non viene mai restituito dall’API e
deve essere read-only. Quando la repository diventa pubblica non serve alcun
token.

L’endpoint predefinito è:

```text
https://api.github.com/repos/<repo>/releases/latest
```

Il controllo avviene al massimo ogni sei ore. Un controllo manuale è disponibile
in **Amministrazione → Sistema → Aggiornamenti**.

## UI e notifiche

- La sezione Aggiornamenti dentro **Sistema** mostra versione installata, ultima release, note e
  link a GitHub.
- La notifica Telegram è opzionale e viene inviata una volta per tag release al
  primo account Telegram attivo.
- Nessun aggiornamento, download, riavvio o esecuzione di `update.sh` avviene
  dal processo web.

## Repository privata

GitHub restituisce `404` per una release privata senza autenticazione. Memora
mostra “repository privata o nessuna release pubblica” e continua a controllare
in background. Configura un token read-only oppure rendi pubblica la repository.

## Aggiornamento dalla UI

Il pannello Aggiornamenti può richiedere un aggiornamento quando è installato
l’helper systemd. Il processo web non esegue mai `sudo` o comandi shell
arbitrari:

```text
Aggiorna ora
→ scrive $MEMORA_DATA_DIR/update-request
→ memora-update.path avvia memora-update.service come root
→ update.sh crea un backup, sceglie l’ultima release, compila e riavvia
```

Il pulsante crea un backup cifrato obbligatorio prima di applicare la release.
La pagina può disconnettersi durante il riavvio: ricaricala dopo circa un
minuto. L’helper viene installato da `install.sh` e può essere installato su un
sistema esistente con:

```bash
sudo /opt/memora/scripts/install-update-helper.sh
```

Se l’helper non è installato, la UI continua a mostrare le istruzioni manuali
per `update.sh`.

## Aggiornamento

`update.sh` crea un backup locale obbligatorio, applica una release pubblicata,
verifica `/api/health` e fa rollback in caso di errore. Vedi [Installazione,
ripristino e aggiornamento](INSTALL.it.md).
