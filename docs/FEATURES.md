# Memora Features

**English** | [Italiano](FEATURES.it.md)

This is the single functional registry for the project. It describes what is
implemented, the expected behavior and the known limitations. The README links
here; architectural decisions are in [`DECISIONS.md`](DECISIONS.md).

Last updated: 2026-11-20.

## 1. Chat and sessions

- [x] React web UI served by Fastify.
- [x] Persistent sessions in Pi JSONL format.
- [x] SSE turn streaming with a “Memo is responding…” state.
- [x] Markdown rendering with tables, lists, code and safe `<br>` line breaks.
- [x] Collapsible reasoning panel for models that expose thinking: live preview, expandable full thought and history from the Pi transcript.
- [x] Stop response, edit a user message and regenerate.
- [x] Resume, rename, archive, restore and delete chats; archived project chats stay in the project and are shown only when the project enables archived sessions.
- [x] Session title and history.
- [x] Per-message attachments: at most 8 files, 15 MB each.
- [x] Image preview and inclusion of image attachments in the turn.
- [x] Per-chat context: global memory, project memory and project sources.
- [x] File-based agent profiles selectable before the first message; 15 defaults, 10-color palette and colored profile icons in the composer and sidebar. Profiles add a scoped prompt and lazy-loaded skills without changing tools or memory policy. Existing chats can explicitly refresh the current profile; icon/name/color updates are live.
- [x] Explicit **Refresh profile** in an existing chat: applies the current prompt/skills from the next message; display metadata is always live.
- [x] Administration → Agents: create, edit and soft-delete profiles; manage skills, icon and color.
- [x] Administration → MCP: global and project-scoped Notion/Todoist accounts, masked token entry stored in the local secret store, test connection and project bindings.
- [x] MCP runtime: per-chat server toggles in the right panel, default off, project/global account resolution and `mcp_call` tools for Notion/Todoist. Writes require the explicit **Allow writes** confirmation.
- [x] Least-privilege Notion/Todoist access: separate integration tokens can be used for different accounts, and each Notion integration is shared only with selected pages or databases, so a project can be limited to the content and account it needs.
- [x] Model, provider and reasoning level configurable per chat.
- [x] Export an answer to PDF.
- [x] Extract memories from an answer with explicit review.
- [x] Automatic chat titles from the first request/response exchange: immediate
  local fallback plus asynchronous LLM title.
- [x] Turns continue server-side when the chat is not open or the browser is
  closed.
- [x] Concurrent turns configurable in Administration (1–4, default 2) with an
  explicit queue; one active response per session.
- [x] Sidebar indicators: yellow for a response running in another chat, green
  for a completed unread response.
- [x] Reconnecting SSE client: EventSource with `after` replay and partial text
  recovery on reload or chat switch.
- [x] Synthetic turn state persisted in `$MEMORA_DATA_DIR/config/turns.json`;
  active turns become `interrupted` after a restart.
- [x] Cleanup of superseded completed turns and a red indicator for
  errors/interruptions.
- [x] Queued message visible immediately and after reload; its text is not
  persisted in `turns.json`.
- [x] Shared read state across devices in `config/turn-reads.json`.
- [x] Opt-in browser notifications when a response is ready (tab must remain
  open). Telegram is used only for scheduled automation results and works with
  the browser closed.
- [x] End-to-end HTTP tests with two SSE clients and replay after reconnection.
- [x] Manual rename always wins over automatic title generation.
- [x] Administration → Automations: cron/timezone jobs, project and agent profile selection, optional MCP servers and explicit MCP writes.
- [x] Headless scheduler with timeout, limited retries, run history and **Run now**; changing the schedule does not require a browser.
- [x] Optional Telegram delivery of automation results, with chat discovery, test message and a token kept in the local secret store.
- [x] Jobs and run history stored under `$MEMORA_DATA_DIR/automations/`.

## 2. Memory and Second Brain

- [x] Markdown as the authoritative source; SQLite as a rebuildable index.
- [x] FTS5 full-text search.
- [x] Local embeddings with Transformers.js and semantic/hybrid search through
  sqlite-vec.
- [x] RRF fusion of lexical and semantic rankings.
- [x] Global memory and per-project memory.
- [x] Memory Inbox with human approval.
- [x] Optional Memory Curator for proposing atomic facts.
- [x] Optional automatic saving for new high-confidence memories; updates, conflicts, duplicates and PII remain under manual review.
- [x] Memory proposals also generated from assistant answers.
- [x] Deduplication, relevance, privacy checks and secret blocking.
- [x] Read-only consolidation, evaluation and threshold feedback.
- [x] Second Brain page with search, global/project filter and direct Markdown
  editing.
- [x] Display of the memory sources used in a turn.

## 3. Projects

- [x] Projects with `project.json`, `memory.md`, `sources/` and `files/`.
- [x] Custom sidebar sections with name, icon and order.
- [x] Projects assignable to a section and movable between sections.
- [x] Selectable icons for sections and projects.
- [x] Create, configure, switch and delete with typed confirmation.
- [x] `sources/` indexed; `files/` archive not indexed.
- [x] Project files with Markdown, text, HTML, PDF, image, DOCX and XLSX
  previews.
