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
the token itself. Tokens entered from the Admin UI are stored separately in
`config/mcp-secrets.json` with mode `0600`.

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

For normal use the browser sends the token once; the server stores it under the
account ID in `config/mcp-secrets.json`. Advanced deployments can still use
`env:VARIABLE_NAME`.

## Administration

**Administration → MCP** manages global accounts:

- Notion and Todoist;
- one default account per server;
- masked token field;
- token saved in the local secret store, never returned to the browser;
- **Test connection** for Notion and Todoist;
- `env:` remains an advanced option for deployments.

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

The account registry, token storage, connection test and project bindings are
implemented. The MCP runtime is active: enabling Notion or Todoist in the chat
right panel starts the local MCP server and exposes its tools through
`mcp_call`. The MCP panel is disabled by default and applies changes from the
next message. A separate **Allow writes** switch, off by default and protected by
a confirmation dialog, enables write tools for that chat.

## Least-privilege pattern

Use different Notion integration tokens and share each integration only with the pages or
databases it needs. Bind the dedicated account to the project that should see those
contents. This gives each project a separate access boundary even when the
integrations belong to the same Notion workspace.

## Security

- project files contain references only, never tokens;
- project-scoped accounts are not visible to other projects;
- deleted account IDs are not replaced silently: project and chat bindings must
  be reviewed;
- use read-only credentials where the provider supports them.
