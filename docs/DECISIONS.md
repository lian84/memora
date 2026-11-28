# Architecture Decision Log

**English** | [Italiano](DECISIONS.it.md)

Format:

## ADR-000 — Title
**Date:** YYYY-MM-DD
**Status:** proposed | accepted | superseded

### Context
### Decision
### Consequences

---
## ADR-005.5d — UPDATE as the canonical final state
**Status:** accepted

An UPDATE cannot be a delta: approval replaces a bullet, so the Curator receives
the existing bullets and returns a self-contained final state. The intent is
`augment`, `replace`, `remove` or `correct`. For AUGMENT, the backend verifies
that informative tokens from the previous memory survive and rejects incomplete
proposals; for other intents, removal is allowed only because the user declared
it. Proposals that are not self-contained or lack the project entity are
rejected. Validation is conservative and token-based; it does not understand
perfect semantic equivalence. The provider response may be flat or contain a
single object in `memories`; multiple memories are rejected because the MVP flow
produces one candidate per turn.

---
## ADR-005.5c — Curator outside the SSE path and safe diagnostics
**Status:** accepted

With the Curator enabled, turns are placed in a limited, volatile serial queue
started after the SSE response is sent. Queue errors are observable without
content; graceful shutdown waits for completion before closing SQLite. Crashes or
forced restarts may lose pending turns; no broker or history-replicating
persistence is introduced. The Inbox rechecks the candidate store every three
seconds.

Structured logs distinguish stages without recording prompts or answers. In a
real test Nemotron consumed 700 reasoning tokens and returned null content; the
provider now requires `reasoning.enabled=false`. A model may ignore or not
support this option: truncation and timeout cases remain explicit in logs.
Confidence and salience thresholds are now separate (defaults 0.75 and 0.70):
confidence is unchanged, while a salience of 0.74 for a relevant update had been
discarded by the shared 0.75 threshold. These are initial configurable
parameters, not calibrated thresholds.

---
## ADR-005.5b — Opt-in LLM Curator with human review
**Status:** proposed — awaiting end-to-end testing with a real provider

A replaceable provider analyses only the latest user turn, a short window of
previous user messages and up to five relevant chunks. The real provider uses a
single call to the configured provider (OpenRouter or OpenCode Go), separate from
chat and disabled by default; this choice sends data to the provider and is
documented. A lightweight prefilter skips trivial turns. Secret checks are
heuristic.

The JSON response is validated; routing is decided by the backend. Salience is
the uncalibrated average of five scores; confidence and salience below their
thresholds exclude an automatic candidate. High-confidence duplicates are
skipped. UPDATE requires an exact match with a related bullet and revalidation at
approval time; otherwise it becomes a conflict. Candidates still require human
approval. Provider errors do not block chat, and explicit requests fall back to
the previous Writer.

---
## ADR-005.5a — Bullet granularity in structured memory
**Status:** accepted

To make independent facts searchable, sections composed exclusively of at least
two standalone one-line bullets under `memory/` and `projects/` are indexed one
bullet per chunk, with heading and line range. Complex lists, prose and documents
keep the previous chunking. Reindexing also compares chunks of unchanged files,
updating the derived index without touching Markdown. This decision neither
implements nor enables the Memory Curator.

---
## ADR-005.4.1 — Explicit retrieval mode
**Status:** accepted

`MEMORA_MEMORY_SEARCH_MODE` selects lexical, semantic or hybrid; the default is
lexical. The explicit variable wins over the legacy hybrid flag, which is only
considered when the mode is unset. An invalid value, disabled embeddings or an
unavailable provider produce a warning and lexical fallback. New and resumed
sessions keep using the same MemoryService. RRF is unchanged.

---
## ADR-005.4 — Opt-in local hybrid retrieval
**Status:** accepted

Markdown remains authoritative and SQLite rebuildable. FTS5 is kept for names
and codes; sqlite-vec 0.1.9 on the same connection stores Float32 cosine vectors
with hash/model/dimension metadata. Transformers.js 4.3.2 runs the ONNX q8 model
locally; explicit download uses `$MEMORA_DATA_DIR/models`, while runtime never
downloads. The provider API is replaceable; model errors do not prevent FTS use.
RRF with k=60 fuses ranks rather than heterogeneous scores.

The synthetic N95 benchmark shows better recall/MRR than FTS, but does not
justify an automatic default: lexical remains the default and enabling it
requires explicit setup and reindexing. Additional memory use is significant
(~780 MiB in the test); the vec0 index is queried with overfetch to respect the
category filter, a simple but non-optimal choice for very large corpora. A model
change is detected by its identifier: replacing weights while keeping the same
identifier requires an explicit index rebuild.

---
## ADR-001 — pnpm monorepo, strict TypeScript, Fastify health
**Date:** 2026-11-10
**Status:** accepted

### Context
Task 00 requires a minimal, reproducible base: monorepo, strict TypeScript, pnpm,
lint/test and a health endpoint, without integrating the Pi SDK yet.

### Decision
- Monorepo layout via `pnpm-workspace.yaml`: `apps/*` (server, web) and
  `packages/*` (agent, memory, shared).
- Root `tsconfig.json` with composite references; each workspace extends
  `tsconfig.base.json` (strict, ESNext, bundler module resolution).
- Server: Fastify with `GET /api/health` (default bind `127.0.0.1`).
- Web: Vite + React placeholder.
- Testing: Vitest.
- Lint: ESLint flat config + Prettier.
- `shamefully-hoist=true` in `.npmrc` for reliable module resolution under pnpm.
- Pi SDK deliberately not integrated (deferred to Task 01).

### Consequences
- Builds emit to `dist/` (gitignored).
- `tsc --build`, `eslint` and `vitest run` pass.
- `/api/health` returns `{"status":"ok","service":"memora"}` on localhost.
- Integration with `@earendil-works/pi-coding-agent` is deferred to Task 01.

---
## ADR-002 — Official Pi SDK integration and AgentService
**Date:** 2026-11-10
**Status:** accepted

### Context
Task 01 requires `@earendil-works/pi-coding-agent` as an external dependency for
an AgentService with session creation, prompt sending, streaming, abort and
resume.

### Decision
- `@earendil-works/pi-coding-agent@1.5.2` (exact version, not `^`) is a direct
  dependency of `@memora/agent` (not forked, not vendored).
- `AgentService` in `@memora/agent/src/index.ts` wraps the SDK's
  `createAgentSession`, `ModelRuntime` and `SessionManager`.
- `MEMORA_DATA_DIR` derives:
  - session directory: `$MEMORA_DATA_DIR/pi-sessions/`;
  - Pi config directory: `$MEMORA_DATA_DIR/.pi/` (never `~/.pi`).
- OpenRouter is configured at runtime through
  `ModelRuntime.setRuntimeApiKey('openrouter', OPENROUTER_API_KEY)`; the key is
  never written to disk or the repository.
- Explicit, configurable `cwd` through the `MEMORA_CWD` environment variable.
- Sessions use Pi's native JSONL format through `SessionManager`.
- Fastify API in `@memora/server`: POST /api/sessions, GET /api/sessions,
  GET /api/sessions/:id, POST /api/sessions/:id/messages (SSE streaming),
  POST /api/sessions/:id/abort.
- SDK mocks for tests (Vitest + vi.mock); no OpenRouter credit consumed.
- The SDK ships `dist/index.d.ts`; no local `.d.ts` shim is kept.
- Workspace symlinks are created by `pnpm install` through `workspace:*`; no
  custom postinstall or manual `node_modules` changes.
- TypeScript resolves the SDK's real types through pnpm symlinks; no local shim,
  ambient `any` or fake `paths`.
- `tsconfig.base.json` uses `moduleResolution: bundler` and `module: ESNext`.
- `.npmrc` contains only `ignore-scripts=false`; `pnpm-workspace.yaml` contains
  standard workspace configuration plus `allowBuilds`.

### Consequences
- `tsc --build`, `eslint` and `vitest run` pass on a clean clone with only
  `pnpm install`.
- No API key in the repository.
- No hardcoded paths (`$HOME`, project directory, `~/.pi`).
- Sessions live in `$MEMORA_DATA_DIR/pi-sessions/` in native Pi JSONL format.
- The SDK remains updatable as an external dependency (pinned to 1.5.2 for
  reproducibility).

---
## ADR-003 — Session management: rename, archive, modelId in the list
**Date:** 2026-11-10
**Status:** accepted

### Context
Task 03 requires session management: rename (display name), archive as soft
delete, modelId in the session list, automated restart testing, and branching
documented but not implemented.

### Decision
- **Rename** uses Pi SDK's native `SessionManager.appendSessionInfo(name)`. The
  name is stored as a `session_info` entry in JSONL and retrieved through
  `SessionManager.getSessionName()`. Endpoint: `PATCH /api/sessions/:id` with
  `{ name: string }`.
- **Archive** uses `SessionManager.appendCustomEntry('memora.session-meta',
  { archived: true/false })`. Custom entries do not participate in LLM context;
  the latest entry determines current state. Endpoint:
  `PATCH /api/sessions/:id/archive` with `{ archived: boolean }`.
- **GET /api/sessions** returns `name` from native session_info and `archived`
  from the custom entry. By default it excludes archived sessions; with
  `?archived=true` it returns only archived sessions. It does not add `modelId`
  because that would require opening every session; `modelId` is available from
  `GET /api/sessions/:id`.
- **Restart test**: a Vitest integration test simulates dispose + a new
  AgentService instance on the same data directory using SDK mocks.
- **Branching**: documented as natively supported by Pi SDK but not exposed in
  Task 03.
- **No separate database**: Pi JSONL remains the source of truth; Memora metadata
  lives as entries in the same JSONL.

### Consequences
- `tsc --build`, `eslint`, `vitest run` and `pnpm build` pass.
- 13 tests pass (11 existing + 2 restart integration tests).
- No API key in the repository and no hardcoded paths.
- No new database is created.
- UI: sidebar shows `name ?? firstMessage`, archive/restore and rename buttons,
  and an archived-view toggle.
- Architecture decision: Pi session JSONL remains the source of truth for session
  metadata; Memora-specific lightweight metadata is stored as Pi custom entries.

---
## ADR-004a — Explicit and irreversible session delete
**Date:** 2026-11-14
**Status:** accepted

### Context
Session management now also requires permanent chat deletion. The earlier MVP
decision that excluded it is superseded.

### Decision
- Archive remains reversible: `memora.session-meta` is soft metadata in JSONL.
- Delete is explicit and irreversible: `DELETE /api/sessions/:id` removes only the
  JSONL identified by `SessionManager`.
- The backend disposes/aborts a loaded session first, removes runtime state and
  verifies with `realpath` that the file is directly under
  `$MEMORA_DATA_DIR/pi-sessions/`; the client never sends a file path.
- The frontend requires accessible confirmation and normalizes the selection
  after deletion.

### Consequences
- A deleted chat does not reappear after refresh and cannot be restored.
- A stale ID in URL/localStorage is discarded without resume/message requests.
- No OpenRouter call is needed for delete tests.

---
## ADR-004 — Second Brain: Markdown scanner, SQLite FTS5, retrieval
**Date:** 2026-11-10
**Status:** accepted

### Context
Task 04 requires a Second Brain: Markdown scanner, SQLite FTS5 indexing,
full-text retrieval, context injection into Pi sessions through the
`before_agent_start` hook, and UI source browsing.

### Decision
- **Runtime data**: all knowledge-base Markdown files live under
  `$MEMORA_DATA_DIR/{memory,projects,journal,documents}/`. Nothing is hardcoded.
- **Scanner**: `scanMarkdown()` recursively scans only `.md` files in those four
  directories. It excludes JSONL, secrets, `.env`, databases and source code, and
  protects against path traversal and symlinks escaping the data directory.
- **Chunking**: deterministic, based on Markdown headings (`#`, `##`, `###`...) and
  paragraphs. Maximum 2000 characters per chunk; identical input always produces
  identical chunks.
- **Index**: SQLite + FTS5 under `$MEMORA_DATA_DIR/index/memora.sqlite`. Tables:
  `memory_sources` (file metadata), `memory_chunks` (text chunks),
  `memory_chunks_fts` (full-text index). The index can be rebuilt from scratch.
- **Incremental reindex**: compares SHA-256 content hash and mtime. New files are
  indexed; modified files updated; deleted files removed; unchanged files left
  alone.
- **MemoryService**: `@memora/memory` exposes `initialize()`, `reindex()`,
  `search()`, `listSources()`, `getSource()` and `close()`.
- **Automatic retrieval**: before each new user turn, the Pi SDK 1.5.2
  `before_agent_start` hook (registered through
  `session.extensionRunner.on()`) runs `memoryService.search()` and injects the
  retrieved chunks into the turn system prompt. Chunks are not written to JSONL
  and do not modify user text; context is transient per turn.
- **HTTP API**: `GET /api/memory/search?q=`, `POST /api/memory/reindex`,
  `GET /api/memory/sources`.
- **UI**: “Memory used” chat panel showing sources from the last turn; Second
  Brain section with source list and manual search.
- **Open-source templates**: `templates/memory/profile.md`,
  `templates/memory/preferences.md`, `templates/memory/decisions.md`,
  `templates/projects/esempio-progetto.md`. No real personal data in the repo.
- **Tests**: 13 automated tests covering scan, chunking, search, idempotent
  reindex, path traversal, symlink escape, deleted/rebuilt DB and retrieval with
  and without results. No real OpenRouter call.
- **Final retrieval E2E**: used a random unique token absent from the repository
  and kept only at runtime. FTS found the correct source, `memory_sources` was
  emitted, the token reached the model through transient context and was not
  persisted in user/system messages or custom JSONL entries. Resume and cleanup
  with reindex passed.
- The final answer did not return the token because of the model selected by
  `openrouter/free`, not because retrieval failed. `openrouter/free` is therefore
  not deterministic for acceptance tests that validate answer text.

