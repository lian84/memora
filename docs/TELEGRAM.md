# Telegram

**English** | [Italiano](TELEGRAM.it.md)

Telegram is a second client of Memora, not a separate assistant. Inbound
messages run in the same Pi sessions, memory and projects used by the web UI.
This document covers setup, commands, attachments, security and limitations.

Related: [`FEATURES.md`](FEATURES.md), [`ADMINISTRATION.md`](ADMINISTRATION.md),
[`DECISIONS.md`](DECISIONS.md) (ADR-068, ADR-070, ADR-071, ADR-072, ADR-073, ADR-074, ADR-075, ADR-076, ADR-077).

## Requirements

- A Telegram bot token from [BotFather](https://t.me/BotFather).
- A Memora account enabled in **Administration → Telegram**.
- The bot must be reachable by the user, but Memora does **not** need a public
  port or a webhook: it uses outbound long polling.

Only one Memora process may poll a given bot token. A second process receives
`409 Conflict`, shown in the Telegram panel without deleting an existing
webhook.

## Setup

1. Create a bot with BotFather and copy its token.
2. In **Administration → Telegram**, create or edit the account, paste the token
   and save. Use **Send test** to verify outbound delivery.
3. Open **Inbound** on the account card.
4. Enable **Inbound** and choose the default project and agent profile for new
   sessions. The final reply mode is the only mode currently available.
5. Generate a pairing code. The code expires after ten minutes and is stored only
   as a hash.
6. Send `/start <code>` to the bot, or open the generated deep link.
7. The account is added to the numeric allowlist; the private chat becomes the
   account notification chat if it was empty.

Only private chats are accepted for DM pairing. A private **supergroup with
Topics** can be paired separately (see below); channels, public groups, basic
groups without Topics, bots and unpaired users are ignored or receive an
authorization notice.

## Groups and forum topics

A group is optional. It is a second interface over the same sessions, intended
for long-running chats and projects. One private supergroup with Topics enabled
is the workspace; **General** is the default session and each secondary topic is
a separate Memora session.

### Projects and agents in a group

The **project is metadata of the topic/session**, not the topic name. The title
prefix is only a display option.

- A group has a **default project** used by General and by new topics. If the
  group default is unset, the inbound account default is used.
- `/new *<project-id> [agent] <title>` creates a topic in another project
  and/or with another agent profile. Both project and agent are optional.
- Manual topics use the group default project and agent.
- Each topic stores its resolved `projectId` and `agentProfileId`; changing a
  group default later affects only new topics and General sessions that do not
  exist yet. Topics created before this metadata existed are backfilled from their
  session metadata on startup when possible.
- A project or agent profile cannot be changed on a session that already exists.
  Create a new topic/session instead. Changing the group default does not migrate
  existing General or topic sessions.
- Use one group per project if you want strong visual separation; use one group
  with a default and overrides if you want a single Telegram workspace.

The **Show project in topic titles** option is per group. It is enabled by default
for newly paired groups and disabled for groups saved before this option existed:

- `[Lavoro] Preventivo` when enabled;
- `Preventivo` when disabled.

The prefix applies to new secondary topics and to `/rename`. When the prefix is
enabled, a leading `[label]` is treated as managed presentation and is stripped
from the stored base title. It is never applied to General. Use **Sync titles
and icons** in the group panel to update existing topics after changing the
option. The project ID remains the source of truth; the title is only
presentation. Project renames therefore require a title sync.

`/agents` lists the agent profile IDs and names. The optional `[agent]` part of
`/new` accepts either the ID or the profile name (case-insensitive, spaces
allowed).

Secondary topics also receive a default checkmark icon when Telegram exposes one
through `getForumTopicIconStickers`. The icon is applied to newly created and
manually created topics, on `/rename`, and by **Sync titles and icons**. General
keeps its native icon. If Telegram does not provide the checkmark icon, the
default icon remains.

Requirements:

- the group must be **private** (no public username);
- only the owner and the bot should be members;
- **Topics** must be enabled;
- the bot must be an administrator with **Manage Topics** / `can_manage_topics`;
- BotFather privacy mode must be **disabled** so the bot receives normal
  messages in topics. If the bot was already in the group, remove and re-add it
  after changing privacy mode.

Setup:

1. Create the private group, add the bot and enable Topics.
2. Promote the bot to administrator with Manage Topics.
3. In **Administration → Telegram → Inbound → Forum groups**, generate a
   **group pairing code**.
4. Send `/start <code>` in the **General** topic. The code has scope `group`: it
   authorizes the sender in that group, not the private DM.
5. The bot verifies that the group is a private forum and that it can manage
   topics. On success, the group is saved in
   `config/telegram-groups.json` (`0600`).
6. After pairing, open the group panel and choose the default project/agent
   profile and whether to show the project in topic titles. Existing topics
   keep their project.

Group commands:

| Command | Effect in a group |
|---|---|
| `/start <code>` | Pair the group from General |
| `/projects` | List active project IDs and names |
| `/agents` | List agent profile IDs and names |
| `/new *[project-id] [agent] [title]` | Create a new topic/session with optional project and agent (General only) |
| `/sessions` | List General and the group topics, with their projects |
| `/switch N` | Send the link to the selected topic; a topic stays bound to its session |
| `/current` | Show the session of the current topic |
| `/rename Title` | Rename the session and the current topic |
| `/stop` | Abort the current topic's turn |
| `/status` | Group, topic and session status |
| `/help`, `/commands` | Contextual help for General or the current topic |
| `/ping` | Health check |

The bot registers a **native Telegram group command menu** through
`setMyCommands` with the `all_group_chats` scope. Telegram menus are per chat,
not per topic: every topic in a group sees the same short command list. The
menu includes `/agents` and the optional-project/agent form of `/new`.
`/help` and `/commands` are contextual: they report the current topic, project
and session, and remind that `/new` is available only from General.

A topic created manually from Telegram is bound to a new session when the bot
receives `forum_topic_created`, using the group default project; if the service
message is missed, the binding is created lazily on the first message. Use
`/new *<project-id> [agent] <title>` from General to choose another project
and/or agent explicitly. The project token starts with `*`; the optional agent
name is in square brackets, so names with spaces are accepted. Examples:
`/new *casa Preventivo`, `/new [Sviluppatore] Preventivo`,
`/new *casa [Sviluppatore] Preventivo`.
Replies, typing, documents and artifacts use the topic's `message_thread_id`.
The General topic uses no thread ID and no project prefix.

Deleting a Memora session removes its group/topic binding; the Telegram topic
remains. Removing a group from the admin panel stops group routing but leaves
the sessions in the web UI. A group default project can be changed in the group
panel; it affects General only if General has not been created yet, and new
topics. Existing topics keep their stored project.

A closed topic keeps its Memora session and shows `closed` in `/sessions` and
the admin panel. Reopening it clears the state. If Telegram reports that a thread
no longer exists, the topic is marked `deleted`, the bot stops writing there and
sends one notice in General; the Memora session remains and you can create a new
topic with `/new`. Titles and icons are synchronized one topic at a time with a
rate-limit pause and a per-topic result.

Everyone in the Telegram group can read the bot messages and topic titles. Use a
dedicated private group with only the owner and the bot.

## Commands

| Command | Effect |
|---|---|
| `/start` | Verify the association or complete pairing with a code |
| `/new [title]` | Create a new session; the title is applied after the first turn |
| `/sessions` | List recent active sessions, numbered |
| `/switch N` | Switch to the session from the last `/sessions` list |
| `/current` | Show the active session and message count |
| `/rename Title` | Rename the active session; send a message first |
| `/stop` | Abort the current turn |
| `/status` | Channel, poller, allowlist and active turn status |
| `/ping` | Health check that does not call the model |
| `/help` | Command list |

The `/sessions` selection expires after ten minutes; run `/sessions` again if
`/switch` asks for a valid number.

## Sessions and turns

- The first textual message creates a session with the configured defaults, or
  reuses the paired session.
- Turns use the same `TurnManager` as the web UI: one active turn per session,
  queueing, SSE state and shared read state.
- Telegram-originated turns appear in the web session history and sidebar.
- A session archived, deleted or missing from disk is not silently replaced. The
  bot explains that the session is unavailable and asks for `/new` or a restore
  from the web UI. In a group topic this means creating a new topic from General;
  General itself must be restored if its session is archived.
- `/stop` interrupts the current turn, including a turn started by the web UI on
  the same session.
- The bot shows a typing indicator while the turn runs, then sends the final
  answer. Hidden reasoning is never sent.
- Long answers are split at 4,000 characters. After three chunks, the full answer
  is also sent as a Markdown document.
- PDF, DOCX, XLSX and PPTX artifacts created during the turn are sent as
  documents.
- After a successful delivery the turn is marked read, so the web UI does not
  show a false unread response.
- After a restart, a pending turn marked as interrupted receives one notice in
  the Telegram chat.
- `/sessions` probes open topics with a transient chat action; deleted topics
  are marked and removed from the Telegram list, while their Memora session stays
  in the web UI.

## Sharing a web chat with Telegram

A web chat can explicitly push its turns to Telegram. The control is a Telegram
button in the composer, next to Web and attachments. It is off by default and is
saved per session on the server, so it is shared across devices.

- **Destination**: an existing paired Telegram chat. In this milestone the
  destination is a private DM; forum-topic destinations arrive in the next
  milestone. The target is resolved from the binding/allowlist; arbitrary chat
  IDs are rejected.
- **Answers only** (default): the final answer of web-originated turns is sent
  to Telegram. Telegram-originated turns are not duplicated.
- **Full conversation**: the user text written in the web UI is also sent, and
  the chat becomes the active Telegram session so replies from Telegram return
  to the same chat. The user text is delivered when the turn completes, together
  with the answer; it is not a live per-keystroke mirror. Web attachments are not
  copied.
- PDF/Office artifacts created by the turn can be included.
- After successful delivery the turn is marked read in the web UI. A failed
  delivery leaves the turn unread and stores a short `lastError` visible in the
  dialog.
- Deliveries are queued per session; the mirror is included in backup idle and
  graceful shutdown.
- The setting applies from the next turn. It is not a global mirror: only chats
  with the flag enabled send web answers to Telegram.

A restart between the end of a web turn and the Telegram delivery can lose the
Telegram copy; the answer remains in the web session. No retry/outbox is provided
in this milestone.

## Attachments

Supported inbound attachments:

- photos;
- PDF and DOCX;
- text files: Markdown, TXT, CSV, JSON, log and HTML;
- images sent as documents: PNG, JPG, WEBP, GIF and SVG.

Limits and behavior:

- maximum 15 MB per file;
- one attachment per message; Telegram albums are processed as separate
  messages;
- unsupported formats (for example XLSX, PPTX, archives, voice, audio, video and
  stickers) are rejected with a short explanation;
- files are stored in the same chat attachment area as web uploads and included
  in encrypted backups and readable exports;
- attachments are untrusted input: text extraction and image input only, never
  execution.

## Security and data

- Pairing codes are one-time, hashed, expire after ten minutes and are rate
  limited per Telegram user.
- Access uses numeric Telegram user IDs, never usernames.
- The DM bridge state is stored in `config/telegram-inbound.json` with mode
  `0600`. It contains allowlist entries, session bindings, the update offset and
  settings, but no message text and no bot tokens. Groups and topic bindings are
  in `config/telegram-groups.json` with the same permissions.
- Tokens stay in the existing secret store. They are never returned by the API or
  written to logs.
- The bot cannot change settings, allowlists or administrative state. The model
  cannot call Telegram.
- Telegram messages transit through and are retained by Telegram servers. The
  channel is not end-to-end encrypted by Memora.
- Telegram retains updates for a limited period; messages sent while Memora is
  offline longer than that window are lost.
- Inbound attachments and messages are subject to the same prompt-injection
  policy as web content. They cannot change tools, roles or permissions.
- Encrypted backups include the bridge state; readable exports exclude `config/`.
- During backups the pollers are paused and the bridge is included in the idle
  check, so no new Telegram write starts while a snapshot is taken.

## Operations and troubleshooting

**Status is Disabled** — the account or inbound channel is disabled, or the token
is missing. Enable the account, then inbound.

**Status is Error / Unauthorized** — check the token; the poller stops on
authentication errors and restarts when the account is saved again.

**Status is Conflict** — another process or a webhook is consuming `getUpdates`.
Stop the other consumer; Memora does not delete webhooks automatically.

**The bot does not answer** — check that the account is active, inbound is
enabled, the user is authorized, and the status is Running. Send `/ping`.

**Pairing fails** — the code may have expired or been used. Generate a new code.
Wrong attempts are limited per user.

**No messages after a restart** — the binding and offset persist; send `/ping`.
If the previous turn was running, the bot sends one interrupted notice in the
DM or topic.

**Group pairing fails** — check that the group is a private forum, the bot is an
administrator with Manage Topics, privacy mode is disabled and the code was sent
in General. The bot reports the failed check in General.

**Attachment rejected** — check the 15 MB limit and supported formats. Voice,
video, stickers, XLSX and PPTX are not accepted inbound; PDF/Office artifacts are
still delivered outbound.

## Known limitations

- Groups are limited to a private forum with one owner and the bot; no public
  groups or multi-user permissions.
- Project and agent selection are fixed when the session is created; they cannot
  be moved to another project/profile. The title prefix is presentation only and
  can be resynced.
- Closed topics remain in the registry and keep their session; deleted topics
  are marked and require a new topic for new Telegram messages.
- No Telegram albums coalescing; each album item is a separate message.
- Photos require a model that accepts image input.
- No voice transcription.
- No progressive message editing; replies are final after the turn.
- No webhook mode; long polling only.
- No global mirroring: sharing is opt-in per chat; full mode sends user text
  but not web attachments.
- Single-user sharing: every authorized Telegram user can access the same
  sessions and memory. Authorize only your own devices.
