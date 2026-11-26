# Changelog

All notable changes to Memora are documented here.

## [Unreleased]

### Added

- Bidirectional Telegram: long polling inbound channel with one-time pairing,
  numeric user allowlist, shared Memora sessions through `TurnManager`,
  `/new`, `/sessions`, `/switch`, `/current`, `/rename`, `/stop`, typing and
  final replies, PDF/Office artifact delivery and shared read state.
- Telegram inbound attachments: photos, PDF, DOCX, text and images up to 15 MB;
  unsupported formats are rejected. Pollers pause during backups and an
  interrupted pending turn receives one notice after a restart.
- Per-chat Telegram sharing from the web composer: answers-only or full
  conversation, optional PDF/Office artifacts, last-error visibility and shared
  read state; Telegram-originated turns are not duplicated.

## [0.1.4] - 2026-11-25

### Changed

- Removed the manual update instructions from the updates panel; the primary action is the **Update now** button when the systemd helper is installed.
- Localized dynamic backend messages: API errors, monitor alerts and observability warnings.

## [0.1.3] - 2026-11-25

### Fixed

- Completed the Italian, English and French UI audit: remaining hardcoded labels, dialogs, previews, memory views and administration text now use the translation dictionaries.
- The update panel now explains that the button can be used when the systemd helper is installed, while keeping the manual fallback.

## [0.1.2] - 2026-11-23

### Fixed

- The installed version now falls back to `package.json` when `MEMORA_VERSION` is not set, instead of reporting `0.0.0` and showing a false update.

## [0.1.1] - 2026-11-23

### Added

- One-click update request from Administration with a mandatory encrypted backup.
- Privileged systemd path/service helper; the web process never runs sudo or a root shell.

## [0.1.0] - 2026-11-23

### Added

- Self-hosted chat with persistent Pi sessions, background turns and streaming.
- File-first Second Brain with Markdown sources, SQLite FTS5 and optional local embeddings.
- Memory Inbox, Memory Curator and configurable retrieval.
- Projects, project sources, files, artifacts and PDF/Office generation.
- Agent profiles with scoped prompts and lazy-loaded skills.
- MCP accounts and Notion/Todoist read tools, with explicit write opt-in.
- Scheduled automations with local run history, model/web/MCP selection and Telegram delivery.
- Encrypted local backups, Mega/rclone remote upload, restore and readable exports.
- Debian/systemd installer, manual updater with pre-update backup and rollback.
- Monitoring for backups, remote uploads, automations and disk usage.
- Local login, administration UI and IT/EN/FR interface.

### Notes

- Restore, import and update/rollback validation will continue after 0.1.0.
- The application remains single-user and self-hosted by design.

[0.1.0]: https://github.com/lian84/memora/releases/tag/v0.1.0

[0.1.1]: https://github.com/lian84/memora/releases/tag/v0.1.1

[0.1.2]: https://github.com/lian84/memora/releases/tag/v0.1.2

[0.1.3]: https://github.com/lian84/memora/releases/tag/v0.1.3

[0.1.4]: https://github.com/lian84/memora/releases/tag/v0.1.4
