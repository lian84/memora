# Account MCP

**Italiano** | [English](MCP-ACCOUNTS.md)

Memora parte con un registry centrale per i due server MCP previsti per la prima
integrazione: **Notion** e **Todoist**.

## Registry

Il registry vive nella data directory runtime:

```text
$MEMORA_DATA_DIR/config/mcp-accounts.json
```

Contiene solo metadati e un riferimento al segreto; non contiene mai il token.
I token inseriti dall’interfaccia Admin sono salvati separatamente in
`config/mcp-secrets.json` con permessi `0600`.

```json
{
  "version": 1,
  "accounts": [
    {
      "id": "acc_notion_work",
      "serverId": "notion",
      "scope": "global",
      "label": "Lavoro",
      "secretRef": "env:NOTION_WORK_TOKEN",
      "defaultForServer": true,
      "createdAt": 1795170000000,
      "updatedAt": 1795170000000
    }
  ]
}
```

Per l’uso normale il browser invia il token una volta; il server lo salva sotto
l’ID account in `config/mcp-secrets.json`. I deployment avanzati possono ancora
usare `env:NOME_VARIABILE`.

## Amministrazione

**Amministrazione → MCP** gestisce gli account globali:

- Notion e Todoist;
- un account predefinito per server;
- campo token mascherato;
- token salvato nel secret store locale, mai restituito al browser;
- **Testa connessione** per Notion e Todoist;
- `env:` resta un’opzione avanzata per i deployment.

Gli account dedicati si creano dalle impostazioni del progetto. Restano nel
registry centrale con `scope: "project"` e `projectId`, quindi non finiscono in
`project.json` né nell’export del progetto.

## Binding del progetto

Il progetto salva solo gli ID account:

```json
{
  "mcpAccounts": {
    "notion": "acc_notion_work",
    "todoist": "acc_todoist_team"
  }
}
```

La UI offre account globali e account del progetto. Un valore vuoto significa
“usa il predefinito globale”.

## Stato

Registry account, salvataggio token, test connessione e binding di progetto sono
implementati. Il runtime MCP è attivo: attivando Notion o Todoist nel pannello
destro della chat viene avviato il server MCP locale e i suoi tool vengono
esposti tramite `mcp_call`. Il pannello MCP è disattivato di default e le
modifiche valgono dal messaggio successivo. Un interruttore separato **Consenti
scritture**, spento di default e protetto da una conferma, abilita i tool di
scrittura per quella chat.

## Sicurezza

- i file di progetto contengono solo riferimenti, mai token;
- gli account project-scoped non sono visibili agli altri progetti;
- gli ID eliminati non vengono sostituiti silenziosamente: binding di progetto e
  chat vanno rivisti;
- usare credenziali read-only quando il provider lo consente.