### Consequences
- `tsc --build`, `eslint`, `vitest run` and `pnpm build` pass.
- 26 tests pass (13 agent + 13 memory).
- No API key in the repository and no hardcoded paths.
- No new database beyond the rebuildable SQLite index.
- `MEMORA_DATA_DIR` is respected as the main runtime data directory.
- Pi SDK remains an updatable external dependency (pinned to 1.5.2).
- Architecture decision: Markdown = knowledge source of truth; SQLite/FTS5 =
  rebuildable search index; Pi JSONL = conversation source of truth.

---
## ADR-005 — E2E acceptance with an explicit model and semantically neutral data
**Date:** 2026-11-13
**Status:** accepted

### Context
The E2E test verified the full retrieval chain: runtime token absent from the
repo, FTS search, `memory_sources` emission, transfer into transient model
context, unchanged user message in JSONL, absence of retrieval context from
history, successful resume and cleanup. However `openrouter/free` selected a
model that refused to return the token; its tool call did not retrieve it.

### Decision
- `openrouter/free` must not be used as a deterministic model for acceptance
  tests that compare assistant answers.
- Future E2E tests must configure an explicit physical model and record the model
  actually used when available.
- Test data must be fictional and semantically neutral, avoiding wording such as
  “confidential”, “secret” or equivalents that may trigger model refusals.
- Retrieval assertions (FTS, `memory_sources`, transient context and JSONL
  isolation) remain separate from generated-text assertions.

### Consequences
- The Task 04 retrieval pipeline is considered verified.
- LLM answer acceptance requires a new test with an explicit model and
  semantically neutral data.
- No LLM call is needed to validate FTS, reindex, context isolation, resume or
  cleanup.

---
## ADR-006 — Web Chat: content-block normalization and SSE streaming
**Date:** 2026-11-13
**Status:** accepted

### Context
Manual Web Chat testing exposed two retrieval-independent problems: the frontend
read the nested SSE payload at the wrong level, and history converted non-text Pi
content blocks into raw JSON. Stream closure also used a stale React snapshot of
`streamingContent`.

### Decision
- The backend keeps the existing SSE envelope; the client exposes the real Pi
  `AgentSessionEvent` `payload` to the frontend.
- `normalizePiContent()` is the only shared rule for extracting `text` blocks.
  Thinking/reasoning, signatures, tool calls, tool results and unknown blocks
  never become UI text.
- Streaming concatenates `text_delta` in a ref and React state, finalizing once
  on the concluding `message_end`/`turn_end` or `agent_end`.
- `memory_sources` remains a separate event and feeds only the sources panel.
- History exposes only user/assistant messages with visible text; system and tool
  messages remain in Pi JSONL but are not rendered in chat.

### Consequences
- User message and assistant placeholder appear without refresh.
- The assistant answer updates progressively and is not duplicated at
  finalization or refresh.
- History and streaming use the same content-block normalization.
- Tests cover text + thinking, thinkingSignature, multiple text blocks,
  history/streaming parity and separation of `memory_sources`.

---
## ADR-007 — Disjoint session views and observable deletion
**Date:** 2026-11-13
**Status:** accepted

### Context
The session flow had two ambiguities: `archived=true` also included active
sessions, and the frontend changed only the view label without reloading the
corresponding filter. The DELETE dialog also closed before knowing whether the
request and refresh succeeded, hiding errors from the user.

### Decision
- `GET /api/sessions` returns only non-archived sessions.
- `GET /api/sessions?archived=true` returns only archived sessions; there is no
  longer an “include archived” mode.
- The frontend explicitly reloads the filter on view change and ignores stale
  responses, so an older list cannot overwrite the current one.
- DELETE validates method, ID and `{ sessionId, deleted: true }`; refresh runs
  only after a valid response. An error keeps the dialog open and displays a
  readable message.
- Requests without a body (GET/DELETE) do not send `Content-Type:
  application/json`; Fastify would reject an empty JSON body with `400
  FST_ERR_CTP_EMPTY_JSON_BODY`. Content-Type is set only when a JSON body is
  serialized.
- After successful deletion, JSONL remains authoritative: the list is reloaded
  from the backend and selection, URL and localStorage are cleared only when they
  refer to the deleted session.
- The archived-view control uses an archive/tray SVG icon with `aria-label`,
  `title`, `aria-pressed` and a visible active state.

### Consequences
- Archive/restore moves a session between the two views without duplication.
- Deleting a selected session clears the chat and persisted references; deleting
  a non-selected session does not change the open chat.
- Automated tests cover archive/restore filtering, JSONL deletion, 404 on a second
  DELETE, the HTTP contract and selection transitions without OpenRouter calls.

---
## ADR-008 — New chats immediately visible as in-memory drafts
**Date:** 2026-11-13
**Status:** accepted

### Context
Pi SDK creates the JSONL file only when a session contains its first
user/assistant message. A new session therefore exists at runtime but not in
`SessionManager.list()` and disappeared from the sidebar until the first message.
Creating an empty JSONL or artificial message would violate Pi's session format
and context.

### Decision
- `AgentService.listSessions()` merges persisted sessions with in-memory sessions
  that have no JSONL yet, marking them `draft: true`.
- Drafts appear only in the active view, titled “New chat”.
- Rename/archive on a draft return `409 session_not_persisted`; the UI hides those
  actions but still allows deletion, which removes the session from runtime only.
- After the first turn the UI reloads the list: Pi materializes the JSONL and the
  draft is replaced by the persisted session without duplicates.
- “New chat” always returns to the active view, even if the user was viewing the
  archive.

### Consequences
- A new chat is visible immediately without empty files, artificial entries or
  OpenRouter calls.
- Drafts do not survive a backend restart because they contain no conversation
  data yet.
- Active and archived views remain disjoint even for newly created sessions.

---
## ADR-009 — Responsive layout: shell, topbar and collapsible panels
**Date:** 2026-11-13
**Status:** accepted

### Context
The UI mixed inline styles and CSS, the model bar occupied a separate row, an
open Second Brain reduced chat space, and on mobile the sidebar was always
visible, leaving little room for conversation.

### Decision
- Single `app → sidebar + main-panel` shell, with a topbar containing the
  conversation title and model selector.
- Chat with a readable maximum width, role-differentiated messages and a composer
  anchored to the bottom.
- Second Brain converted into a collapsible `<details>` panel, closed by default,
  without losing search or sources.
- Below 900px the sidebar becomes a drawer with backdrop and close button; on
  mobile the topbar exposes the panel toggle.
- Styles moved to `index.css` with color variables, visible focus states and
  respect for `prefers-reduced-motion`.

### Consequences
- Chat has more vertical space and reading is more stable on desktop and mobile.
- No API protocol or session-format changes.
- `pnpm build`, typecheck, lint and tests remain the reproducible layout
  verification.

---
## ADR-010 — Memory Writer with explicit approval
**Date:** 2026-11-13
**Status:** accepted — extended by ADR-044 for optional new-memory auto-saving

### Context
The Second Brain already had authoritative Markdown, a rebuildable SQLite/FTS5
index and automatic retrieval. Writing was missing. Writing every piece of
information directly from conversation would make the knowledge base noisy and
hard to correct.

### Decision
- The pipeline is `conversation → MemoryCandidate → dedup/conflict → Memory Inbox
  → approval → Markdown → reindex`.
- Candidates live append-only in
  `$MEMORA_DATA_DIR/memory-inbox/candidates.jsonl`; the latest version per ID is
  current state and previous versions form a minimal audit trail. They are not
  inserted into FTS or conversation JSONL.
- `MemoryCandidate` contains proposed text, category, project, destination,
  section, synthetic rationale, status, origin, priority, duplicate/conflict and
  review fields. It contains no chain-of-thought.
- Explicit requests (`remember that...`, `save this information...`, `add to the
  second brain...`, `from now on...`) are extracted locally and always produce a
  pending candidate, even with automatic writing OFF.
- Automatic extraction is conservative, local, text-marker based and disabled by
  default with `MEMORA_MEMORY_WRITER_ENABLED=false`. Task 05 adds no extra LLM
  call.
- Dedup/conflict use `MemoryService.search()` and textual normalization/Jaccard.
  A likely duplicate stays pending and is flagged; a possible update/contradiction
  becomes `conflict` with visible existing content.
- Approve validates the target (only `memory/`, `projects/`, `journal/`, `.md`, no
  traversal/symlink), atomically writes a bullet in the chosen section without
  duplicating headings or identical bullets, then reindexes. Reject does not
  modify Markdown.
- Secret detection blocks API keys, passwords, tokens, private keys, cookies and
  common credentials. For an explicit request only a redacted audit is kept; for
  automatic extraction the candidate is discarded.
- The UI exposes Memory Inbox under Second Brain with Approve, Edit, Reject, text,
  category, project, destination and comparison with existing content.

### Consequences
- Conversation ≠ memory and candidate ≠ approved memory: only approved Markdown
  is authoritative knowledge.
- After approval, content is immediately retrievable without restart because
  reindexing is automatic.
- The full file diff is not shown yet; MVP preview shows what will be added, where
  and any conflict.
- Approved conflicts add new content without deleting the old content; automatic
  contradiction resolution remains out of scope.
- Unapproved candidates are not retrievable and do not modify the Second Brain.

---
## ADR-011 — Production runtime: single Fastify process and static React
**Date:** 2026-11-13
**Status:** accepted

### Context
The runtime required manually starting a Fastify backend and a Vite dev server.
A permanent self-hosted service needs one production process, a prebuilt frontend,
SIGTERM handling and systemd startup.

### Decision
- `NODE_ENV=production` enables `@fastify/static` (Fastify 5) rooted at the React
  build with `wildcard: false`.
- The current Vite build stays in `apps/dist/web` (`outDir: ../dist/web`) and can
  be overridden with `MEMORA_WEB_DIST_DIR`.
- SPA fallback: `setNotFoundHandler` returns `index.html` only for non-API
  GET/HEAD requests without a file extension. Unknown `/api/*` remain JSON 404,
  and missing assets remain 404.
- In development Fastify does not register static and Vite keeps proxying `/api`
  to :3000.
- `pnpm start` runs the compiled server with `NODE_ENV=production`, without Vite
  and without `tsx`.
- Shutdown: SIGTERM/SIGINT close Fastify first, then AgentService/MemoryService,
  with double-shutdown protection.
- Example systemd unit in `deploy/memora.service`, with an absolute
  `EnvironmentFile` because systemd does not expand `~`, `User=memora`,
  `WorkingDirectory=/opt/memora`, `Restart=on-failure` and journald.
- Default bind `127.0.0.1`; remote access through an SSH tunnel, including over
  Tailscale. Tailscale Serve is not used.

### Consequences
- Production only needs `pnpm build && pnpm start`.
- `pnpm smoke:prod` starts only the compiled server and verifies frontend, API,
  SPA fallback, 404 and graceful shutdown.
- The unit contains deployment paths, not application-code hardcoded paths.
- The frontend build must exist before production start; otherwise the server
  fails with an explicit error.

---
## ADR-012 — Managing approved memories directly in Markdown
**Date:** 2026-11-13
**Status:** accepted

### Context
After approval, the user could create and retrieve memories but not manage them
from the Web UI. The create → retrieve → edit → delete cycle needed completion
without introducing a separate database of approved memories.

### Decision
- Markdown remains authoritative; SQLite/FTS5 remains a rebuildable index.
- The source list exposes relative path, category, modifiedAt, chunkCount and
  main heading; detail returns full content through a source ID.
- The client sends only a `source id`. The backend resolves the path from the
  index and never accepts arbitrary paths.
- Edit and delete validate: path under `MEMORA_DATA_DIR`, allowed root (`memory`,
  `projects`, `journal`, `documents`), `.md` extension, no symlink/path traversal,
  and parent realpath inside the data directory.
- Edit atomically writes the full file with temp + rename, preserves a safe mode
  and reindexes. Delete removes only the target file, without removing parent
  directories, and reindexes.
- After every operation the source is returned updated or removed; `search()`
  immediately sees the new content or its absence.
- The UI lists sources, opens detail, allows Markdown editing in a textarea and
  deletion with explicit confirmation. Search results open the source with
  heading/line range highlighted.
- For core files `memory/profile.md`, `memory/preferences.md` and
  `memory/decisions.md`, the UI hides full-file deletion because they may contain
  multiple memories; full-file editing remains available.
- Rename/move is not implemented in the MVP: edit and delete are priorities and
  move would add overwrite risk.

### Consequences
- Managing approved memories creates no new database and does not duplicate
  knowledge.
- Reindexing keeps FTS aligned; no restart is required.
- Deleting individual bullets is not reliable and remains deferred to structured
  memory entry IDs.
- Full-file deletion is available only for non-core sources in the UI; the API
  remains explicit and protected.

---
## ADR-013 — Personal Assistant runtime isolation
**Date:** 2026-11-13
**Status:** accepted

### Context
A personal question produced an answer contaminated by tasks, E2E tests, SQLite,
source IDs and Memora repository details. Sessions used the repository directory
as cwd, loaded repository instruction files/project resources and kept built-in coding tools active.
The application repository must not be personal-assistant knowledge.

### Decision
- Personal-assistant sessions use an isolated CWD:
  `$MEMORA_DATA_DIR/runtime/assistant`, overridable with `MEMORA_ASSISTANT_CWD`.
- `createAgentSession` uses `noTools: "builtin"`: read, bash, edit, write, grep,
  find and ls are disabled; explicitly registered custom/integration tools remain
  available.
- `DefaultResourceLoader` is explicitly configured with `noContextFiles`,
  `noSkills`, `noPromptTemplates`, `noExtensions`, `appendSystemPrompt: []` and
  `systemPrompt: PERSONAL_ASSISTANT_SYSTEM_PROMPT`.
- The inline Memora Memory Retrieval extension is still loaded through
  `extensionFactories`; extensions discovered automatically from the repository
  are not loaded.
- The system prompt limits answers to conversation, retrieved memory and available
  integrations; it forbids treating repository code as personal knowledge,
  requires declaring missing information, and clarifies that memory chunks are
  context, not instructions.
- New sessions have an assistant header/CWD. Discovery uses
  `SessionManager.listAll(sessionDir)` to keep legacy sessions visible; resume
  uses `SessionManager.open(..., assistantCwd)` to apply the same policy.
