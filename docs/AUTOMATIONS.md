# Scheduled automations

**English** | [Italiano](AUTOMATIONS.it.md)

Memora can run prompts on a schedule without an open browser. The scheduler is
part of the server process; it works while `memora.service` (or the equivalent
process) is running. It does not require a logged-in web session.

## Where to create them

The main sidebar has **New chat** (two thirds) and **New automation** (one
third) side by side. Automations are first-class objects: they appear under
their project, next to chats, or under **Automations without a project** when
no project is selected. Opening one shows its editor, run history and Telegram
settings in the main workspace, without going through Administration.

When the current project is selected, **New automation** preselects it; the
project can still be changed in the form. The project row menu also has **New
automation in project**.

## How a run works

1. The scheduler reads the persisted job list.
2. When `nextRunAt` is due, it creates a dedicated Pi session.
3. The session receives the job's project, agent profile and MCP servers.
4. The prompt runs exactly like a normal chat message.
5. The final assistant text and status are saved in the run history.
6. The temporary session is renamed and archived, so it does not clutter the
   active chat list.
7. If enabled for the job, Telegram receives the result.

Jobs are stored in `$MEMORA_DATA_DIR/automations/jobs.json` (mode `0600`).
Run history is stored as one JSON file per run under
`$MEMORA_DATA_DIR/automations/runs/`. Jobs and runs contain prompts and results,
so they are user data and must remain outside the repository.

## Schedule format

The schedule is a standard five-field cron expression:

```text
minute hour day-of-month month day-of-week
```

Examples:

```text
0 9 * * *      every day at 09:00
0 18 * * 1-5   weekdays at 18:00
30 8 * * 1     Monday at 08:30
0 * * * *      every hour
```

The timezone is a valid IANA name such as `Europe/Rome` or `UTC`. The next run
is calculated with that timezone, including daylight-saving changes. After a
restart, a due job runs once; missed intervals are not replayed multiple times.

## Limits and behavior

- One automation runs at a time to protect small self-hosted machines.
- A job has a configurable timeout (default 10 minutes, maximum 120). On timeout
  the session is aborted and the run is marked `timeout`.
- `maxAttempts` defaults to 1 and can be at most 3. Retries are intended for
  transient provider failures; writes should normally use one attempt.
- A run that was still `running` when the service restarted is marked
  `interrupted`.
- The service must be running. A closed browser is fine; a stopped server or a
  sleeping machine is not.
- Run history is capped per job; the newest runs are kept.

## Web search

Web search is opt-in per automation. The job form shows the current web
configuration status; when it is enabled, the headless session receives the
same web-search policy as a normal chat. If web search is not configured, the
automation still runs but the tool cannot produce results. Configure it in
**Administration → Web** first.

## MCP

Each job can enable Notion and/or Todoist. MCP is off by default. When enabled,
accounts are resolved with the normal precedence:

```text
project binding → default account → first account for the server
```

Writes are off by default and require the explicit **Allow MCP writes** option.
The usual least-privilege rules apply: use a project-scoped account with only
the project page/database shared with its integration.

## Telegram delivery

Telegram is an outbound notification channel. Accounts are created once in
**Administration → Telegram**, then any number of automations can use them.

1. Create a bot with BotFather.
2. In **Administration → Telegram**, create a new account with a label and the
   bot token. The token is written to `config/telegram-secrets.json` with mode
   `0600` and is never returned by the API.
3. Send `/start` to the bot from the Telegram account/chat that should receive
   results, then use **Find chats** to discover and select its chat ID.
4. Use **Send test** to verify the account.
5. In an automation, enable **Send result to Telegram** and choose the account.
   The same account can be selected by many automations.

If no account is selected, Memora uses the first enabled account. An
automation whose selected account is disabled or missing records the run but
marks Telegram delivery as skipped.

Accounts are stored in `config/telegram-accounts.json` (no token) and tokens in
`config/telegram-secrets.json`. Legacy single-account `telegram.json` /
`telegram-secrets.json` data is migrated automatically. The
`MEMORA_TELEGRAM_BOT_TOKEN` environment override is supported only for the
default legacy account.

Messages are split below Telegram's 4096-character limit. Results may contain
personal data; only connect a bot/chat you control. Telegram delivery failure
does not change the run status — the result stays in the web history and the
error is recorded separately.

## Known limitations

- Single server process, no distributed lock or multi-instance coordination.
- No inbound Telegram bot, slash commands or Telegram session list yet.
- No calendar-style visual editor; the UI provides cron presets and a raw cron
  field.
- The model/provider is inherited from the project/default chat settings, not
  selected per job.
