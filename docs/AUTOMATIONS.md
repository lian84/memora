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

Telegram is an outbound notification channel. It sends the result of scheduled
automations (and manual **Run now**) when the job has **Send result to
Telegram** enabled. It does not create a Telegram chat session or receive
messages yet.

1. Create a bot with BotFather.
2. In Memora open **Automations** from the main sidebar, then the **Telegram** card.
3. Paste the bot token and save it. It is written to
   `config/telegram-secrets.json` with mode `0600` and is never returned by the
   API.
4. Send `/start` to the bot from the Telegram account/chat that should receive
   results.
5. Use **Find chats**, select the chat ID, then save Telegram settings.
6. Use **Send test** to verify.
7. Enable **Send result to Telegram** on the jobs that need it.

The token can also be supplied through `MEMORA_TELEGRAM_BOT_TOKEN`; in that case
the UI shows it as environment-managed and does not allow editing it. The chat
ID remains a non-secret configuration value in `config/telegram.json`.

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