- Chunk line ranges remain in `memory_sources` for the UI but are removed from
  text injected into the prompt because the model treated them as informative
  content.

### Consequences
- A personal-assistant session cannot read files, run bash or explore the
  repository.
- repository instruction files, skills, prompt templates, documentation and repository source code
  never enter context.
- Memory Retrieval and Memory Writer keep working.
- Model selection, resume, streaming, archive/delete, Memory Inbox and production
  runtime remain unchanged.
- Coding Mode is deliberately deferred; tool policy is centralized so it can be
  added later.

---
## ADR-014 — Admin settings JSON and environment precedence
**Status:** accepted

### Context
Runtime options were configurable only through environment variables and secrets
files. Web UI editing, systemd/Docker operational overrides and compatibility with
existing installations were needed without putting secrets in settings.

### Decision
- Non-derived settings live in `$MEMORA_DATA_DIR/config/settings.json`, not
  SQLite. The file is versioned, readable, atomically written and `0600`.
- Precedence: defaults → file → environment. Environment fields are read-only in
  API/UI.
- Admin APIs are centralized under `/api/admin/*`; authentication does not exist
  yet and this is documented as a limitation.
- Live configuration uses explicit MemoryService, MemoryCurator and AgentService
  setters. Embeddings and Curator enablement require restart; Curator provider,
  model and reasoning reload live, while the default Chat provider applies live to
  new sessions.
- `chat.defaultModel` changes only the default for new sessions.
- PATCH uses a whitelist, enum/range validation and recursive rejection of
  secret-looking keys.
- Lite/Standard are UI presets with preview; they are never applied silently.

### Consequences
- The runtime can be administered without editing secrets.env.
- Environment-only installations keep working and no settings.json is created
  until the first save.
- A corrupt file does not block startup; it is ignored with a warning.
- Changing embeddings or Curator enablement requires an explicit restart; Curator
  provider/model/reasoning and Chat provider are live. The web process receives no
  sudo privileges.

---
## ADR-015 — Multiple providers, secret store and model catalogs
**Status:** accepted

### Context
Chat configuration was tied to OpenRouter and API keys lived only in the
environment. Provider/model selection from the Web UI was needed, with OpenCode Go
already supported by the installed Pi SDK, without exposing credentials.

### Decision
- `openrouter` and `opencode-go` are supported. Pi provides both; OpenCode Go IDs
  are bare (`deepseek-v4.1-flash`).
- API keys are in `$MEMORA_DATA_DIR/config/secrets.json`, mode `0600`, atomically
  written; the environment takes precedence and makes the field read-only. GET
  exposes only `{configured, source, editable}`.
- The OpenRouter catalog uses the Pi catalog (375+ models with metadata). OpenCode
  Go uses the official remote endpoint filtered to models supported by the
  installed Pi, with a 10-minute cache, explicit refresh and cache/Pi fallback.
- Chat and Curator have independent provider/model settings. Curator reuses the
  same provider credential and accepts only OpenAI-compatible OpenCode Go models.
- The Chat default applies to new sessions; existing sessions keep their persisted
  model. Curator provider/model reloads live.
- Connection tests use catalog/key endpoints, not inference, and return sanitized
  errors.

### Consequences
- API keys are never returned or written to settings.
- Model search is case-insensitive across name, ID and provider; OpenRouter exposes
  a Free filter based on metadata.
- If the remote catalog fails, Memora continues with cache/Pi and a warning.
- Admin authentication still does not exist; the limitation is documented.
- OpenCode Go inference verification requires a user-provided key and cannot run
  in automated tests.

---
## ADR-016 — Memory guardrails and PII redaction
**Date:** 2026-11-15
**Status:** accepted

### Context
Retrieved memory enters the chat prompt and an excerpt is sent to the remote
Curator. Markdown documents may contain hostile text or personal data; Curator
output is untrusted. Verifiable defenses are needed without changing the
Markdown-first format.

### Decision
- Memory is inserted into a JSON block delimited by `<memora-memory-json>`; `<`,
  `>` and `&` are escaped, and boundary markers and control characters are
  neutralized. The base prompt comes first and declares memory as data, not
  instructions.
- Before the cloud Curator, secrets block analysis; emails, phone numbers, IBANs,
  Luhn-valid cards and Italian tax codes are redacted. Memory chunks with
  high-confidence PII are not sent.
- Curator output is rejected if it contains secrets, PII or redaction
  placeholders. Path validation, human approval and metadata-only logging remain.
- Settings UI shows which Chat/Curator providers receive data, that embeddings
  are local, and which categories are redacted.
- Redaction is heuristic: names, addresses and other unrecognizable PII may still
  reach the provider. Residual risk is documented in `docs/MEMORY-SECURITY.md`.
- Admin authentication remains a prerequisite in `09-hardening.md` for any network
  exposure.

### Consequences
- Prompt size increases due to JSON, but the boundary is structurally harder to
  close.
- A turn containing PII may lose the context of memories that contain it; this is
  preferable to unnecessary transmission.
- Prompt-injection and redaction tests become part of the suite.
- Protection is not a guarantee against semantic prompt injection or all PII; the
  threat model and residual risks remain explicit.

---
## ADR-017 — Evaluation harness and memory baseline
**Date:** 2026-11-15
**Status:** accepted

### Context
The existing benchmark measured only a few synthetic queries and did not cover
Curator, regressions, ambiguity or live modes. A reproducible evaluation was
needed that introduces no personal data and can run in CI without network access.

### Decision
- Datasets are synthetic JSON files in `evaluation/`: 46 retrieval queries and 15
  Curator cases. No real, personal or runtime data enters the repository.
- Retrieval metrics are Recall@k, Precision@k, MRR, nDCG@k, latency and estimated
  tokens (`characters / 4`). Modes are reported separately.
- Curator replay uses frozen provider outputs and measures the validation
  pipeline, thresholds and classes. Live mode is explicit, uses the local
  credential and cannot write the baseline.
- `evaluation/baseline.json` is versioned. The check uses an absolute tolerance of
  `0.02`; latency is measured but is not a gate.
- CI runs lexical and Curator replay without a model or network. Semantic/hybrid
  need `MEMORA_DATA_DIR` with the local model.
- The dataset is intentionally small and synthetic; results do not replace
  evaluation on anonymized real conversations.

### Consequences
- Every retrieval or Curator change can be compared against a stable baseline.
- Intentional quality changes require explicit baseline updates.
- Live reasoning measurement is indicative and non-reproducible; it is not a gate.
- Precision@10 must be read together with Recall and nDCG because many queries
  have only one gold evidence item.

---
## ADR-018 — Per-bullet metadata and memory lineage
**Date:** 2026-11-15
**Status:** accepted

### Context
Markdown was authoritative but did not preserve identity, provenance, confidence
or update history. SQLite could not be the only copy of this data without
violating the rebuildable-index principle.

### Decision
- Metadata lives in an HTML comment on the bullet line
  (`<!-- memora-memory:v1 ... -->`), invisible in rendered Markdown.
- `memoryId` identifies stable lineage; `versionId` identifies a single version;
  `version`, `status`, `supersedes` and `supersededBy` describe the chain.
- Provenance: session, message, turn, timestamp, confidence, scope, project,
  entity, tags, provider and Curator model.
- An update keeps the previous bullet as `superseded` and adds an `active` bullet.
  Reindexing removes comments, skips superseded lines and indexes only active
  versions.
- SQLite adds `memory_records` and chunk metadata. Both are derived and
  rebuildable from files.
- Legacy-bullet migration is explicit and non-destructive: dry-run by default,
  `--apply` only adds comments, optional `--backup`.
- Invalid metadata or broken references produce warnings with file, line and code;
  content is never logged.

### Consequences
- Memories are more verbose in source but remain readable and editable.
- Retrieval never returns historical versions.
- The database can be deleted and rebuilt without losing provenance as long as
  Markdown comments are preserved.
- Automatic migration does not modify user data at startup.
- Comments are not signed: provenance is as trustworthy as the filesystem.

---
## ADR-019 — Historical memory, retention and integrity
**Date:** 2026-11-15
**Status:** accepted

### Context
`superseded` versions were preserved but not queryable. A user could ask “what did
it use before?” and receive “not in memory” even though the historical version
existed in Markdown. Explicit policies for retention, propagated deletion and
index verification were also missing.

### Decision
- Superseded versions stay outside normal retrieval.
- For queries with explicit temporal markers, the extension searches only
  `superseded` versions in related active source paths and adds a separate
  `Historical memory` block marked as non-current.
- Historical search is lexical and conservative; it is not used for present-tense
  questions.
- Source detail exposes full history with status, version, date, provenance and
  text.
- Retention is manual: `memory:history:prune` is dry-run by default, requires
  `--apply`, supports backup and never removes active versions.
- Deleting a source propagates to index, vectors and candidates; pending
  candidates become `rejected` with `source_deleted`, approved ones receive
  `purgedAt`.
- `memory:integrity` runs read-only checks on SQLite, foreign keys and Markdown
  metadata without logging content.
- Hierarchical summaries are evaluated and deferred: with the current corpus they
  add complexity and risk of detail loss.

### Consequences
- Chat can answer historical questions without treating the past as current truth.
- Retention is predictable and never deletes user data automatically.
- Backup and restore have a verifiable procedure.
- Historical search is heuristic and does not cover implicit temporal queries.

---
## ADR-020 — Runtime retrieval with budget, filters and diversity
**Date:** 2026-11-15
**Status:** accepted

### Context
Retrieval returned raw FTS/vector/RRF results. Token budget, explicit filters,
redundancy protection and metadata-aware ranking were missing. The benchmark
measured raw modes, not the real pipeline.

### Decision
- `MemoryService.search()` applies overfetch, project/type/confidence filters,
  confidence/importance/recency reranking, Jaccard diversity and `maxChars` +
  `maxTokens` budget.
- `MEMORA_MEMORY_MAX_TOKENS` (default 1000) uses a `characters/4` estimate;
  `MEMORA_MEMORY_DIVERSITY` (default 0.15) controls MMR penalty. Both are editable
  in **Settings → Memory** and apply live.
- Direct modes remain available for benchmarks and diagnostics. The baseline does
  not change; runtime pipeline has dedicated tests.
- No local cross-encoder is loaded: RAM, latency and lack of a verified Italian
  model do not justify the cost.
- Query rewriting and multi-query are evaluated and deferred; hybrid already fuses
  lexical and semantic.
- `memory_sources` exposes source IDs and metadata of used versions; logs contain
  no content.

### Consequences
- Context is more predictable and less redundant.
- Runtime pipeline may diverge from the raw baseline; a future dedicated benchmark
  is needed to measure it end-to-end.
- Weights and diversity are deterministic and require tuning on real queries.
- Legacy bullets without metadata remain included and receive neutral boosts.

---
## ADR-021 — Durable Curator queue and idempotency
**Date:** 2026-11-15
**Status:** accepted

### Context
The Curator queue was volatile: crashes or forced shutdown could lose proposals. A
retry after an already-completed write could duplicate candidates. Consolidation
of the entire memory was absent.

### Decision
- Jobs are persisted in
  `$MEMORA_DATA_DIR/memory-inbox/writer-queue.jsonl` with `0600` permissions,
  retry, backoff and a 100-pending-job limit.
- Each job has an `idempotencyKey` from `turnId`, `sourceMessageId` or text hash.
- `running` jobs are requeued after restart.
- The writer ignores a turn if a candidate already exists with the same
  `turnId`/`sourceMessageId`.
- Durable shutdown waits for the current job and leaves pending jobs on disk; the
  volatile test queue keeps full drain behavior.
- `memory:consolidate` is a deterministic read-only audit of similar active
  memories; automatic LLM consolidation is deferred.
- `memory:integrity` adds Inbox metrics, and the admin panel shows queue, failed
  jobs and attempts.

### Consequences
- A crash does not silently lose jobs.
- A retry does not duplicate already-persisted proposals.
- The persisted queue contains turn data and must be included in retention and
  encrypted backups.
- Automatic LLM consolidation, feedback loop and batching remain future work.

---
## ADR-022 — Aggregate metrics and operational runbook
**Date:** 2026-11-15
**Status:** accepted

### Context
Admin status showed sources, chunks, vectors and queue length, but not latency,
errors, retrieved tokens, queue age or approval rate. A runbook for backup,
restore, migration and degradation was missing.

### Decision
- `RuntimeMetrics` aggregates retrieval and Curator data in memory without
  queries, prompts or content. Metrics are exposed at `/api/admin/status` and in
  **System → Observability**.
- The queue exposes failed jobs, attempts, oldest-job age and last outcome.
- Memory Inbox exposes pending/conflict/approved/rejected and approval rate.
- Alerts: blocked queue, failed jobs, backlog, Curator/retrieval errors.
- `docs/OPERATIONS.md` covers backup, restore, reindex, migration and behavior
  with missing embeddings, corrupt SQLite, invalid metadata and full disk.
- Embedding→lexical degradation and invalid metadata are covered by tests; full
  disk and corrupt SQLite are documented operational procedures.

### Consequences
- An operator can understand status without reading personal content.
- Metrics are per process: restart resets counters, not data.
- The persisted queue contains personal input and must be included in
  backup/retention.

---
## ADR-023 — Read-only LLM consolidation and advisory feedback
**Date:** 2026-11-15
**Status:** accepted

### Context
Deterministic consolidation found only lexical similarities. Semantic checking of
duplicates and contradictions beyond the per-turn set was needed, without risky
automatic merges or uncontrolled threshold tuning.

### Decision
- `MemoryConsolidator` uses a JSON completion with a versioned schema
  (`schemaVersion: 1`) and accepts only IDs present in the batch.
- `memory:consolidate:llm` is explicit, read-only, with record and batch limits;
  it produces a report, not candidates or Markdown.
- The per-turn Curator accepts an absent `schemaVersion` or `1` and rejects future
  versions.
- `memory:feedback` computes approval rate and average scores and suggests
  thresholds; it does not modify configuration.
