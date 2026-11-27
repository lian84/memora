# Memora v0.2.0

**Release date:** 2026-11-27

Memora 0.2.0 is the first release that makes Telegram a complete second client:
private chats, forum groups with Topics, project- and agent-aware sessions,
attachments, sharing from the web UI and an administration panel.

## Highlights

- **Bidirectional Telegram DMs** — long polling without public ports, one-time
  pairing, numeric allowlist, the same Pi sessions as the web UI, typing, final
  replies, PDF/Office artifacts and shared read state.
- **Telegram attachments inbound** — photos, PDF, DOCX, text and images up to
  15 MB; unsupported formats are rejected with an explanation.
- **Web → Telegram sharing** — opt-in per chat, answers-only or full
  conversation, optional PDF/Office artifacts and visible last error.
- **Private forum groups** — one private supergroup with Topics. General is the
  default session and every secondary topic is a Memora session.
- **Per-topic projects and agents** — `/new *<project> [agent] <title>` from
  General. Project and agent are optional; manual topics use group defaults.
  The selection is fixed at session creation.
- **Project title prefixes** — optional `[Project]` prefix, configurable per
  group, with explicit **Sync titles and icons**.
- **Topic icons and command menu** — a default checkmark icon for secondary
  topics, a native Telegram group command menu and contextual
  `/help` / `/commands`.
- **Admin group panel** — default project/agent, effective inherited values,
  topic project/agent labels, prefix toggle, revocation and synchronization.

## Upgrade from 0.1.4

Use the normal update flow:

```bash
cd /opt/memora
sudo ./update.sh
```

`update.sh` creates an encrypted backup before applying the release and rolls
back on failure. Existing sessions, memory, projects and configuration remain
compatible.

New optional files appear under `$MEMORA_DATA_DIR/config/` when features are
configured:

- `telegram-groups.json` (`0600`) for forum groups and topic metadata;
- the existing `telegram-inbound.json` for DM bindings and allowlists.

For a new Telegram group:

1. create a private supergroup and enable Topics;
2. add the bot as administrator with **Manage Topics**;
3. disable BotFather privacy mode;
4. generate a group pairing code in **Administration → Telegram → Inbound**;
5. send `/start <code>` in General;
6. in the group panel choose the default project/agent, prefix and icon sync.

## Documentation

- [Telegram](https://github.com/lian84/memora/blob/main/docs/TELEGRAM.md)
- [Installation and update](https://github.com/lian84/memora/blob/main/docs/INSTALL.md)
- [Update checks](https://github.com/lian84/memora/blob/main/docs/UPDATES.md)
- [Administration](https://github.com/lian84/memora/blob/main/docs/ADMINISTRATION.md)
- [Security](https://github.com/lian84/memora/blob/main/docs/SECURITY.md)
- [Features](https://github.com/lian84/memora/blob/main/docs/FEATURES.md)
- [Decisions](https://github.com/lian84/memora/blob/main/docs/DECISIONS.md)
- [Release process](https://github.com/lian84/memora/blob/main/docs/RELEASING.md)

## Verification

Release workflow verifies:

- version matches the tag;
- TypeScript typecheck;
- lint;
- full test suite;
- production build;
- production smoke test.

## Known limitations

- Public groups, multi-user permissions and public channels are not supported.
- Telegram group sessions use one owner; everyone in the group can read bot
  messages and topic titles.
- Web sharing to forum topics is planned for a later milestone; this release
  shares to paired private DMs.
- Closed/deleted topic recovery is limited.
- Telegram command menus are per chat/group, not per topic; full context-aware
  help is available through `/help` and `/commands`.
