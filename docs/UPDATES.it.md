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
MEMORA_VERSION=0.1.0
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
in **Amministrazione → Aggiornamenti**.

## UI e notifiche

- Il pannello Aggiornamenti mostra versione installata, ultima release, note e
  link a GitHub.
- La notifica Telegram è opzionale e viene inviata una volta per tag release al
  primo account Telegram attivo.
- Nessun aggiornamento, download, riavvio o esecuzione di `update.sh` avviene
  dal processo web.

## Repository privata

GitHub restituisce `404` per una release privata senza autenticazione. Memora
mostra “repository privata o nessuna release pubblica” e continua a controllare
in background. Configura un token read-only oppure rendi pubblica la repository.

## Aggiornamento

`update.sh` creerà un backup, applicherà una release pubblicata e verificherà il
servizio. Non è implementato in questa milestone.