- No automatic merge and no automatic tuning.

### Consequences
- Semantic consolidation is available without risk of incorrect writes.
- The report is local and must be treated as personal data if it contains
  memories.
- Feedback needs a minimum number of reviews to be useful.
- Cost and latency remain controlled by batches and timeouts.

---
## ADR-024 — First-class projects
**Date:** 2026-11-15
**Status:** accepted

### Context
Projects existed only as Markdown directories and a `project` field.
Configuration, declared sources, prompts, session association and retrieval
isolation were missing.

### Decision
- `projects/<slug>/project.json` is configuration; `memory.md` is memory and
  `sources/**/*.md` plus `sources/**/*.txt` are sources.
- The slug is immutable; the name is editable.
- The project prompt is a layer subordinate to Memora policy and precedes
  retrieved memory.
- Sessions use the `memora.project` custom entry; legacy sessions remain global.
- Retrieval uses `searchScoped()` with RRF over global and project memory.
- The Curator routes project facts to the current project.
- Sources support CRUD, include/exclude and reindex; deletion propagates to index,
  vectors and candidates.
- The UI provides a project selector, project page, prompt, sources, filtered
  sessions and filtered Second Brain.
- Archive is reversible; purge requires `confirm` and moves the directory to
  `.trash/projects`; export is JSON.

### Consequences
- A project cannot see another project's sources or memory.
- Legacy projects remain compatible.
- Migration to `project.json` is explicit.
- Purge is not a destructive one-click UI action.

---
## ADR-025 — Local appearance preferences and collapsible sidebar
**Date:** 2026-11-15
**Status:** accepted

### Context
The UI used one light theme with partly hardcoded colors, offered no readability
controls, and the sidebar always consumed valuable space even on small screens.

### Decision
- Appearance preferences are local to the browser (`localStorage`), are not part
  of `settings.json` and are never sent to the server.
- Theme `system`/`light`/`dark`, text size, density, chat width, reduced motion and
  sidebar state are applied through `<html>` attributes and CSS variables.
- An inline bootstrap in `index.html` applies the theme before first render to
  avoid a light/dark flash.
- The desktop sidebar can be collapsed with the topbar button, `Ctrl+B` or the
  settings option; on mobile it remains a drawer.
- The composer receives focus when the active session changes, so a new chat is
  immediately ready for typing.

### Consequences
- Preferences do not follow the user across browsers/devices.
- Semantic colors use CSS variables, so dark mode does not depend on fragile
  overrides.
- The UI must keep controls accessible when the sidebar is collapsed.

---
## ADR-026 — Chat attachments and project files with local preview
**Date:** 2026-11-15
**Status:** accepted

### Context
Chat accepted only text. Projects had indexed Markdown/TXT sources but no way to
browse the folder or inspect PDF, HTML and Word documents. Attachments also needed
to reach the model without being inserted into the user message.

### Decision
- The **Project files** panel lists only `projects/<id>/`, protected against
  symlinks and traversal, with search and previews for Markdown, text, PDF, HTML,
  `.docx` and images.
- HTML is always in a sandboxed iframe; `.docx` uses Mammoth; PDF uses the native
  viewer; no file is executed.
- Chat attachments are copied to `chat-attachments/<sessionId>/` with `0600`
  permissions; the client sends content as base64 JSON.
- Text, PDF and Word are extracted locally and injected into the transient system
  prompt as untrusted data; images use Pi image blocks.
- User text and Pi JSONL remain unchanged; attachment metadata is a
  `memora.attachments` custom entry.
- Session deletion also removes the attachment directory; explicit attachment
  deletion removes the file.

### Consequences
- PDF and Word require `pdf-parse` and `mammoth` on the server.
- Attachments are personal data: backup and retention must include
  `chat-attachments/`.
- Uploads that are never sent can remain orphaned until automatic retention is
  added.
- Models without image support may reject image attachments.

---
## ADR-027 — Per-chat context, project file archive and artifacts
**Date:** 2026-11-15
**Status:** accepted

### Context
Files uploaded in chat were only temporary attachments; the project panel was on
the left; there was no way to choose which sources to use per chat; structured
outputs had no dedicated container.

### Decision
- Attachments in a project chat are also archived in `projects/<id>/files/`;
  `files/` is excluded from retrieval and memory.
- Retrieval context is per session (`memora.context`) with three toggles: global
  memory, project memory and project sources. Project defaults remain an upper
  bound.
- The contextual panel is on the right, with Files/Context/Artifacts tabs.
- Artifacts are text files in `artifacts/<sessionId>/`, created by the
  `create_artifact` tool; HTML/SVG are sandboxed. No Python execution.
- Attachments and artifacts are removed with the session.

### Consequences
- The `files/` folder is browsable but is not model knowledge until explicitly
  promoted to a source.
- Context toggles do not rewrite the project and are reversible.
- Artifacts are not an execution environment: calculations/charts will need a
  separate sandbox.

---
## ADR-028 — Token-efficient PDF
**Date:** 2026-11-15
**Status:** accepted

### Context
A PDF tool receiving the full document would duplicate content in the tool call
and subsequent turns, increasing input tokens. Lightweight PDF generation was
also needed on the N95.

### Decision
- PDF rendering uses server-side `pdfkit`, without a headless browser or Python.
- `create_pdf` receives only `title` and `filename`; content is taken from the
  assistant's final answer after the turn.
- The **PDF** button exports text already present in the answer: zero additional
  LLM tokens.
- PDF artifacts are binary files in `artifacts/<sessionId>/` and are never
  reinserted into context.
- Limits: 30,000 Markdown characters, 30 pages, 5 MB.
- HTML/SVG remain sandboxed; PDFs use the browser viewer.

### Consequences
- PDF generation consumes no tokens and only CPU when requested.
- The model must write the document in the final answer when using `create_pdf`.
- PDF templates and skills can be added later without changing the security
  boundary.

---
## ADR-029 — HTML to PDF without a headless browser
**Date:** 2026-11-15
**Status:** accepted

### Context
PDFKit produces readable but plainly laid-out documents; models can generate much
better HTML/CSS. Headless Chromium was not reliably available on the target
machine and would add a browser, RAM and security surface.

### Decision
- HTML format is converted with `html-to-pdfmake` + `pdfmake` after inlining basic
  CSS with `inline-css`.
- Scripts, iframes, objects, embeds, external links, inline handlers and `@import`
  are removed. Remote resources are blocked.
- The renderer supports a CSS subset: colors, fonts, borders, tables, dimensions.
  Flex/grid and complex layouts are not guaranteed.
- The `create_pdf` tool supports `format: "html"` with content taken from the final
  answer, without duplicating it in the tool call.
- HTML/Markdown artifacts have **Export PDF**.
- PDF preview uses PDF.js, not the browser PDF plugin.

### Consequences
- HTML PDFs look better than Markdown PDFs but are not pixel-perfect browser
  renderings.
- They add no token cost and require no Chromium.
- An optional browser renderer can be added later for complex templates.

---
## ADR-030 — Optional Chromium for faithful HTML PDFs
**Date:** 2026-11-15
**Status:** accepted

### Context
PDFMake/HTML-to-PDFMake do not support complex CSS layouts. Generated PDFs looked
plain compared with the HTML produced by models.

### Decision
- HTML rendering first tries headless Chromium (`@sparticuz/chromium` +
  `puppeteer-core`), with JavaScript disabled, network requests blocked and one
  generation at a time.
- If Chromium is unavailable, it uses the `html-to-pdfmake`/`pdfmake` fallback.
- Missing Debian libraries (`libnspr4`, `libnss3`) are installed in
  `$MEMORA_DATA_DIR/browser-libs/` through `pnpm pdf:browser:setup`, without root.
- `create_pdf` remains metadata-only; HTML content comes from the final answer.

### Consequences
- HTML PDFs can use layouts, fonts, backgrounds and complex CSS.
- The first PDF starts Chromium and needs more RAM; the process closes after each
  conversion.
- The fallback guarantees continuity but produces simpler PDFs.

---
## ADR-031 — Artifact versions and conversation controls
**Date:** 2026-11-15
**Status:** accepted

### Context
Regenerating an artifact with the same name created duplicate files. Chat also did
not allow copying, correcting a question or rephrasing an answer, and the composer
lost focus after a turn.

### Decision
- `ArtifactStore` keeps one current artifact per name/session; previous versions
  are archived in `.versions/<artifactId>/`.
- `ChatArtifact` exposes `version` and `updatedAt`; `ArtifactStore` exposes
  `listVersions`/`getVersion`, and the UI can select a version.
- Editing a question uses Pi's `navigateTree`: the new branch replaces the old
  question in active context without deleting historical JSONL.
- Answers have Markdown copy, PDF and Regenerate; questions have text copy and
  editing with a large auto-resizing editor.
- The composer receives a focus token after every completed or aborted turn.

### Consequences
- A revised artifact remains the same logical file with an increasing version.
- Editing a question does not rewrite Pi history: it creates a branch.
- Regenerate is an explicit new turn, not a silent retry.

---
## ADR-032 — Dedicated Second Brain and memory from answers
**Date:** 2026-11-15
**Status:** accepted

### Context
The old “Second Brain” panel was a drawer under chat mixing knowledge search,
Memory Inbox and source detail. It was unclear where memories from all
chats/projects lived, and there was no explicit way to save an assistant answer.

### Decision
- The sidebar has two icons: Second Brain and Settings.
- The Second Brain page lists all indexed sources, with global/project filter,
  search and Markdown editing.
- The bottom panel is renamed **Chat memory** and contains Memory Inbox plus links
  to global/project memories.
- An answer can be promoted with the **Memory** button; the candidate has
  `sourceKind: assistant`, explicit origin and requires approval.
- Automatic extraction still considers only user statements. Assistant answers
  never become implicit memory.

### Consequences
- Indexed knowledge has a single recognizable destination.
- Saving an answer is intentional, traceable and reversible.
- Memory does not feed on model output by itself.

---
## ADR-033 — Lightweight Office artifacts and HTML-first PPTX
**Date:** 2026-11-16
**Status:** accepted

### Context
Memora produced PDF, Markdown and HTML but not DOCX, XLSX or PPTX. A universal
Office renderer would require LibreOffice, too heavy for the N95 target and for a
reproducible open-source installation. Generation also had to remain token-cheap.

### Decision
- DOCX, XLSX and PPTX are new binary `ArtifactKind` values, stored in
  `artifacts/<sessionId>/`, with versions and dedicated limits.
- `create_docx`, `create_xlsx` and `create_pptx` receive only title and filename;
  content comes from the final answer, as with `create_pdf`.
- DOCX: Markdown → `docx`; Mammoth preview in a sandboxed iframe.
- XLSX: Markdown tables → `exceljs`; limited JSON preview rendered in React
  without evaluating formulas.
- PPTX: HTML deck with `<section class="slide">` → `jsdom` + `pptxgenjs`; the same
  sanitized HTML is saved in `.previews/<artifactId>.html` and used as preview.
- User-uploaded PPTX files remain without preview in the first version.
- Preview HTML: sandbox, CSP, no scripts, no external network.
- LibreOffice is not a dependency.

### Consequences
- Installation remains lightweight and needs no external services.
- PPTX preview is faithful to HTML, while `.pptx` supports a subset of titles,
  text, lists, tables and `data:` images.
- Excel formulas and complex Office layouts are not perfectly reproduced, but the
  file remains editable with external tools.
- A universal Office converter can only be added as an explicit option later.

---
## ADR-034 — Single-user web login
**Date:** 2026-11-16
**Status:** accepted

### Context
Memora contains sessions, personal memory, provider secrets and admin APIs. The
default is localhost, but LAN and Tailscale access require an authentication
boundary before real use.

### Decision
- Single-user, password-only login, with no username or registration.
- First password: the first valid setup creates `config/auth.json`; application
  APIs are blocked until setup is complete.
- `scrypt` hash with salt and explicit parameters; file `0600`.
- `memora_session` cookie, `HttpOnly`, `SameSite=Lax`, 24-hour lifetime.
- Logout and password reset invalidate all sessions through `sessionVersion`.
- All `/api/*` are protected except health, login, setup and auth status.
- `Origin` checks for write requests, login rate limiting.
- Password reset only from CLI (`pnpm memora:set-password`).
- No API tokens in v0.1.
- LAN HTTP allowed for home use; `Secure` can be enabled with
  `MEMORA_COOKIE_SECURE=true` when HTTPS exists.

### Consequences
- The Web UI is usable on LAN/Tailscale without directly exposing APIs.
- The first password must be set immediately after installation: whoever reaches
  the setup page first can choose it.
- If `auth.json` is lost, a shell reset or backup restore is required.
- There is no multi-user, OAuth, 2FA or permission management yet.

---
## ADR-035 — Unified chat side panel
**Date:** 2026-11-18
**Status:** accepted

### Context
Project chats and non-project chats used two different panels: the first with
Files/Context/Artifacts tabs, the second with stacked context, artifacts and web
sources. The Sources tab was unreachable in project chats, the panel opened
automatically only in some cases, and web sources did not refresh after a search.

### Decision
- A single `ChatSidePanel` with a fixed header and tabs: Files, Context, Artifacts,
  Sources.
- Files exist only in project chats; without a project, Context, Artifacts and
  Sources remain.
- Sources means web sources; indexed project sources remain a Context option.
- The panel is collapsed by default in every chat.
- On desktop (> 900px) it opens automatically on Sources when a new web source
  arrives and on Artifacts, with the new artifact detail, when an artifact is
  created. On mobile it does not auto-open.
- Immediate updates use Pi `tool_execution_end` events; a full turn-end refresh
  recovers artifacts generated after the answer (PDF, DOCX, XLSX, PPTX).
- Artifact selection is controlled externally to open the new artifact and is
  consumed only once.
- Each area has a counter, refresh and empty state; manual refresh is available.
- Active tab and open/closed state are not persisted across sessions: a new chat
  always starts collapsed.

### Consequences
- The panel is consistent between project and non-project chats.
- Auto-open is intentionally desktop-only to avoid covering chat on small screens.
- Web sources are always reachable, including inside projects.
- The panel depends on the client interpreting tool details; if an event contains
  no details, the turn-end refresh remains the fallback.

