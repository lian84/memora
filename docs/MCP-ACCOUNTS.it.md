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

`secretRef` accetta:

```text
env:NOME_VARIABILE
secret:chiave-nel-secret-store-locale
```

## Amministrazione

**Amministrazione → MCP** gestisce gli account globali:

- Notion e Todoist;
- un account predefinito per server;
- riferimento token (`env:` o `secret:`);
- nessun token viene restituito al browser.

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

Registry account e binding di progetto sono implementati. Il runtime MCP che
collega questi account all’agente, espone i tool e applica le policy read-only è
la prossima milestone. Fino ad allora gli account si possono preparare, ma
nessun tool MCP viene esposto alle chat.

## Sicurezza

- i file di progetto contengono solo riferimenti, mai token;
- gli account project-scoped non sono visibili agli altri progetti;
- gli ID eliminati non vengono sostituiti silenziosamente: binding di progetto e
  chat vanno rivisti;
- usare credenziali read-only quando il provider lo consente.
