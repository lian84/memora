# Telegram

**English** | [Italiano](TELEGRAM.it.md)

Telegram is a second client of Memora, not a separate assistant. Inbound
messages run in the same Pi sessions, memory and projects used by the web UI.
This document covers setup, commands, attachments, security and limitations.

Related: [`FEATURES.md`](FEATURES.md), [`ADMINISTRATION.md`](ADMINISTRATION.md),
[`DECISIONS.md`](DECISIONS.md) (ADR-068).

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

Only private chats are accepted. Groups, channels, bots and messages from
unpaired users are ignored or receive an authorization notice.

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
- A session archived, deleted or missing from disk is replaced by a new session
  with a short notice.
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

## Sharing a web chat with Telegram

A web chat can explicitly push its turns to Telegram. The control is a Telegram
button in the composer, next to Web and attachments. It is off by default and is
saved per session on the server, so it is shared across devices.

- **Destination**: an existing paired Telegram chat. The target is resolved from
  the binding/allowlist; arbitrary chat IDs are rejected.
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
- The bridge state is stored in `config/telegram-inbound.json` with mode `0600`.
  It contains allowlist entries, session bindings, the update offset and settings,
  but no message text and no bot tokens.
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
If the previous turn was running, the bot sends one interrupted notice.

**Attachment rejected** — check the 15 MB limit and supported formats. Voice,
video, stickers, XLSX and PPTX are not accepted inbound; PDF/Office artifacts are
still delivered outbound.

## Known limitations

- No groups or forum topics; private chats only.
- No Telegram albums coalescing; each album item is a separate message.
- Photos require a model that accepts image input.
- No voice transcription.
- No progressive message editing; replies are final after the turn.
- No webhook mode; long polling only.
- No global mirroring: sharing is opt-in per chat; full mode sends user text
  but not web attachments.
- Single-user sharing: every authorized Telegram user can access the same
  sessions and memory. Authorize only your own devices.