---
## ADR-036 — Numbered web sources and citations
**Date:** 2026-11-18
**Status:** accepted

### Context
Web sources were shown without a stable identifier and the model could cite URLs
or omit provenance. Citations had to remain consistent across successive searches
and after the 50-source limit.

### Decision
- Every `WebSource` has an optional `number`, assigned on first acquisition.
- The number is persisted in `memora.web-sources` together with `nextNumber`; a
  rediscovered source keeps its number, and numbers are not reused when older
  sources fall outside the limit.
- Legacy sources without a number are normalized on read.
- `web_search` and `web_fetch` return sources with `number` to the model; the
  system prompt requires every piece of information to be cited with `[n]` and
  multiple references when a sentence combines sources.
- The UI shows `[n]` in the Sources tab and turns `[n]` into clickable links in
  the answer, only for HTTP/HTTPS URLs.
- Citations inside code blocks are not converted into links.

### Consequences
- Citations remain consistent across turns and sources.
- The model must follow the format; if it does not, the answer is not artificially
  modified with invented sources.
- The 50-source limit remains, but numbers do not collapse.

---
## ADR-037 — Toolchain and dependency upgrade (November 2026)
**Date:** 2026-11-18
**Status:** accepted

### Context
The toolchain was frozen at versions resolved when the monorepo was created
(TypeScript 5.6, ESLint 9, Vitest 2, Vite 5, React 18, better-sqlite3 11, pnpm
12.18). We wanted to realign everything without breaking the Definition of Done
(`tsc --build`, `eslint`, `vitest run`, `pnpm build`) or intentional pins.

### Decision
Updated with verification at every stage:

| Package | From | To |
|---|---|---|
| pnpm (`packageManager`) | 12.18.0 | 12.21.0 |
| ESLint / `@eslint/js` | 9.39.5 | 10.15.0 / 10.0.1 |
| typescript-eslint | 8.72.2 | 8.73.0 |
| Prettier | 3.9.10 | 3.10.1 |
| Vitest | 2.1.9 | 5.1.0 |
| Vite | 5.4.21 | 8.3.8 |
| `@vitejs/plugin-react` | 4.7.0 | 6.3.0 |
| React / React DOM (+ types) | 18.3.1 | 19.3.1 |
| pdfjs-dist | 5.4.296 | 6.5.438 |
| better-sqlite3 (+ types) | 11.10.0 | 13.2.0 / 9.6.0 |
| `@fastify/static` | 8.3.0 | 10.1.11 |
| Fastify | 5.0.0 | 5.12.8 |
| `@types/node` | 24.19.2 | 26.6.6 |
| TypeScript | 5.6.0 range | 5.6.3 (range unchanged) |

Code adaptations required by the upgrade:
- ESLint 10 enables `no-useless-assignment` and `preserve-caught-error`: seven
  findings were fixed (redundant initializations removed, `new Error(...,
  { cause })` for the curator error). No rule was disabled.
- `@fastify/static` v10 passes the `FastifyReply` to `setHeaders`:
  `response.setHeader(...)` became `response.header(...)`, preserving asset
  cache-control semantics.
- pdfjs-dist v6 removes `PDFDocumentProxy.destroy()`: `PdfPreview` closes the
  document by destroying the loading task (`task.destroy()`).
- `apps/web` declares `"type": "module"` (Vite 8 loads config as ESM) and
  `vitest.config.ts` uses `import.meta.dirname` instead of `__dirname`.
- `pnpm-workspace.yaml`: `allowBuilds` aligned to `better-sqlite3@13.2.0` without
  which the native binding would not be built.

### Intentional pins
- `typebox` remains exact **1.3.27**: it is the exact dependency version of
  `@earendil-works/pi-coding-agent@1.5.2`. A bump would misalign tool schemas with
  the Pi runtime.
- TypeScript remains **5.6.x**: `typescript-eslint@8.73` declares support for
  `typescript >=4.8.4 <6.1.0` and hard-errors with TS 7; with TS 7.0.2,
  `tsc --build` also fails resolving `@types/pdfmake`. The major upgrade will
  resume when typescript-eslint supports TS 7.
- `pdfjs-dist`, `@huggingface/transformers`, `sqlite-vec` and `typebox` remain
  exact versions (artifact reproducibility and runtime alignment).

### Consequences
- `pnpm outdated -r` only reports the two intentional pins (`typebox`,
  TypeScript).
- Reproducible verification: `pnpm install && pnpm typecheck && pnpm lint &&
  pnpm test && pnpm build` (72 test files, 373 passing tests), `pnpm peers check`
  clean, `pnpm smoke:dist` green.
- The `better-sqlite3@13.2.0` binding works on Node 24 (SQLite 3.54.1).

---
## ADR-038 — Web source metadata and tooltips
**Date:** 2026-11-18
**Status:** accepted

### Context
The native citation tooltip showed only “Source n”, while the user wanted to
recognize site, title and content immediately without opening the source. The
`WEB` and `HTML` labels in the Sources tab did not explain the difference between
a search result and a read page.

### Decision
- `[n]` citations contain an HTML/CSS tooltip with domain, title and a short
  snippet; the tooltip appears on hover and keyboard focus.
- Metadata comes from `WebSource` and is passed to the Markdown renderer; text and
  attributes are always escaped.
- Sources tab labels become:
  - **Search**: search-engine result, not read yet;
  - **Read**: page fetched and read;
  - **PDF**: PDF read.
- A legend in the tab explains the labels.
- Read pages also store the real title and an initial excerpt; PDFs store an
  excerpt of the extracted text.

### Consequences
- The tooltip does not depend on JavaScript and remains available in the static
  UI.
- The tooltip is informative but does not replace opening the source.
- Old references without metadata remain plain `[n]` text.

---
## ADR-039 — Custom sections and tree sidebar
**Date:** 2026-11-18
**Status:** accepted

### Context
The sidebar used a project selector and a flat session list. The more familiar
mental model is sections → projects → sessions. Stable icons for sections and
projects were also needed without loading arbitrary SVGs.

### Decision
- Sections are persistent entities in
  `$MEMORA_DATA_DIR/config/project-sections.json`, with `id`, `name`, `icon`,
  `order` and timestamps.
- `project.json` accepts optional `sectionId` and `icon`; a project without a
  section appears under **No section**.
- Icons are a closed list validated server-side; no SVG or external files are
  loaded.
- The sidebar shows a tree of sections, projects and sessions. Sections and
  projects have independent open/closed state persisted in `localStorage`.
- Selecting a section opens it; selecting a project opens it and shows its
  sessions. The selected project no longer filters the entire list.
- Chats without a project are grouped under **Chats without project**.
- A project can be created from a section (`+`), and project settings allow
  changing section and icon.
- A section can only be deleted when it contains no projects.

### Consequences
- The sidebar is more familiar but requires a separate sections load.
- Section data is not stored in `project.json`: it must be included in data
  directory backups.
- A project orphaned by a missing section remains visible under **No section**.
- Open state is local to the browser and is not synchronized across devices.

---
## ADR-040 — Contextual actions and pinned chats
**Date:** 2026-11-18
**Status:** accepted

### Context
Inline rename, archive and delete buttons consumed space in sidebar rows and made
names too short. A more readable model and a way to pin important chats were
needed.

### Decision
- Row actions live in a vertical `⋮` menu, visible only on hover or focus; the
  trigger consumes no width in the name layout.
- Sessions: rename, archive/restore, delete and pin/unpin.
- Sections: new project, edit, delete.
- Projects: new chat, project settings.
- Pinned chats are local to the browser (`localStorage`) and sorted before other
  chats in the same group.
- The menu closes on outside click or `Escape`.

### Consequences
- Names have more space and the sidebar is less noisy.
- Pinning is not synchronized across browsers or devices.
- Destructive actions always remain two-step (menu + confirmation).

---
## ADR-041 — Automatic session titles
**Date:** 2026-11-18
**Status:** accepted

### Context
Pi uses `session_info` for the display name, but a new chat has no name until the
user renames it; the sidebar falls back to the first message, which is often long
and hard to read.

### Decision
- On the first turn an immediate deterministic local title is stored, with a
  “New chat” fallback.
- The same turn starts a background LLM title using the first user message and the
  first assistant answer (maximum 1200 characters each), without memory or
  attachments.
- The LLM title is stored with native `session_info` and a `memora.title` metadata
  entry with `source: auto`.
- `renameSession` writes `source: manual`; generation cannot overwrite a manual
  title.
- Generation happens only on the first completed turn, with a timeout and local
  fallback on error/provider unavailability.
- The LLM title can be disabled in **Administration → Chat**
  (`chat.autoTitleEnabled` in `settings.json`); the local fallback remains active.
  It is not an environment variable.
- An SSE `session_title` event updates the sidebar without polling.

### Consequences
- The sidebar shows a useful title from the first turn.
- Every new chat may make one small extra LLM call; the text sent is the first
  request + response exchange, without memory or attachments.
- If the first automatic title remains the fallback, it is retried on the next
  turn up to two attempts.
- A manual name always remains authoritative.

---
## ADR-042 — Background turns and queue
**Date:** 2026-11-18
**Status:** accepted

### Context
Turn execution was tied to the browser SSE connection. Switching chats or closing
the browser could leave work running without control, and there was no shared
state across sessions or devices.

### Decision
- A server-side `TurnManager` owns turns independently of the client connection.
- Maximum 2 concurrent global turns; others are queued.
- A session has one active turn; subsequent messages are queued, not injected
  into the running response.
- Browser disconnect does not stop a turn; only an explicit abort or server
  restart does.
- Events have a sequence and buffer to support reconnection; the client uses
  EventSource and resumes from `after` when chat becomes visible.
- `GET /api/turns` exposes synthetic state; the sidebar uses lightweight polling
  and shows yellow for turns running outside the active chat and green for
  completed unread answers.
- Synthetic turn state is persisted in `config/turns.json`; `running`/`queued`
  turns become `interrupted` after restart. Event content is not persisted.
- Superseded completed turns are removed from the in-memory map; failed/interrupted
  turns get a red sidebar indicator.

### Consequences
- The user can read one chat while another works.
- The browser can close during generation; the result is recovered on reopen.
- Concurrency and queue limits protect RAM, CPU and provider quota.
- Cross-device delivery may arrive with polling delay.

---
## ADR-043 — Background turn robustness (P2)
**Date:** 2026-11-18
**Status:** accepted

### Context
After the first background-turn release, five limitations remained: concurrency
was fixed, read state lived only in the browser, queued messages could disappear
after reload, there were no notifications, and tests covered the manager but not
the HTTP path with multiple clients.

### Decision
- Concurrency is configurable in **Administration → Chat** through
  `chat.maxConcurrentTurns` (integer 1–4, default 2). It is applied live through
  `TurnManager.setMaxConcurrent()` and does not use environment variables.
- Read state is persisted by the server in `config/turn-reads.json` with mode
  `0600`; localStorage remains an optimistic fallback. The map is
  `sessionId → turnId` and contains no conversation text.
- `TurnInfo.text` exposes request text in memory, so the UI can show queued
  messages immediately and after reload. `turns.json` does not persist that text:
  interrupted turns after restart stay without a duplicated prompt and
  authoritative content remains in JSONL.
- `GET /turns/current` returns the running turn when one exists, even if there is
  a queued request; `/api/turns` keeps exposing the latest turn per session.
- Notifications are opt-in browser notifications, with permission requested by an
  explicit gesture. They require the Memora tab to be open and are not push
  notifications. Telegram is not implemented and is not simulated.
- End-to-end HTTP tests start two SSE clients, verify closure at completion and
  replay of a completed turn; manager tests cover queue, abort, concurrency
  increase and restart.

### Consequences
- The administrator can adapt parallelism to available RAM without restarting the
  service.
- “Read” is consistent across browsers and devices, with an additional state file
  to include in backups.
- Browser notifications cannot reach a closed browser; future Telegram or Web Push
  integration can add external delivery.
- Polling may still arrive with about 2 seconds of delay.

---
## ADR-044 — Conservative automatic approval of new memories
**Date:** 2026-11-19
**Status:** accepted

### Context
Manual review of every Curator proposal was creating friction: many suggestions
were accurate and clearly worth keeping. Automatic approval of everything would
weaken the safety model, especially for updates that can replace or remove
existing knowledge.

### Decision
- Add `curator.autoApproveEnabled` (default **off**),
  `curator.autoApproveMinConfidence` (default **0.90**) and
  `curator.autoApproveMinSalience` (default **0.85**), editable in
  **Administration → Curator** and applied live.
- Auto-approval applies only to candidates with `action: "new"`, status
  `pending`, no duplicate or conflict match, no sensitive value or
  high-confidence PII, and both scores above the configured thresholds.
- The target must be global memory (`memory/…`) or the current chat project
  (`projects/<currentProjectId>/memory.md`). Cross-project writes are never
  automatic.
- Auto-approval uses the same target validation, Markdown write and reindex path
  as manual approval. The resulting candidate records `approvedBy: "auto"` and
  `autoApprovedAt`; an approval failure leaves the candidate pending.
- Updates, conflicts, duplicates and personal data always remain under manual
  review. Automatic approvals are visible in **Memory Inbox → Automatically
  saved** and remain auditable in the candidate store.
- No environment variable is introduced; this is an administrator preference.

### Consequences
- Common new facts can be retained without a manual click while risky changes
  stay protected.
- The thresholds can be tuned after observing real proposal quality.
- Automatic approval is not reversible from the inbox yet; memories can still be
  edited or removed from the Second Brain.
- A future phase may evaluate guarded auto-updates or one-click undo, but it is
  deliberately out of scope for this decision.

---
## ADR-045 — In-chat artifact downloads and manual visual review
**Date:** 2026-11-19
**Status:** accepted

### Context
Artifacts were reachable from the side panel, but the assistant response did not
offer a direct download. PDF and presentation quality also varied; a vision model
could evaluate layout, but the current metadata-only tools generate content only
after the tool call, so an in-turn preview is not available.

