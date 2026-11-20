# MCP accounts

**English** | [Italiano](MCP-ACCOUNTS.it.md)

Memora starts with a central registry for the two MCP servers planned for the
first integration: **Notion** and **Todoist**.

## Registry

The registry is stored in the runtime data directory:

```text
$MEMORA_DATA_DIR/config/mcp-accounts.json
```

It contains only account metadata and a reference to a secret; it never stores
the token itself.

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

`secretRef` accepts:

```text
env:VARIABLE_NAME
secret:key-in-the-local-secret-store
```

## Administration

**Administration → MCP** manages global accounts:

- Notion and Todoist;
- one default account per server;
- token reference (`env:` or `secret:`);
- no token is returned to the browser.

Project-specific accounts are created from the project settings. They are
stored in the same central registry with `scope: "project"` and a `projectId`,
so they never enter `project.json` or the exported project.

## Project binding

The project stores only account IDs:

```json
{
  "mcpAccounts": {
    "notion": "acc_notion_work",
    "todoist": "acc_todoist_team"
  }
}
```

The UI offers global accounts and project-specific accounts. An empty value
means “use the global default”.

## Status

The account registry and project bindings are implemented. The MCP runtime
that connects these accounts to the agent, exposes tools and enforces read-only
policies is the next integration milestone. Until then, accounts can be
prepared but no MCP tools are exposed to chats.

## Security

- project files contain references only, never tokens;
- project-scoped accounts are not visible to other projects;
- deleted account IDs are not replaced silently: project and chat bindings must
  be reviewed;
- use read-only credentials where the provider supports them.
