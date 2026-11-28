# Memora v0.2.1

**Release date:** 2026-11-28

Memora 0.2.1 is a reliability patch for the 0.2.0 Telegram release. It fixes
frontend asset serving, makes forum-topic lifecycle handling explicit and stops
Telegram from silently replacing archived or deleted sessions.

## Highlights

- **Frontend assets without a restart** — Vite hashed JavaScript and CSS bundles
  created after the service started are served immediately. A `pnpm build` no
  longer requires restarting Memora just to load new assets.
- **Forum-topic lifecycle** — closed and deleted topics are tracked. The bot
  stops writing to unavailable threads and sends one notice in General when a
  topic is deleted, while keeping the Memora session.
- **Deleted topics leave `/sessions`** — `/sessions` probes open topics with a
  transient chat action and excludes deleted topics. Closed topics remain
  visible with their state.
- **Per-topic title and icon sync** — synchronization reports a result for each
  topic, pauses between updates to respect Telegram limits and skips deleted
  topics. The administration panel shows the per-topic outcome.
- **Archived and deleted sessions are respected** — Telegram no longer creates a
  hidden replacement session. The bot explains that the session is unavailable
  and asks for `/new` or a web UI restore. Deleting a session marks its bound
  topics and General as unavailable.

## Upgrade from 0.2.0

Use the normal update flow:

```bash
cd /opt/memora
sudo ./update.sh
```

`update.sh` creates an encrypted backup before applying the release and rolls
back on failure. No database migration is required.

`config/telegram-groups.json` may gain optional fields for topic state and the
General deletion flag. Existing files remain readable and are updated only when
the corresponding feature is used.

## Behaviour notes

- Archiving a session in the web UI blocks new Telegram turns for that binding.
  Restoring the session re-enables the same Telegram conversation.
- Deleting a session marks bound Telegram topics/General as unavailable. The
  Telegram topic may remain visible, but messages are refused.
- A topic deleted in Telegram is kept in the administration panel as diagnostic
  state; it is removed from `/sessions` and its Memora session remains in the
  web UI.
- Creating a new session or topic is always explicit with `/new`.

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

- Web sharing to forum topics is planned for a later milestone; this release
  shares to paired private DMs.
- A deleted Telegram topic is not recreated automatically. Its Memora session
  remains available in the web UI and a new topic can be created with `/new`.
- Closed/deleted topic state is reconciled when Telegram sends a lifecycle
  update or when `/sessions` probes the topic; offline changes may take until
  the next interaction to appear.
- Telegram command menus are per chat/group, not per topic; full context-aware
  help is available through `/help` and `/commands`.
- Telegram group sessions still use one owner.