### Decision
- Artifacts carry an optional `sourceMessageId`, `sourceTurnId` and
  `sourceTimestamp`, stored in a sidecar under the artifact directory. New
  artifacts are associated with the current user message after the turn; later
  versions preserve the original association.
- Assistant messages show download cards for their artifacts. The card exposes
  name, version, size, open and download actions, with a fallback for legacy
  artifacts without source metadata.
- Add a manual **Review preview** action for PDF, HTML and PPTX when the active
  model reports image input support. The server renders a PNG preview (PDF.js for
  PDF, Chromium for HTML/PPTX), stores it as a chat image attachment, and starts a
  normal review turn with a visual checklist.
- The review turn may create a new version of the same artifact. The previous
  version remains available. There is no automatic review loop and no background
  visual QA in this milestone.
- DOCX and XLSX visual review are deferred until their preview renderers are
  available. The feature is opt-in per action and adds no tokens when unused.

### Consequences
- Users can download deliverables directly from the answer and reload without
  losing the artifact-message association.
- Visual feedback is controlled and auditable, and cannot silently rewrite an
  artifact.
- PDF review currently uses the first page; contact sheets for long PDFs and
  automatic review can be added later.
- Vision review depends on provider/model metadata and on Chromium/PDF.js being
  available on the server.

---
## ADR-046 — Visible reasoning during and after a turn
**Date:** 2026-11-19
**Status:** accepted

### Context
Some configured models expose `thinking`/reasoning blocks. The chat previously
discarded them, so the user could not follow a long reasoning phase and had no
feedback while waiting. The reasoning is already stored by Pi in the assistant
message transcript.

### Decision
- The SSE client reads `thinking_delta` events from Pi `message_update` payloads
  and accumulates reasoning separately from visible answer text.
- The UI shows a collapsed **Reasoning** panel with a live last-line preview;
  pressing it expands the full plain-text thought in a scrollable area that
  follows the stream.
- The panel is shown only for assistant messages and only when reasoning exists.
  It is never mixed into the answer Markdown or used as a memory candidate.
- Completed reasoning is extracted from Pi `thinking` blocks when loading
  session history, so it remains available after a reload or another device.
- Reasoning is treated as model output, not as an instruction or authoritative
  memory. It is not exported, indexed, or sent to the Curator as part of the
  answer.

### Consequences
- Users can follow the model's thought while waiting and inspect it later.
- The UI can expose sensitive content that the model chose to think about; it
  remains local to the authenticated chat and follows the session retention.
- Models that return no thinking deltas simply do not show the panel.

---
## ADR-047 — Reliable PDF previews and A4 pagination
**Date:** 2026-11-20
**Status:** accepted

### Context
`Rivedi anteprima` on a PDF could fail with HTTP 500. The process also uses
`pdf-parse` for PDF attachments and web pages. That library bundles PDF.js 5 and
`@napi-rs/canvas` 0.1.80, and leaves a `Path2D` class and a fake worker from that
version on `globalThis`. PDF.js 6 then received an incompatible canvas path
object or worker, producing a canvas `fill` TypeError.

HTML PDFs generated from one-page designs could also overflow the A4 height.
Chromium split a bordered card and its text across pages, leaving the lower half
of the text on a mostly empty second page.

### Decision
- PDF preview rendering saves the process PDF globals, installs the
  `@napi-rs/canvas` 1.1.1 `Path2D`/`DOMMatrix`/`ImageData`, removes the foreign
  fake worker, and restores the previous globals in `finally`.
- Preview rendering is serialized with a small in-process queue so two renders
  cannot swap globals concurrently.
- HTML PDF rendering injects print-only pagination CSS: headings stay with their
  following content, paragraphs/cards/tables avoid internal breaks, table
  headers repeat, and widows/orphans are limited. The CSS does not affect screen
  previews.
- The PDF prompt guidelines now ask for explicit multi-page blocks and
  `break-inside: avoid` on cards, callouts and tables instead of one overflowing
  `min-height: 297mm` container.

### Consequences
- `Rivedi anteprima` works after PDF text extraction or web-PDF parsing.
- Existing PDFs are unchanged; newly generated HTML PDFs move a card to the next
  page instead of cutting its text at the page boundary.
- CSS pagination cannot fix a design that is intrinsically taller than the
  available page area; the model must still design readable one-page or
  multi-page content.

---
## ADR-048 — Agent profiles as scoped session presets
**Date:** 2026-11-20
**Status:** accepted

### Context
Different chats need different expertise and methods (brainstorming, accounting,
coding, social media) while sharing the same project, memory and safety policy.
Loading every skill in every prompt would waste context and make behavior
unpredictable.

### Decision
- Profiles are file-based under `$MEMORA_DATA_DIR/agents/<id>/` with
  `agent.json`, `PROMPT.md` and optional `skills/<name>/SKILL.md`.
- The server seeds 15 examples (`brainstorming`, `commercialista`, `sviluppatore`,
  `social-media`, `tutor`, `avvocato`, `traduttore`, `scrittore`, `chef`, `viaggi`,
  `finanza`, `marketing`, `designer`, `ricercatore`, `business`). On an existing
  data directory only missing defaults are added once. Real profiles and personal
  data never live in the public repository.
- A profile adds an instruction block after the immutable Memora base prompt
  and before project instructions. It cannot change role policy, permissions,
  tools or memory rules.
- The full skills are not injected into the system prompt. The prompt lists
  names and descriptions; the `load_skill` tool loads one skill on demand,
  confined to the profile directory.
- The first message locks the profile. A session stores a prompt snapshot and
  the skill index in a `memora.agent` custom entry; the sidebar and composer
  show only the profile summary. Name, icon and color are resolved live from the
  current profile; **Refresh profile** explicitly applies a new prompt/skill
  catalog to an existing chat from the next message.
- New chats expose profile chips above the composer until the first turn.
  Selecting `Memo base` means no profile. After sending, the picker disappears
  and the selected profile is shown as a non-interactive colored icon beside the
  attachment and web controls. The same icon appears beside the session in the
  sidebar only for non-base profiles.
- Profiles do not add builtin tools. A coding profile can review pasted or
  attached code but cannot read the repository until a separate workspace/tool
  policy is designed.
- Administration → Agents edits the same files, validates IDs and moves deleted
  profiles/skills to `.trash/agents`; existing chats keep their prompt/skill
  snapshot, while name, icon and color are resolved from the current profile
  for display.

### Consequences
- Users can switch expertise per chat without duplicating projects or memory.
- Prompt cost stays bounded: profile instructions are small and skills are
  lazy-loaded.
- Existing chats keep their selected profile snapshot when the profile file is
  edited; changes apply to new chats. Removing a skill can make a later
  `load_skill` call fail without breaking the conversation.
- Profile files are administrator-controlled configuration. Imported or
  third-party profiles should be reviewed before use.

---
## ADR-049 — Explicit profile refresh and live display metadata
**Date:** 2026-11-20
**Status:** accepted

### Context
A chat keeps a profile snapshot so its prompt cannot change silently in the
middle of a conversation. This is correct for reproducibility, but users who
improve a profile may want to apply it to an existing conversation. Display
metadata such as name, icon and color, on the other hand, should not stay stale
just because the prompt is frozen.

### Decision
- Name, icon and color are resolved from the current profile when sessions are
  listed and resumed; the stored snapshot remains the fallback if the profile is
  removed.
- Prompt and skill catalog remain in the session snapshot.
- `POST /api/sessions/:id/agent/refresh` re-reads the same profile and replaces
  the session snapshot. It is rejected while a turn is streaming or if the
  session has no profile.
- The chat exposes **Refresh profile**, with an explicit confirmation dialog.
  The new prompt/skills apply from the next message and the transcript is
  unchanged.
- A `memora.agent` entry records the refresh in the Pi JSONL.

### Consequences
- Icon/name/color edits update existing chats immediately.
- Prompt/skill edits require an explicit refresh for existing chats.
- No chat changes behavior without the user's action.
- A deleted profile cannot be refreshed; the old snapshot continues to work.

---
## ADR-050 — Project-scoped archived chats
**Date:** 2026-11-20
**Status:** accepted

### Context
The global archived-sessions view forced users to leave the project context to
find an archived chat. In project-based workflows an archived chat should stay
attached to its project but disappear from the normal list unless requested.

### Decision
- Remove the global archived view and its sidebar toggle.
- `GET /api/sessions?includeArchived=true` returns active and archived sessions;
  `?archived=true` remains available as a compatibility filter.
- Add `showArchivedSessions` to the project configuration, default `false`.
- The project session list hides archived chats unless the project setting is
  enabled. When enabled, archived chats remain in the project with an archived
  visual state and the normal restore action.
- Archived chats without a project remain visible in “Senza progetto” so they
  can still be restored; there is no project setting to hide them.
- The project setting changes visibility only, not the session metadata or the
  model context.

### Consequences
- Archiving a project chat does not detach it from the project.
- Users can opt in per project to see archived chats without a global mode.
- Unprojected archived chats remain reachable.
- Older clients that use `?archived=true` keep working.

---
## ADR-051 — Central MCP account registry with project bindings
**Date:** 2026-11-20
**Status:** accepted

### Context
Notion and Todoist can have multiple accounts. Tokens must not be duplicated in
project files or exported with project data, while a project still needs to
select a dedicated account.

### Decision
- Maintain a central `config/mcp-accounts.json` with global and project-scoped
  account metadata.
- Store only `secretRef` values (`env:` or `secret:`); never the token.
- Project `project.json` stores `mcpAccounts` as server → account ID references.
- Global accounts are created in Administration → MCP; project-scoped accounts
  are created from project settings and stored in the same central registry with
  `projectId`.
- Account IDs are stable. Deleting an account does not silently fall back to a
  different identity.
- The first milestone implements the registry and bindings only; the MCP runtime
  that connects accounts, exposes tools and enforces read-only policies is a
  separate milestone.

### Consequences
- A project cannot leak a token through its JSON or export.
- Different projects can use different Notion/Todoist accounts.
- The UI can prepare accounts before the MCP runtime is enabled.
- Account deletion and runtime availability must be handled explicitly by the
  future MCP integration.

---
## ADR-052 — MCP token onboarding from the web UI
**Date:** 2026-11-20
**Status:** accepted

### Context
Requiring users to edit systemd environment files made the Notion/Todoist setup
too technical for a self-hosted installation.

### Decision
- The Admin MCP form accepts a masked token and stores it in
  `config/mcp-secrets.json` with mode `0600`, separate from account metadata.
- The account registry stores only `secret:mcp:<accountId>` references.
- The UI never receives the token back; it shows configured/missing status.
- **Test connection** calls the Notion/Todoist API with the token before or after
  saving.
- Project-specific accounts use the same token flow and keep only the account ID
  in `project.json`.
- `env:` references remain an advanced deployment override.

### Consequences
- A normal installation needs no systemd or environment-file editing.
- Tokens remain local to the data directory.
- The runtime MCP tool exposure is still a separate milestone.

---
## ADR-053 — Read-only MCP runtime with per-chat activation
**Date:** 2026-11-20
**Status:** accepted

### Context
Accounts and tokens were configurable, but no tools reached the agent. Loading
all Notion/Todoist tools by default would waste context and expose write
capabilities accidentally.

### Decision
- The server exposes a runtime account provider that resolves account metadata
  and tokens from the local registry/secret store.
- A generic `mcp_call` tool invokes the configured local MCP server (Notion or
  Todoist) for the active session.
- Only read tools are listed in the prompt and callable; names matching create,
  update, delete, append, move, complete, close, add, remove, set, write, edit,
  rename, duplicate, trash, patch or put are excluded.
- MCP is disabled by default. The chat right panel toggles servers per session;
  the selection is stored in `memora.mcp` and applies from the next message.
- Account resolution is explicit session binding → project binding → global
  default. Missing accounts fail closed.
- MCP results are treated as external data, not instructions.

### Consequences
- Notion/Todoist can be used without adding all tool schemas to every prompt.
- Writes require a future explicit policy and are not available now.
- The local server process is started on demand; packaging should later provide
  the MCP server binaries locally instead of relying on `npx`.

---
## ADR-054 — Per-chat opt-in for MCP writes
**Date:** 2026-11-20
**Status:** accepted

### Context
Read-only MCP was safe but prevented useful Notion/Todoist operations. Exposing
write tools by default would be dangerous for external data.

### Decision
- `McpSessionSettings` carries `allowWrites`, default false.
- The MCP panel exposes **Allow writes** with a confirmation dialog and a visible
  warning.
- When false, the prompt lists only read tools and `mcp_call` rejects write tool
  names. When true, all tools are exposed for the active servers.
- The model is instructed to ask explicit confirmation before destructive
  operations.
- The setting is persisted in `memora.mcp` and applies from the next message.

### Consequences
- Full Notion/Todoist workflows are possible without making writes the default.
- Writes are scoped to a chat and can be revoked at any time.
- Prompt-level confirmation is not a hard security boundary; stronger
  per-tool approval can be added later if needed.

---
## ADR-055 — Project-scoped Notion integrations as the default security boundary
**Date:** 2026-11-20
**Status:** accepted

### Context
A workspace-wide Notion integration gives an agent broad access and makes a
single mistaken write potentially affect unrelated pages. The hosted OAuth MCP
has broader user-level permissions, while the local token integration can be
scoped by Notion sharing.

### Decision
- Keep the local token-based Notion integration as the primary integration.
- For each project that needs isolated access, create a dedicated internal
  integration and share only the project root page/database with it.
- Store the account centrally as project-scoped and bind it in the project's
  MCP settings.
- Keep writes disabled by default and require the per-chat **Allow writes**
  confirmation.
- Evaluate a remote OAuth Notion account later for broad personal usage, but not
  as the default project isolation model.

### Consequences
- Project setup has a few explicit steps but provides two boundaries: Notion
  sharing and Memora account binding.
- A project token cannot read or modify unshared workspace content.
- A global account remains available for users who intentionally want broader
  access.

---
## ADR-056 — Headless, file-based automation scheduler
**Date:** 2026-11-20
**Status:** accepted