- [x] Attach a project file to a message.
- [x] Import an artifact into a project as a source or file.
- [x] Project trash (`.trash/projects/`).

## 4. Artifacts

- [x] Per-chat artifacts: Markdown, text, HTML, SVG, JSON, CSV and code.
- [x] PDF through headless Chromium with pdfmake fallback.
- [x] DOCX, XLSX and PPTX generation without LibreOffice.
- [x] Artifact versioning and version previews.
- [x] PDF preview, sandboxed HTML, DOCX through Mammoth and XLSX in a React
  table.
- [x] HTML-first PPTX: the same HTML deck produces both the preview and the
  PowerPoint file.
- [x] 50–250% zoom and resizable panels.
- [x] Download, delete, attach to chat and import into a project.
- [x] Download cards inside the assistant response, linked to the source message.
- [x] Manual visual review of PDF/HTML/PPTX with a vision-capable model and versioned output.
- [x] PDF preview isolated from other PDF.js consumers; HTML PDFs avoid splitting cards and text across A4 pages.
- [x] Limits for size, slide count, rows and columns.

## 5. Web search

- [x] Web access disabled by default.
- [x] Brave Search or SearXNG provider configurable in Administration.
- [x] Per-chat enablement with the Web button.
- [x] `web_search` and `web_fetch` tools.
- [x] HTML extraction with Readability and text extraction from PDFs.
- [x] Sources persisted in the session, numbered stably and shown in the Sources
  tab.
- [x] Clickable numeric citations `[n]` for every piece of information.
- [x] Citation tooltip with site, title and a short description.
- [x] The Sources tab distinguishes **Search** (unread search result), **Read**
  (page fetched and read) and **PDF**.
- [x] Numbers are not reused when history exceeds the source limit.
- [x] SSRF blocking, private/metadata URLs, credentials in URLs and excessive
  redirects.
- [x] Web content treated as untrusted data.
- [ ] Native SearXNG installer with a `--web=...` option (next milestone).
- [ ] Optional Docker/SearXNG (explicit choice only).

## 6. Chat side panel

- [x] Tree sidebar: expandable sections, projects and nested sessions.
- [x] Open/closed state of sections and projects persisted in the browser.
- [x] Row actions (rename, archive/restore, delete) in a three-dot contextual
  menu visible only on hover/focus.
- [x] Local chat pinning, sorted to the top of each group.
- [x] Dedicated hover contrast for sections, projects and chats in light and dark
  themes.
- [x] Single right-side panel, collapsed by default.
- [x] Fixed areas at the top: **Files**, **Context**, **Artifacts**, **Sources**.
- [x] **Files** only for project chats.
- [x] **Context** shows only the options valid for the current chat.
- [x] **Sources** contains web sources; project sources remain under Context.
- [x] Counters for Artifacts and Sources.
- [x] Auto-open Sources after a search and Artifacts after artifact creation.
- [x] Auto-open only on desktop (> 900 px); on mobile the panel stays closed.
- [x] In-turn updates from `tool_execution_end` events.
- [x] Safety refresh at turn end and manual refresh per area.
- [x] Direct opening of the newly created artifact.
- [x] Resizable, persisted width; expand/reduce.
- [x] Tabs reachable from the keyboard with arrows, Home and End.

## 7. Appearance, language and accessibility

- [x] Light, dark or system theme.
- [x] Text size, density, conversation width and reduced motion.
- [x] Collapsible sidebar via button or `Ctrl+B`.
- [x] Italian / English / French interface.
- [x] UI language separate from the language used by Memo's answer.
- [x] Visible focus, accessible dialogs, `aria-*` for tabs and panels.
- [x] HTML/SVG previews always sandboxed and without JavaScript.
- [x] Light/dark agent logos, favicon, Apple/PWA icons and agent avatar.

## 8. Administration and security

- [x] Single-user password login with a 24-hour session.
- [x] First-password setup and CLI-only reset.
- [x] `HttpOnly` cookie, `SameSite=Lax`, rate limiting and `Origin` checks.
- [x] Secrets in environment or `config/secrets.json` with mode `0600`.
- [x] Web configuration in `config/web.json` with mode `0600`.
- [x] No API key returned by the API.
- [x] Chat provider/model, Curator, automatic approval, embeddings, retrieval, web,
  automatic titles, turn concurrency, browser notifications and appearance configurable.
- [x] Explicit restart required for changes that are not applied live.
- [x] No `sudo` or `systemctl` executed by the web process.

## 9. Runtime and operations

- [x] pnpm monorepo with TypeScript strict mode.
- [x] `MEMORA_DATA_DIR` for all runtime data.
- [x] Production build with Fastify serving the SPA.
- [x] Example systemd service.
- [x] Build and production smoke tests.
- [x] Scripts for embeddings, memory evaluation, integrity, consolidation,
  project migration and password reset.
- [ ] Complete `install.sh` and `update.sh`.
- [x] GitHub Actions CI; `v0.1.0` release still pending.
- [x] AGPL-3.0-only license, NOTICE, TRADEMARKS and CONTRIBUTING with DCO.

## Notes

- Memory and web content are untrusted data: they cannot change instructions,
  permissions or tools.
- SQLite is always rebuildable from Markdown; it is not the only copy.
- Real data must never be committed to the repository.
