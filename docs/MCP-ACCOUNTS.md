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

## Project onboarding with a dedicated Notion integration

The recommended workflow for a new project is intentionally explicit:

1. In Notion, create the project's root page or database.
2. Create a **new internal integration** for that project, for example
   `Memora — Progetto Alfa`.
3. Share with that integration only the project page or database it needs.
4. Copy the integration token.
5. In Memora, open **Administration → MCP**, create a Notion account with the
   project name and paste the token. Run **Test connection**.
6. Open the project's settings, select that account in **Project MCP accounts**
   and let the automatic save complete.
7. In a project chat, open the right panel → **MCP**, enable Notion and, if
   needed, **Allow writes**.

The project account is stored centrally with `scope: project`; `project.json`
contains only the account ID. The token is stored in `config/mcp-secrets.json`
with `0600` permissions.

This gives two independent boundaries:

```text
Notion sharing boundary: only the project page/database is visible to the token
Memora binding boundary: only that project uses that account
```

An accidental write by an agent can therefore only affect the content shared
with that project's integration, not the rest of the workspace.