### Context
Scheduled activities must run with the browser closed. Reusing the browser turn
manager would make schedules depend on an open tab and would couple automation
state to the UI.

### Decision
- Run a single in-process scheduler inside the Memora server.
- Persist jobs in `$MEMORA_DATA_DIR/automations/jobs.json` and each run as a
  separate JSON file under `automations/runs/`.
- Execute one automation at a time, with a configurable timeout and limited
  retries.
- Reuse `AgentService` and the normal project/profile/MCP resolution, then
  archive the temporary session.
- Keep cron parsing and timezone handling in a small, tested module (`croner`).
- Mark runs left `running` by a restart as `interrupted`.

### Consequences
- No browser, external cron or queue service is needed for the normal
  single-server deployment.
- Multi-instance installations would need a distributed lock; this is not
  supported yet.
- Prompts and results are user data and must remain in the external data
  directory.

---
## ADR-057 — Telegram as outbound automation notification channel
**Date:** 2026-11-20
**Status:** accepted

### Context
Browser notifications require an open tab and cannot deliver results when the
user is away. Telegram is a simple, widely available external channel for a
single-user self-hosted assistant.

### Decision
- Implement Telegram outbound delivery only (Bot API `sendMessage`), not an
  inbound bot yet.
- Store the bot token separately in `config/telegram-secrets.json` (`0600`);
  never return it through the API.
- Store the non-secret chat ID in `config/telegram.json`.
- Allow `MEMORA_TELEGRAM_BOT_TOKEN` as an environment override; the UI marks it
  read-only.
- Let each automation opt in independently; Telegram failure never changes the
  run status.
- Support chat discovery through `getUpdates` after the user sends `/start`, and
  a test message from the admin panel.

### Consequences
- Scheduled results arrive without a browser and remain available in the web
  history.
- Telegram messages contain personal data; users must choose a bot/chat they
  control.
- An inbound Telegram chat interface remains a separate future milestone.

---
## ADR-058 — Automations as first-class sidebar objects
**Date:** 2026-11-20
**Status:** accepted

### Context
Managing automations only from Administration separated them from the project
and chat context in which they are used. Users need to create, open and inspect
them the same way they open chats.

### Decision
- Add a **New automation** button next to **New chat** in the main sidebar,
  with a two-thirds/one-third split on desktop.
- Group automations under their project, beside chats, and under **Automations
  without a project** when unassociated.
- Open an automation in the main workspace, where its editor, run history and
  Telegram settings live.
- Preselect the current project when creating from the top button; the project
  row menu can create one directly inside that project.
- Keep the existing `/api/admin/automations` API and hide the old Administration
  tab from the UI.

### Consequences
- Automations have a visible place in the same navigation model as chats.
- The project context is explicit before a run and in the sidebar.
- Telegram configuration remains in the automation workspace, not in general
  settings.

---
## ADR-059 — Reusable Telegram account registry
**Date:** 2026-11-20
**Status:** accepted

### Context
The first Telegram implementation stored one global token and chat ID. That did
not let the user create separate bots/chats in Administration and reuse them
from multiple automations.

### Decision
- Store Telegram accounts centrally in `config/telegram-accounts.json`; store
  their bot tokens separately by account ID in `config/telegram-secrets.json`
  (`0600`).
- Let each automation choose a `telegramAccountId`; missing selection falls back
  to the first enabled account for compatibility.
- Create and test accounts in **Administration → Telegram**; discover chats per
  account after `/start`.
- Migrate the legacy single `telegram.json`/`telegram-secrets.json` pair to a
  default account on load.
- Keep `MEMORA_TELEGRAM_BOT_TOKEN` only as an override for the legacy default
  account.

### Consequences
- One bot/chat can be shared by many automations without duplicating secrets.
- Deleting an account affects every automation that references it; those runs
  remain in history and record Telegram delivery as skipped.
- Per-account tokens preserve the least-privilege boundary between personal and
  project notifications.

---
## ADR-060 — Per-automation web search and live run history
**Date:** 2026-11-20
**Status:** accepted

### Context
Every automation inherited the chat default and web search was only a per-chat
setting. Operators need to decide independently whether an automation may
research the web. Run history was loaded only when opened, so long runs did not
update visibly.

### Decision
- Persist `webEnabled` on each automation, default false.
- Apply it to the temporary session before the prompt.
- Show the current web configuration state in the form and warn when it is not
  configured.
- Poll the selected run history every two seconds while the panel is open,
  without reloading the whole automation page.

### Consequences
- A job can be read-only and offline even when web search is available.
- Live history reflects queued/running/completed runs and new scheduled runs.
- The polling is local to the open history panel and stops on unmount.

---
## ADR-061 — Per-automation LLM model selection
**Date:** 2026-11-20
**Status:** accepted

### Context
Automations inherited the project/chat default model. Different scheduled tasks
need different trade-offs between cost, speed, context and reasoning.

### Decision
- Persist optional `provider`, `modelId` and `reasoningLevel` on each job.
- Pass them to `AgentService.createSession`; omitted values inherit the project
  or runtime chat default.
- Select provider and reasoning in the job form and load models from the normal
  provider catalog with the shared model combobox.
- Require a model when a provider is explicitly selected, avoiding ambiguous
  provider/model combinations.

### Consequences
- A cheap model can run routine summaries while a stronger model handles
  research or complex writing.
- Existing jobs and API clients remain compatible because all three fields are
  optional.
- Model credentials and catalog behavior remain those already configured in
  Memora.

---
## ADR-062 — Encrypted local snapshots with maintenance freeze
**Date:** 2026-11-20
**Status:** accepted

### Context
Memora has no disaster-recovery path. A backup must be consistent while the
server is writing SQLite and session files, but users should not need to stop
the service manually. A downloadable archive is also needed for non-developer
installations.

### Decision
- Create local snapshots from the running server, excluding large rebuildable
  assets (models, browser libraries, SearXNG data, runtime and trash).
- Enter a maintenance state before the snapshot, block new application
  requests and wait for existing turns/automations/writes to finish.
- Encrypt the archive with AES-256-GCM using a password chosen by the user;
  store the password locally with `0600` so automatic backups can run.
- Keep a manifest and SHA-256 checksum outside the archive; the archive itself
  contains the data and secrets.
- Default retention is four copies. Automatic schedules are opt-in, using a
  daily/weekly time and timezone.
- Restore is deferred to a clean installation or emergency CLI, not the running
  UI.

### Consequences
- A browser is not required for automatic backups, but the service must be
  running.
- A lost backup password means an unrecoverable archive.
- Remote upload and installer restore are follow-up milestones.

---
## ADR-063 — Mega remote backup via rclone, latest copy only
**Date:** 2026-11-20
**Status:** accepted

### Context
The backup is local-only. A remote copy protects against host loss, and Mega's
free 20 GB plan is enough for encrypted snapshots if only the latest is kept.

### Decision
- Use a dedicated rclone config under `config/rclone.conf` (`0600`) and a UI
  wizard for Mega credentials, optional 2FA and remote folder.
- Store the Mega password obscured in rclone config; never return it from the API.
- Upload the latest local archive and manifest with `rclone sync` to a dedicated
  remote folder, deleting older remote copies.
- Let auto-upload run after a successful local backup, following the local
  backup schedule.
- Keep local retention independent (default four copies).
- Require rclone on the host; the installer will provision it in a later
  milestone.

### Consequences
- One encrypted remote copy is available without exposing secrets to the
  application API.
- The remote folder is managed by Memora and may be emptied of old backup files.
- If rclone is missing or credentials expire, the backup remains local and the
  remote error is shown in Administration.

---
## ADR-064 — Update awareness from published releases only
**Date:** 2026-11-20
**Status:** accepted

### Context
The repository is private during development. The user wants a notification
when a new version is available, without being prompted on every push and
without automatic updates.

### Decision
- Compare the installed version with the latest **GitHub Release**, not the
  `main` branch or individual commits.
- Publish releases only from `v*.*.*` tags through a GitHub Actions workflow
  that verifies version, tests, build and smoke before creating the release.
- Poll at most every six hours; allow a manual check from Administration.
- Support `MEMORA_UPDATE_REPO`, `MEMORA_UPDATE_CHECK_URL` and an optional
  read-only `MEMORA_UPDATE_CHECK_TOKEN` for the private phase.
- Show release notes and notify the first enabled Telegram account once per
  tag. No automatic update is performed.

### Consequences
- Pushing to `main` never triggers an update prompt.
- Once the repository is public, the default GitHub endpoint works without a
  token.
- The actual `update.sh` remains a separate milestone.

---
## ADR-065 — Installer-owned lifecycle and restore before first start
**Date:** 2026-11-20
**Status:** accepted

### Context
A backup without a tested restore is not a disaster-recovery solution. Memora
also needs a reproducible Debian install and a safe update path for people who
do not work as developers.

### Decision
- Ship `install.sh` for Debian 13 + systemd with a service user, `/opt/memora`,
  `/var/lib/memora`, `/etc/memora` and an encrypted backup directory.
- Install the official rclone binary locally because the Debian package can lack
  the Mega backend.
- Offer restore during installation and through an emergency CLI; never restore
  from a running web UI.
- Require a pre-update local backup in `update.sh`; abort or roll back if it or
  the service health check fails.
- Update only from Git release tags, not from every push to `main`.
- Preserve existing environment files and never copy source secrets into the
  installed tree.

### Consequences
- Data must be restored with the service stopped.
- A source checkout without Git tags cannot use `update.sh`.
- The installer and updater are privileged shell operations, not web actions.

---
## ADR-066 — Local monitoring with deduplicated Telegram alerts
**Date:** 2026-11-20
**Status:** accepted

### Context
Backups, remote uploads and automations can fail silently while nobody is
looking at the administration page. Alerts must be actionable and not become a
source of repeated noise.

### Decision
- Run a local monitor every 15 minutes with a manual check from System.
- Observe disk usage, backup age/failure, remote upload error and failed
  automations.
- Keep alert state and settings in `config/` with `0600` permissions.
- Notify only newly active alerts, plus a recovery message when they clear.
- Send to the first enabled Telegram account; keep alerts visible in the UI when
  Telegram is unavailable.
- Never trigger models, backups or updates from the monitor.

### Consequences
- Failures are visible without keeping a browser open.
- Repeated identical alerts are suppressed.
- Total host outage still requires external uptime monitoring.

---
## ADR-067 — Readable export is separate from encrypted backup
**Date:** 2026-11-20
**Status:** accepted

### Context
Users need portability and inspectable data, while backup remains the
disaster-recovery mechanism with configuration and secrets.

### Decision
- Add a `.tar.gz` export containing Markdown memory, projects, sessions,
  agents, automations, artifacts and attachments.
- Exclude configuration, auth, provider credentials, MCP/Telegram tokens and
  the rebuildable index.
- Keep the newest five exports and expose creation/download/deletion in System.
- Import only into a clean data directory or during installation; never merge
  into a running instance.
- Require the user to reconfigure providers and integrations after import.

### Consequences
- Exports can be inspected with standard tools.
- They are not encrypted and contain personal data, so operators must protect
  them.
- Exact disaster recovery remains the encrypted backup/restore path.

---
## ADR-068 — Telegram inbound as a second client of the same agent
**Date:** 2026-11-26
**Status:** accepted

### Context

Telegram is currently outbound only: automations, monitoring and update notices
send messages, but the bot cannot receive a normal conversation. Users want to
continue the same Memora sessions from Telegram without maintaining a second
assistant, a second memory or a second session archive.

Three architectures were considered: a separate Telegram agent (rejected
because it duplicates memory and history), calling `AgentService` directly
(rejected for interactive turns because it bypasses the queue, turn state and
SSE stream used by the web UI), and adapting Telegram to `TurnManager`
(chosen). The transport choice was long polling versus a public webhook.

### Decision

- Treat Telegram as a client of Memora, not as a separate agent. Inbound turns
go through `TurnManager` and `AgentService`, producing normal Pi JSONL sessions.
- Use long polling by default with no public port. A webhook remains a later,
explicit option for deployments that expose HTTPS.
- Keep one persistent active session per paired Telegram user. Commands:
`/new`, `/sessions`, `/switch`, `/current`, `/rename`, `/stop`. Support private
chats only initially. Send the turn's PDF/Office artifacts and mark the turn as
read after a successful delivery.
- Authorize numeric Telegram user IDs through a one-time pairing code. Store the
code hashed with a ten-minute TTL and rate-limit failed attempts per user in
memory; never trust usernames or auto-pair the first sender.
- Store non-secret bridge state in `config/telegram-inbound.json` with mode
`0600`: allowlist, chat-to-session bindings, update offset and settings. Never
store message text or bot tokens there. Encrypted backups include the file;
readable exports exclude `config/`.
- Make the offset monotonic and deduplicate updates by `update_id`. The inbound
poller is the only consumer of `getUpdates`; chat discovery reads the poller
cache while inbound is enabled.
- Reply with the final text and typing indicator in the first milestone;
progressive message edits come later. Render a safe HTML subset, split at
4,000 characters, convert GFM tables to readable lists, and attach the full
Markdown when more than three chunks would be needed. Retry `429` responses
with `retry_after` and a bounded delay. Do not send hidden reasoning and do not
mirror web-originated turns to Telegram by default.
- Start disabled per account and enable it explicitly in Administration. One
Memora process may poll a bot token; a second process receives `409 Conflict`,
which is surfaced as an administrative error.
- Pause polling during backups, stop it before graceful shutdown, and mark
in-flight turns as interrupted with a single notice after restart.

### Consequences

- Web and Telegram share sessions, memory, projects and agent profiles with no
duplicate store.
- The web UI can show Telegram-originated turns through the existing turn state
and SSE infrastructure.
- Telegram retains messages on its servers; the channel is not end-to-end
encrypted by Memora. Updates older than Telegram's retention window are lost
while the bot is offline.
- Only one instance can poll a given token; distributed polling needs a future
coordination mechanism.
- Groups, topics, inbound attachments, progressive streaming and webhook mode
remain follow-up phases.

---
## ADR-069 — Opt-in per-chat mirroring of web turns to Telegram
**Date:** 2026-11-26
**Status:** accepted

### Context

The Telegram bridge already delivers turns started from Telegram, but a web
turn is not sent to Telegram. Users may start a long web chat and leave the
computer, expecting the answer on Telegram. A global mirroring switch would be
noisy and would send every web answer to the phone; the choice must be explicit
per chat.

### Decision

- Add a per-session share setting, disabled by default, exposed in the web chat
  composer next to the web/attachment tools.
- Store targets in `config/telegram-shares.json` (`0600`), not in session JSONL,
  so personal Telegram IDs do not end up in readable exports. Encrypted backups
  include the file.
- Offer two modes: `answers` (default, only the final assistant answer) and
  `full` (also the user prompt written in the web UI). Web attachments are not
  copied to Telegram.
- Tag turns with `source = web | telegram` in `TurnManager` and expose a
  terminal-turn observer. The mirror delivers only `web` turns; Telegram turns
  remain owned by the inbound bridge. This prevents duplicate delivery and
  loops.
- Resolve the target from the existing Telegram binding/allowlist; the client
  cannot submit arbitrary chat IDs. In `full` mode the selected chat becomes the
  active Telegram session so replies return to this chat.
- Send the final answer through the existing formatter, long-answer Markdown
  fallback and PDF/Office artifacts. After successful delivery mark the turn as
  read; on failure store a short `lastError` without conversation content.
- Serialize deliveries per session and include the mirror queue in backup
  `isIdle` and graceful shutdown.
- Do not add a global mirroring switch, a start notification or retry/outbox in
  this milestone.

### Consequences

- Users can explicitly receive web answers on Telegram without changing the
  default behavior of every chat.
- Web and Telegram have separate delivery paths but share the same sessions,
  history and read state.
- Full mode changes the active Telegram session; the UI must state this
  explicitly.
- A restart between turn completion and Telegram delivery can lose the copy;
  the authoritative answer remains in the web UI.
- Answers and artifacts may contain personal data and transit through Telegram,
  so the setting is opt-in and documented.

---
## ADR-070 — Telegram groups use forum topics as sessions
**Date:** 2026-11-26
**Status:** accepted

### Context

A Telegram bot has only one private chat per user, so multiple Memora sessions
cannot be separated in a DM. Groups with forum topics provide native threads
with names, per-topic history and direct links. They match the need for a fast
interface where each long-running chat is a separate topic.

### Decision

- Require a private supergroup with Topics enabled, with only the owner and the
  bot. The bot must be an administrator with permission to manage topics.
- Treat the group as a project/workspace and each topic as a Memora session.
  The General topic is the default session of the group.
- Keep the existing private-DM binding store unchanged. Add a dedicated
  `TelegramGroupStore` in `config/telegram-groups.json` (`0600`) for groups,
  General session, topic bindings and per-group defaults. No message text or
  tokens are stored.
- Use group-scoped pairing codes: a code generated for a group cannot pair a
  private DM, and vice versa. A group code authorizes the sender in the group
  allowlist only; it does not grant private-DM access. The group must be a
  forum; the bot must be an administrator with `can_manage_topics`.
- Make the Telegram transport thread-aware (`message_thread_id` for messages,
  documents, edits and typing) and add topic/group API methods.
- Keep the feature opt-in and limited to private groups with a single owner in
  the first version. Do not support arbitrary public groups or multi-user
  permissions.
- Plan web sharing and inbound group routing as separate milestones on top of
  this foundation.

### Consequences

- Topics are the natural session list: the title, link and history of a topic
  map to a Memora session.
- The DM bridge and share flows remain unchanged.
- A group member can read bot messages, so the group must be private and
  dedicated; the bot rejects unauthorized senders but cannot hide messages from
  group members.
- Privacy mode must be disabled to receive normal messages in topics, or every
  message must mention the bot. This is acceptable only in a dedicated private
  group.
- Bot administrator rights and topic limits are operational dependencies.

---
## ADR-071 — Inbound forum routing: General and one session per topic
**Date:** 2026-11-26
**Status:** accepted

### Context

The group foundation from ADR-070 needs deterministic routing. Telegram does
not expose a complete topic catalog to bots: a bot learns topic names from
service messages or from the first message carrying `message_thread_id`.
General is special and is the default conversation of the group.

### Decision

- Use General as the group’s default session, created lazily on the first
  message or command that needs it.
- Bind each secondary topic to one Memora session. Create the session and
  binding on `forum_topic_created` when the service message is received, or
  lazily on the first message if the service message was missed.
- Create a new topic and a new session only with `/new [titolo]` from General.
  Reject `/new` inside a secondary topic.
- Route all replies, typing, documents, edits and stop confirmations with the
  originating `message_thread_id`.
- Keep the group allowlist separate from the private-DM allowlist. Group
  pairing consumes a `group` code and never grants DM access.
- Sync a topic title only on `/rename`; manual topic edits update the registry
  title but do not rename the session. Automatic session titles never overwrite
  a topic title.
- Use `/sessions` to list General and the group topics, and `/switch N` to
  return the link to the selected topic. A topic remains a stable session
  boundary; switching does not silently rebind it.
- Validate at pairing time that the group is a private forum and that the bot
  is an administrator with `can_manage_topics`; validate that privacy mode is
  disabled. Each turn reuses the normal `TurnManager` and read state.

### Consequences

- A group can be rebuilt from Telegram state with lazy binding, without a
  database of topic titles.
- Topic renames, deletions and closed topics need separate hardening; stale
  bindings are cleaned when a Memora session is deleted.
- The group owner must keep the bot administrator and privacy mode disabled.
- The web UI admin panel lists groups and topics but session contents remain in
  the web UI/session storage, not in the group registry.

---
## ADR-072 — Project per topic with a group default
**Date:** 2026-11-26
**Status:** accepted

### Context

A Telegram forum has a flat list of topics. One group can either represent a
single project or host sessions from several projects. The project belongs to
the session, not to a Telegram topic hierarchy. Users who want visual separation
can still create one group per project.

### Decision

- Keep the group as the default project scope. General and new topics inherit
  `defaultProjectId` (`??` account inbound default).
- Store the resolved `projectId` on each secondary topic, not only on the group.
  `/new <project-id> <title>` creates a topic in another project. Manual topics
  use the group default.
- Treat the project of a session as immutable. Changing a group default or a
  topic project affects only new sessions; it never moves an existing session.
- The optional `[Project name]` topic prefix is presentation only. The source of
  truth remains `projectId`.
- Add a per-group `showProjectInTopicTitle` flag, enabled for newly paired
  groups and disabled for migrated groups. It applies to new topics and
  `/rename`; existing topics are updated only by an explicit **Sync titles and
  icons** action.
- General is never prefixed. Prefix length is bounded by Telegram's 128-character
  topic limit; the base title remains stored without the prefix.
- Manual topic title edits strip the known prefix and update the base title, but
  do not change the project. Project renames require a title sync.
- Multiple groups per Telegram account remain supported; each can have a
  different default project and prefix setting.

### Consequences

- One group can host sessions from several projects without inventing unsupported
  Telegram hierarchy.
- Users who prefer strict separation can use one group per project and disable
  the prefix.
- The title is not authoritative; UI and commands must display the project from
  metadata.
- Existing topics created before this change may not have a stored project; they
  are backfilled from the session project at startup when available, otherwise
  they fall back to the group default.
- Moving a session to another project requires a new session.

---
## ADR-073 — Group command menu and contextual help
**Date:** 2026-11-26
**Status:** accepted

### Context

Forum topics share a Telegram chat but have different context. Telegram's
native bot command menu supports scopes for private chats, all groups or a
specific chat, but has no scope for a forum topic. Users still need to discover
commands and understand General versus topic behavior.

### Decision

- Register a native group command menu with `setMyCommands` and the
  `all_group_chats` scope. It contains short descriptions for `/help`,
  `/commands`, `/projects`, `/new`, `/sessions`, `/switch`, `/current`,
  `/rename`, `/stop`, `/status`, `/ping` and `/start`.
- Accept `/help` and `/commands` in General and in secondary topics. The reply is
  sent in the originating thread and reports current topic, project, session,
  default project and prefix state.
- Explain in help that `/new` is available only from General and that `/switch`
  opens a topic link; do not pretend the menu is topic-specific.
- Do not implement inline callback menus in this milestone. They require
  callback-query authorization, state and extra API methods without improving
  basic discoverability.

### Consequences

- Every topic in a group sees the same short native menu; detailed help is
  contextual.
- The menu is refreshed when a Telegram account poller starts and after group
  pairing.
- If `setMyCommands` fails, the bot logs the failure but continues serving
  messages; `/help` remains available.
- A future inline keyboard can be added without changing the command semantics.

---
## ADR-074 — Default checkmark icon for forum topics
**Date:** 2026-11-26
**Status:** accepted

### Context

Telegram assigns a default forum-topic icon (the cloud shown by clients). The
project prefix is text and cannot replace the icon. Users asked for a consistent,
nicer icon on every secondary topic.

### Decision

- Query `getForumTopicIconStickers` for the account and choose a checkmark
  custom emoji when available, caching the selected custom emoji ID per account.
- Apply the icon when creating a bot-created topic, when binding a manually
  created topic, on `/rename`, and on the explicit **Sync titles and icons**
  action.
- Set the icon only on secondary topics; General keeps its native icon.
- Keep the existing project-title prefix and its per-group toggle unchanged.
- If the icon list or the custom emoji is unavailable, keep the Telegram default
  and log the condition; topic operations continue normally.
- Store no icon metadata in the group registry. Telegram is the display source;
  a later sync re-applies the default icon.

### Consequences

- Every topic managed by the bot gets the same checkmark icon unless Telegram
  does not provide it.
- Existing topics need one explicit sync after the change; new and renamed
  topics receive it automatically.
- The icon is presentation only and never changes project metadata or access.
- A bot/account token change clears the cached icon ID.

---
## ADR-075 — Per-topic agent profile with optional /new syntax
**Date:** 2026-11-26
**Status:** accepted

### Context

The project is already selectable per topic. Agent profiles are fixed when a
session is created, so choosing one later would not affect the running context.
Users need a compact way to choose both without adding callback-based menus.

### Decision

- Store `agentProfileId` on each secondary topic, resolved from:
  `topic override ?? group default ?? account inbound default`.
- Use the resolved profile when creating the session. It cannot be changed after
  the session has started; create a new topic/session instead.
- Extend `/new` in General with optional prefixes:
  `/new *<project-id> [agent] <title>`.
  `*` marks the project and `[agent]` accepts an ID or a case-insensitive profile
  name, including spaces. Both are optional; the title follows.
- Add `/agents` to list profile IDs/names and the native group command menu.
- Manual topics use the group defaults. Existing topics are backfilled from
  session metadata on startup when available.
- Invalid project/agent selections reject the command with an explanatory reply;
  no topic or session is created.
- Agent selection is display metadata in the group registry; the authoritative
  profile is still applied by the AgentService at session creation.

### Consequences

- One topic can select project and agent independently from the group defaults.
- The command remains readable without inline keyboards or callback state.
- Agent and project are immutable per session, matching session semantics.
- `/agents` and `/projects` expose the IDs needed by the syntax.
- Manual-topic overrides require creating the topic with `/new` instead.

---
## ADR-076 — Topic availability and bounded title/icon sync
**Date:** 2026-11-27
**Status:** accepted

### Context

A Telegram forum topic can be closed, reopened or deleted. A closed topic can
usually be read but not written; a deleted thread can make later sends and edits
fail. A bulk title/icon sync can also hit Telegram rate limits and should not
hide which topic failed.

### Decision

- Store an optional topic state (`open`, `closed`, `deleted`) in the group
  registry. Missing state means open for existing topics.
- Handle `forum_topic_closed` and `forum_topic_reopened` service messages and
  update the state without deleting the Memora session.
- Detect `TOPIC_CLOSED` and `message thread not found` errors when sending,
  editing or syncing. Mark the topic closed/deleted and stop treating the thread
  as writable.
- On the transition to deleted, send one notice in General: the session remains
  in the web UI and the user can create a new topic with `/new`.
- Return a per-topic sync result with `updated`, `failed`, `closed`, `deleted`
  and item-level errors. Deleted topics are skipped rather than retried.
- Add a configurable delay (250 ms by default) between edit requests; the
  Telegram client already retries `429` responses.
- Show closed/deleted state in the admin topic list; `/sessions` shows closed
  topics and excludes deleted ones.
- Do not automatically recreate a deleted topic; the user keeps control of the
  new topic title and placement.

### Consequences

- Closing and reopening a topic keeps the same Memora session.
- A deleted topic does not create an endless stream of failed sends.
- Bulk sync is slower but safer; the UI reports exactly which topics failed.
- Recreating a topic is explicit and loses the old Telegram thread, while the
  Memora session remains intact.

---
## ADR-077 — Archived sessions block Telegram turns instead of auto-replacing
**Date:** 2026-11-27
**Status:** accepted

### Context

Telegram used to replace an archived or missing bound session with a new session
automatically. From the user's point of view, archiving a chat in the web UI did
not stop the Telegram topic or DM from accepting new messages.

### Decision

- When the bound session is archived or no longer exists, do not create a
  replacement session implicitly.
- Reply with an explicit instruction:
  - DM: use `/new` or restore the session from the web UI;
  - group topic: create a new topic with `/new` from General or restore the
    session;
  - General: restore the session; a new topic can still be created from General.
- Keep the existing binding so the user can restore the same session in the web
  UI and continue in the same Telegram destination.
- `/new` remains the explicit way to create a new DM session or group topic.
- Deleted Telegram topics are a separate case: they are detected and removed from
  `/sessions`; the Memora session remains available in the web UI.

### Consequences

- Archiving a web chat now has an immediate, understandable effect on Telegram.
- No hidden sessions are created after archive/delete.
- Users must explicitly create a new session/topic after an archive, or restore
  the archived session from the web UI.
- A missing session binding can be repaired by restoring the session or by
  creating a new topic/session.
