# Memora

**English** | [Italiano](README.it.md)

> Self-hosted, file-first personal AI assistant built on Pi.

[![CI](https://github.com/lian84/memora/actions/workflows/ci.yml/badge.svg)](https://github.com/lian84/memora/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

Memora is a self-hosted personal assistant built on
[Pi](https://github.com/earendil-works/pi). It brings persistent chats, a
Markdown-based Second Brain, human-reviewed memory, projects, artifacts and web
research into one interface.

The complete feature registry, with status and known limitations, is in
[`docs/FEATURES.md`](docs/FEATURES.md). Architectural decisions are documented
in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Status

Memora is in **pre-release development**. The code is usable and tested, but
installation and migrations are not yet considered stable. Do not expose the
service to the public Internet without HTTPS, a reverse proxy and a review of
your configuration.

## Key features

- Streaming chat, persistent Pi sessions and background turns.
- File-first Second Brain: authoritative Markdown and a rebuildable SQLite
  index.
- Optional local embeddings with semantic and hybrid retrieval.
- Memory Inbox with explicit approval by default and optional auto-save; optional LLM Memory Curator.
- Projects, indexed sources, project files and versioned artifacts.
- PDF, DOCX, XLSX and PPTX generation without LibreOffice.
- SSRF-safe web research through Brave or SearXNG, with numbered citations.
- Single-user login, browser notifications and an IT/EN/FR interface.
- Responsive layout, chat side panel and runtime administration.

## Requirements

- Node.js 24
- pnpm 12.21
- Debian 13 or a compatible distribution for the full runtime
- Optional headless Chromium for PDF rendering
- Optional local embedding model for semantic search

## Quick start

```bash
git clone https://github.com/lian84/memora.git
cd memora
cp .env.example .env
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000`, complete the first-run setup and configure the
provider, model and credentials in **Administration**.

Production build:

```bash
pnpm build
pnpm start
```

## Documentation

- [Features](docs/FEATURES.md) · [Italiano](docs/FEATURES.it.md)
- [Decisions](docs/DECISIONS.md) · [Italiano](docs/DECISIONS.it.md)
- [Architecture](ARCHITECTURE.md) (Italian)
- [Operations](docs/OPERATIONS.md) (Italian)
- [Security](docs/SECURITY.md) (Italian)
- [Roadmap](ROADMAP.md) (Italian)

The README, feature registry and decision log are maintained in English and
Italian. Some operational and security deep-dives are currently Italian-only.

## Design principles

1. Pi is the agent engine and remains an external dependency, not a fork.
2. Important memory remains readable as Markdown.
3. Sessions remain in Pi JSONL format.
4. Credentials never enter the repository.
5. The default deployment is local/LAN; public exposure requires HTTPS and an
   explicit configuration.
6. Memora must remain useful when models or frontends change.
7. Code, configuration, data and secrets are separate; runtime data lives in
   `MEMORA_DATA_DIR`.
8. No user- or machine-specific paths are hardcoded.

Responses can continue in the background: concurrency is configurable in
Administration (1–4, default 2) and additional turns are queued. Closing the
browser does not stop a turn; restarting Memora does. The sidebar shows a yellow
dot for a response running in another chat and a green dot for a completed unread
response. Read state is shared across devices, while browser notifications are
opt-in and require the tab to stay open (Telegram is not implemented yet).
Returning to a chat reconnects to events already produced and resumes partial
text. After a server restart, in-flight turns are marked as interrupted.

## Stack

- Debian 13
- Node.js 24 LTS
- TypeScript
- pnpm workspaces
- `@earendil-works/pi-coding-agent`
- Fastify
- React + Vite
- SQLite + FTS5
- Markdown as the authoritative source

## Commands

```bash
pnpm install          # install monorepo dependencies
pnpm dev              # development: Fastify backend on :3000
pnpm build            # build backend + React frontend
pnpm start            # production: Fastify serves API + React on :3000
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm typecheck        # strict TypeScript
pnpm test             # Vitest
pnpm smoke:dist       # smoke-test compiled modules
pnpm smoke:prod       # full production runtime smoke test
pnpm embeddings:setup     # explicit model download and offline verification
pnpm embeddings:benchmark # synthetic local benchmark (requires setup)
pnpm eval:memory          # memory evaluation: lexical, plus semantic/hybrid when available
pnpm eval:memory:check    # compare with evaluation/baseline.json
pnpm memory:metadata:migrate # dry-run metadata for legacy bullets
pnpm memory:history:prune  # dry-run retention of superseded versions
pnpm memory:integrity      # read-only index, metadata and Inbox check
pnpm memory:consolidate    # read-only audit of similar active memories
pnpm memory:consolidate:llm # read-only LLM report on duplicates/conflicts
pnpm memory:feedback      # advisory threshold tuning
pnpm projects:migrate     # dry-run project.json for legacy projects
```

Environment variables are documented in `.env.example`. Memora variables use
the `MEMORA_*` prefix; provider credentials and `NODE_ENV` keep their standard
names.

- `NODE_ENV` (`development` or `production`)
- `MEMORA_HOST` (default `127.0.0.1`)
- `MEMORA_PORT` (default `3000`)
- `MEMORA_DATA_DIR` (default `./data`)
- `MEMORA_WEB_DIST_DIR` (optional): override the frontend build served in production
- `MEMORA_ASSISTANT_CWD` (optional): isolated CWD for personal-assistant sessions
- `MEMORA_MEMORY_SEARCH_MODE`: `lexical` (default), `semantic` or `hybrid`
- `MEMORA_MEMORY_TOP_K` (default `5`), `MEMORA_MEMORY_MAX_CHARS` (default
  `4000`) and `MEMORA_MEMORY_MAX_TOKENS` (default `1000`, estimated as
  characters/4): memory context limits per turn
- `MEMORA_MEMORY_DIVERSITY` (default `0.15`, `0..1`): similarity penalty used to
  avoid redundant chunks
- `MEMORA_EMBEDDINGS_ENABLED` (default `false`): load and index local embeddings,
  required for `semantic` and `hybrid`
- `MEMORA_HYBRID_SEARCH_ENABLED` is legacy: `true` selects `hybrid` only when
  `MEMORA_MEMORY_SEARCH_MODE` is unset; the explicit mode always wins
- `MEMORA_EMBEDDING_MODEL` (default `Horizon-Labs/multilingual-embedding-small`)
  and `MEMORA_EMBEDDING_DIMENSIONS` (default `1024`)
- `MEMORA_MEMORY_CURATOR_ENABLED` (default `false`): enable the optional LLM
  Curator; `MEMORA_MEMORY_CURATOR_AUTO` (default `true`) enables automatic
  proposals
- `MEMORA_MEMORY_CURATOR_PROVIDER` (default `openrouter`) and
  `MEMORA_MEMORY_CURATOR_MODEL` (default empty): independent provider and model;
  `MEMORA_MEMORY_CURATOR_MIN_CONFIDENCE` (default `0.75`) and
  `MEMORA_MEMORY_CURATOR_MIN_SALIENCE` (default `0.70`) are separate thresholds
- `MEMORA_MEMORY_QUEUE_MAX_ATTEMPTS` (default `3`) and
  `MEMORA_MEMORY_QUEUE_RETRY_DELAY_MS` (default `5000`): durable Curator queue
  retries
- `OPENCODE_API_KEY` and `OPENROUTER_API_KEY`: provider credentials read from the
  local secret store or environment
- `MEMORA_CHAT_PROVIDER`: `openrouter` or `opencode-go`; `OPENROUTER_MODEL` is the
  historical variable name for the default chat model. The Settings UI lets you
  choose provider, model, key and reasoning level
- `MEMORA_CHAT_REASONING_LEVEL` (default `medium`) and
  `MEMORA_MEMORY_CURATOR_REASONING_LEVEL` (default `low`): `minimal`, `low`,
  `medium`, `high`, `xhigh`, `max`

Runtime configuration variables take precedence over
`$MEMORA_DATA_DIR/config/settings.json`. A value set through the environment is
shown as locked in Settings. The panel is organized into Appearance, General,
Chat, Memory, Curator, Web and System pages. Embeddings and data/provider
settings are grouped under Memory and System. Token budget and diversity are
editable under **Memory** and apply live. **Appearance** manages light/dark/system
theme, text size, density, conversation width and reduced motion. These
preferences are local to the browser (`localStorage`), are not sent to the
server and apply immediately. The sidebar can be collapsed with the topbar
button or `Ctrl+B`.

- `MEMORA_MEMORY_WRITER_ENABLED` (default `false`): enable conservative
  automatic memory-candidate extraction. Explicit requests (“remember that…”) and
  saving an assistant answer still work.

## Optional local semantic retrieval

Markdown remains the authoritative source; SQLite is a rebuildable index with
FTS5 for lexical search and sqlite-vec for local embeddings. RRF fuses the
rankings without directly combining BM25 and cosine scores. The default remains
FTS.

Set `MEMORA_DATA_DIR` outside the repository and run `pnpm embeddings:setup`
once: the q8 model is downloaded to `$MEMORA_DATA_DIR/models/` and verified
offline in a second process. Do not send private content to setup: it is the only
step allowed to use the network and it downloads only the model. The runtime
forbids remote downloads and generates embeddings locally. Set
`MEMORA_EMBEDDINGS_ENABLED=true`, choose `MEMORA_MEMORY_SEARCH_MODE=semantic` or
`hybrid`, restart and call `POST /api/memory/reindex` to build vectors
explicitly. A later reindex reuses unchanged vectors; if embeddings are disabled,
the model is missing or fails, the service warns and falls back to FTS. An
invalid mode produces a warning and uses FTS even when the legacy flag is
enabled. The startup log reports the effective mode. Loading requires
significant RAM; see `tasks/05.4-hybrid-rag.md`.

For diagnostics, `/api/memory/search?q=...&mode=lexical|semantic|hybrid` selects
the engine without changing the default. `pnpm embeddings:benchmark` creates a
temporary synthetic fixture and uses neither OpenRouter nor personal data.

## Optional Memory Curator

The Curator is disabled by default. To try it, explicitly configure provider and
model in Settings, or use `MEMORA_MEMORY_CURATOR_ENABLED=true`,
`MEMORA_MEMORY_CURATOR_PROVIDER`, `MEMORA_MEMORY_CURATOR_MODEL` and the matching
API key. Its model is separate from the chat model. **Privacy:** when enabled,
up to three short recent user messages, the current turn and up to five relevant
chunks are sent to the configured provider (OpenRouter or OpenCode Go); this is
not local processing. Secret checks are conservative and cannot guarantee that
every sensitive value is detected. Do not enable it if you do not want this
context sent to the provider.

After a meaningful turn: prefilter → configured memory search → one Curator call
→ validation and relevance → Memory Inbox → human approval → Markdown → reindex.
Short greetings are excluded locally; the semantic decision belongs to the LLM.
Explicit requests keep high priority and fall back to the previous Memory Writer
if the Curator fails. A failure does not interrupt the chat. If the Curator is
disabled, the Writer remains unchanged. When enabled, turns are queued after the
response, with one job processed at a time; the Inbox refreshes automatically
every three seconds. The queue is limited to 100 pending jobs, **in memory only**:
sudden crashes and forced restarts may lose them; at the limit new jobs are
rejected and a warning is emitted. Graceful shutdown waits for the queue before
closing SQLite, but a forced service-manager timeout can interrupt it.

Relevance is the average of five 0..1 values: importance, durability,
futureUtility, novelty and confidence; weights are initial and not calibrated.
Automatic proposals require confidence ≥ 0.75 and relevance ≥ 0.70 by default;
thresholds are configurable separately. High-confidence duplicates are skipped.
An UPDATE is proposed only when the current text exactly matches a bullet in the
related source; approval rechecks the bullet and rejects ambiguous or stale
changes. The Curator receives existing bullets and must classify the update as
`augment`, `replace`, `remove` or `correct`. `proposedText` is always the full
canonical final state, not a delta: for `augment`, the backend checks that earlier
facts survive and rejects an incomplete proposal. Only `replace`, `remove` and
`correct` may omit a previous value because the user explicitly invalidated it.
Automatic saving can be enabled in **Administration → Curator**. It applies only
to **new** candidates above separate confidence and relevance thresholds
(default 0.90 and 0.85), with no duplicate/conflict match, no sensitive content
or high-confidence PII, and a target in global memory or the current chat
project. Updates, conflicts, duplicates and personal data always remain under
manual review. Automatic approvals are recorded with `approvedBy: auto` and
listed in **Memory Inbox → Automatically saved**. Events and latency are logged
without turn text; the Curator adds at most one LLM call per meaningful turn.
Structured logs distinguish
request, response, parse, validation, decision and persistence, with HTTP status
and sanitized codes but no prompt, answer or chunk. OpenRouter receives
`reasoning.enabled=false`; OpenCode Go does not accept that parameter, so it is
omitted. The OpenCode model may still produce internal reasoning; a truncated
output is diagnosed without logging its content.

## Administration

The **Settings** icon in the sidebar opens runtime options without manual file
editing. Configuration is stored in `$MEMORA_DATA_DIR/config/settings.json` with
atomic writes, readable JSON, a versioned schema and mode `0600`. The file
contains only overrides and is created on the first save; existing installations
continue to work with defaults + environment and no automatic migrations.

Precedence: application defaults → `settings.json` → environment. Fields that
come from the environment are marked “Managed by the environment” and cannot be
edited in the UI. APIs are centralized under `/api/admin/*`:

```text
GET   /api/admin/settings
PATCH /api/admin/settings
GET   /api/admin/status
```

The **Chat** section lets you choose OpenRouter or OpenCode Go, save the key in
the local secret store, test the connection and search/select a model from the
real catalog. The new default applies to new sessions; existing sessions are not
changed. This section also toggles automatic titles for new chats; the local
fallback always remains available. The **Memory Curator** section selects a
separate provider and model and reuses the same provider key without asking for a
second one. The OpenRouter catalog uses the Pi catalog; OpenCode Go uses its
remote endpoint with a 10-minute cache and fallback to the Pi catalog.

Retrieval mode, topK/maxChars, Curator thresholds, reasoning, Curator
provider/model, Chat defaults, automatic titles and turn concurrency apply live;
embedding changes and enabling/disabling the Curator require an explicit restart.
The UI shows “Memora restart required” and never executes `systemctl` or sudo
commands. Lite and Standard presets show changes before applying them. Lite is
intended for 1–2 GB RAM VPS instances; Standard for hosts with at least 4 GB RAM.

Admin APIs are protected by single-user login. Keys are stored only in
`$MEMORA_DATA_DIR/config/secrets.json` (mode `0600`, atomic writes) or read from
the environment; `GET` returns only status and source, never the value. The
configuration is suitable for systemd, future Docker, VPS, Proxmox, mini PCs and
local installations, with no hardcoded paths beyond `MEMORA_DATA_DIR`.

## Login and access

On first start, if `$MEMORA_DATA_DIR/config/auth.json` does not exist, Memora
enters setup mode: application APIs remain blocked until the first password is
chosen. There is no username: Memora is personal and single-user. The first
password set wins, so complete setup immediately after installation.

- minimum password length: 12 characters;
- `scrypt` hash with a random salt;
- no plaintext password;
- `memora_session` cookie, `HttpOnly`, `SameSite=Lax`;
- 24-hour session;
- logout invalidates all sessions;
- all `/api/*` protected except `/api/health`, login, setup and auth status;
- rate limiting for failed logins;
- no API tokens in v0.1.

To reset the password, from the machine hosting Memora:

```bash
MEMORA_DATA_DIR=/path/to/data pnpm memora:set-password
```

The command asks for the new password without echoing it and replaces
`config/auth.json`. Restart Memora after the reset. If the service is reachable
over HTTP on the LAN, the cookie does not have the `Secure` flag; set
`MEMORA_COOKIE_SECURE=true` only when access uses HTTPS. Tailscale encrypts the
transport, but login remains required.

## Interface languages

The UI supports:

```text
Italiano
English
Français
```

The language is detected from the browser, stored in `localStorage` under
`memora-language` and can be changed from the selector in
**Administration → Appearance**. The fallback is English.

The dictionary lives in `apps/web/src/i18n/`: `it` is the source language, while
`en.ts` and `fr.ts` contain translations. To add a language, copy a dictionary
and register the code in `SUPPORTED_LANGUAGES`.

The UI language does not force Memo's answer language: the assistant replies in
the language of the user's message.

## Web search

Web access is **disabled by default**. Configure it in **Administration → Web**
by choosing Brave Search or SearXNG; the Brave key remains in
`$MEMORA_DATA_DIR/config/web.json` with `0600` permissions and is never returned
by the API.

In chat, the **Web** button next to attachments enables search for that session.
Sources appear in the **Sources** tab of the right side panel, together with
Files (project chats only), Context and Artifacts. The panel is closed by
default; on desktop it opens automatically on the relevant tab when a new search
arrives or an artifact is created.

Supported behavior:

- page search;
- HTML text extraction with Readability;
- text extraction from PDFs;
- numbered sources with clickable `[n]` citations in the answer;
- blocking private/local URLs, limited redirects, timeouts and size limits.

Web content is treated as **untrusted data**: it is never executed and cannot
change instructions, permissions or tools. `web_fetch` does not use JavaScript,
cookies or sessions.

Every source receives a stable number, shown as `[1]`, `[2]` in the Sources tab.
Memo must insert the reference immediately after each piece of information
obtained from the web; a sentence using multiple sources may write `[1][3]`.
References in the answer are clickable and open the matching source. Hovering or
focusing a reference shows the site, title and a short description. Numbers are
not reused when history exceeds 50 sources.

In the Sources tab:

- **Search** marks a search-engine result with title and snippet, but the page
  has not been read yet;
- **Read** marks a page actually fetched and read by Memo;
- **PDF** marks a PDF read and converted to text.

## Development

Two processes are required:

```bash
pnpm dev
pnpm --filter @memora/web dev
```

- Fastify: `http://127.0.0.1:3000`
- Vite: `http://127.0.0.1:5173`
- Vite proxies `/api` to the backend through `VITE_PROXY_TARGET`.

## Production

A single Fastify process:

```bash
pnpm build
pnpm start
```

`pnpm start` sets `NODE_ENV=production`, does not start Vite and does not use
`tsx`. Fastify serves:

```text
GET /api/*  → Memora API
GET /*      → React build + SPA fallback (index.html)
```

The Vite build is emitted to `apps/dist/web` (`apps/web/vite.config.ts`,
`outDir: ../dist/web`). Unknown APIs remain JSON `404`; missing assets remain
`404` and do not receive `index.html`.

## systemd service

Example unit: `deploy/memora.service`.

Suggested installation:

```bash
sudo cp deploy/memora.service /etc/systemd/system/memora.service
sudo systemctl daemon-reload
sudo systemctl enable --now memora
sudo systemctl status memora
```

Operational commands:

```bash
sudo systemctl restart memora
sudo systemctl stop memora
journalctl -u memora -f
```

The unit uses `User=memora`, `WorkingDirectory=/opt/memora` and
`EnvironmentFile=/etc/memora/memora.env` as a generic example. Adapt the user,
directory and environment file to the real deployment.

`systemd` does not expand `~`: `EnvironmentFile` must use an absolute path. Do
not write API keys into the unit. `NODE_ENV=production` is also forced in
`ExecStart`, because systemd lets `EnvironmentFile` override `Environment=`.

## Secure remote access

The default is `MEMORA_HOST=127.0.0.1`: the service is not automatically exposed
to the Internet.

From another computer, through SSH:

```bash
ssh -L 3000:127.0.0.1:3000 user@server
```

Then open `http://127.0.0.1:3000`.

Through Tailscale, use the same SSH tunnel to the Tailscale hostname or IP:

```bash
ssh -L 3000:127.0.0.1:3000 user@tailscale-name
```

Tailscale Serve is not configured by this project yet.

## Personal Assistant runtime

Normal Memora chats are personal-assistant sessions, not repository coding
agents:

- isolated CWD: `$MEMORA_DATA_DIR/runtime/assistant`
- built-in coding/filesystem tools disabled (`noTools: "builtin"`)
- no AGENTS.md, project skills, prompt templates, documentation or repository
  source code in context
- Second Brain memory and Memory Retrieval remain active
- explicitly configured custom/integration tools may remain active

Legacy sessions remain visible and resumable, applying the same isolated runtime
on resume.

The Personal Assistant responds naturally to decisions and preferences: it does
not ask for confirmation before saving, does not claim a memory is already
recorded and does not promise extra tools or research. Proposals are handled
separately by the Memory Curator and reviewed in the Memory Inbox. When a turn
contains a “Memory used” section, those sources are available as context.

## Memory

The trust boundary between memory, prompts and external providers is documented
in [`docs/MEMORY-SECURITY.md`](docs/MEMORY-SECURITY.md) (Italian).

Retrieval and Curator quality are measured with synthetic datasets and a
versioned baseline. Commands, metrics, results and limitations are in
[`evaluation/README.md`](evaluation/README.md) (Italian).

Every bullet written by Memora keeps provenance and version in a hidden HTML
comment; updates preserve the `superseded` history and the reindex indexes only
active versions. Format and migration:
[`docs/MEMORY-DATA-MODEL.md`](docs/MEMORY-DATA-MODEL.md) (Italian).

Internal JSONL and Markdown metadata keys use the `memora.*` and
`memora-memory:v1` namespaces.

The durable Curator queue, restart recovery and consolidation audit are described
in [`docs/MEMORY-CURATOR-ROBUSTNESS.md`](docs/MEMORY-CURATOR-ROBUSTNESS.md)
(Italian). Metrics, alerts, backup, restore and controlled degradation are in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) (Italian).

Projects are first-class entities. The sidebar is organized into **customizable
sections**; each section contains projects and each project contains its
sessions. Sections and projects have an icon and can be opened or closed
individually; state is remembered in the browser. Row actions are collected in
the vertical `⋮` menu, visible only on hover or focus. Chats can be pinned locally:
they stay at the top of their group and are remembered in the browser. The full
model is in [`tasks/05.9-projects.md`](tasks/05.9-projects.md) (Italian).

Sections are stored in `$MEMORA_DATA_DIR/config/project-sections.json`; each
`project.json` may contain `sectionId` and `icon`. Projects without a section
appear under **No section** and can be moved from project settings.

The plan for advanced HTML previews and lightweight Office artifacts
(DOCX, XLSX, HTML-first PPTX) is in
[`tasks/05.10-office-artifacts.md`](tasks/05.10-office-artifacts.md) (Italian).

### Project files and chat attachments

The **right side panel** is a single panel, closed by default and organized into
four fixed areas: **Files**, **Context**, **Artifacts** and **Sources**. The
Files tab appears only when the chat belongs to a project; web sources live in
Sources, while project sources remain under Context. Area counters update during
the turn. On desktop the panel opens automatically on Sources when a new search
arrives and on Artifacts, with the new file detail, when an artifact is created.
On mobile, auto-open is disabled.

The Files tab exposes the `projects/<id>/` directory with search, metadata and
previews for:

- Markdown and text;
- PDF through the browser viewer;
- HTML in a sandboxed iframe without scripts;
- Word `.docx`, converted to local HTML with Mammoth;
- Excel `.xlsx`, with read-only sheet previews;
- common images.

Uploaded `.pptx` files in project files remain downloadable but have no preview:
PPTX preview is available for presentations generated by Memora.

**Attach to chat** copies the file into the session attachments. The composer can
also upload files with the paperclip. Current limits: 8 attachments per message,
15 MB per file; `.md`, `.txt`, `.csv`, `.json`, `.pdf`, `.docx`, `.html`, `.htm`
and images. Text, PDF and `.docx` are extracted locally and passed to the model as
untrusted data in the transient system prompt; images are passed as image blocks.
Attachments are never executed.

When a chat belongs to a project, an uploaded file is also archived in
`projects/<id>/files/`: it becomes immediately visible in the project panel but
does **not** automatically enter memory or retrieval. The `files/` folder is
excluded from reindexing; promotion to a source remains a separate action.

Uploaded files live in `$MEMORA_DATA_DIR/chat-attachments/<sessionId>/` and are
removed when the session is deleted. Attachment metadata remains in the Pi JSONL
as the `memora.attachments` custom entry.

The **Context** tab enables global memory, project memory and project sources per
chat. The choice is stored in the session (`memora.context` custom entry) and
applies from the next message; it does not modify the project configuration.

The side panel can be expanded for larger previews. When a PDF/HTML artifact has
already been created, the HTML code in the answer is hidden and replaced by the
artifact reference. HTML previews use a shared component with Auto/Desktop/
Tablet/Mobile viewports, 50%–250% zoom, reload and opening of the original file,
always in a sandboxed iframe without scripts or network access.

The **Artifacts** tab lists deliverables created by the model. The
`create_artifact` tool produces Markdown, HTML, SVG, text, JSON, CSV or code
without executing Python. Artifacts live in
`$MEMORA_DATA_DIR/artifacts/<sessionId>/` and can be opened or downloaded;
HTML/SVG remains sandboxed. Each row offers download, delete and attach to the
next chat message. Opening an artifact shows its name and the **Variant** selector
(`v1`, `v2`, etc.) directly below **← Artifacts**. Next to **Open** are delete,
attach to chat and **Add to project**: Markdown/text is imported into the
project's indexed sources, other formats into `files/`. Deletion confirmation
uses a dedicated modal, not `window.confirm`. The preview offers 50%–250% zoom
controls.

Artifacts with the same name in the same chat are not duplicated: the previous
version is kept in `.versions/` and the UI shows `v1`, `v2`, etc. on the same
artifact.

Artifacts created in a turn are also shown as download cards directly inside the
assistant response, not only in the side panel. Each card is associated with its
source message, so the link remains correct after a reload. For PDF, HTML and
PPTX artifacts, a vision-capable model can be asked to **Review preview**: Memora
renders a PNG preview, sends it as an image attachment with the source context and
lets the model create an improved version. This action is manual and never starts
an automatic loop; the previous artifact version remains available.

### Agent profiles

Before the first message, the composer shows the available **agent profiles**
(Brainstorming, Commercialista, Sviluppatore, Social media). A profile adds a
scoped prompt and lazily loaded skills; it does not add tools or permissions.
If no profile is selected, Memo base is used. After sending, the picker
disappears and the selected profile icon remains next to the attachment and web
controls; the same icon appears beside the chat in the sidebar. Profiles are file-based under `$MEMORA_DATA_DIR/agents` and can be managed from
**Administration → Agents**; see
[`docs/AGENT-PROFILES.md`](docs/AGENT-PROFILES.md).

### Chat controls

- when the model exposes reasoning, a compact **Reasoning** panel shows a live
  preview and can be expanded to follow the full thought; completed reasoning is
  restored from the Pi transcript after a reload;
- every message has a **copy** button: plain text for the question, Markdown for
  the answer;
- questions have **Edit**: editing creates a new Pi branch, preserving history in
  the JSONL, and regenerates the answer;
- answers have **Regenerate** and **PDF**;
- the composer automatically returns to focus after a response.

PDFs use the `create_pdf` tool: it receives only title, format and filename, not
the document. After the call the model writes the document in the final answer
and Memora renders it server-side. With `format: "html"` the model can produce an
HTML page with CSS; Memora uses headless Chromium for faithful rendering and
`html-to-pdfmake`/`pdfmake` as a lightweight fallback. Alternatively, the **PDF**
button on an answer creates a PDF artifact from existing text without another
model call. An HTML/Markdown artifact can also be converted with **Export PDF**.
Initial limits: 30,000 Markdown characters, 60,000 HTML characters, 30 pages,
5 MB. The PDF never enters the model context.

The HTML renderer uses inline CSS and, when Chromium is available, also supports
complex layouts. The PDFMake fallback supports a CSS subset. PDF preview uses
PDF.js and does not depend on the browser PDF plugin.

With `create_docx` the model writes the document as Markdown in the final answer;
Memora generates a Word `.docx` and shows a semantic preview through Mammoth
without sending additional content to the model.

With `create_xlsx` the model writes one or more Markdown tables: each table
becomes an `.xlsx` sheet, the preceding heading becomes the sheet name, and the
preview shows tabs, headers and essential formatting without evaluating formulas.

With `create_pptx` the model writes an HTML deck with
`<section class="slide">` sections: the same HTML powers the preview and the
`.pptx` conversion through `jsdom` and `pptxgenjs`. Titles, paragraphs, lists,
tables and `data:` images are supported; complex CSS layouts remain visible in
the HTML preview but are not guaranteed in the PowerPoint file.

To prepare Chromium on Debian:

```bash
pnpm pdf:browser:setup
```

Libraries are saved in `$MEMORA_DATA_DIR/browser-libs/`. `MEMORA_PDF_BROWSER_LIBS`
or `MEMORA_PDF_BROWSER_PATH` can point to external paths. Without Chromium,
rendering continues with the PDFMake fallback.

API:

```text
GET  /api/projects/:id/files
GET  /api/projects/:id/files/content?path=...
GET  /api/projects/:id/files/preview?path=...
POST /api/projects/:id/artifacts
DELETE /api/projects/:id
POST /api/sessions/:id/attachments
POST /api/sessions/:id/attachments/from-project
POST /api/sessions/:id/attachments/from-artifact
GET  /api/sessions/:id/attachments/:attachmentId
DELETE /api/sessions/:id/attachments/:attachmentId
GET  /api/sessions/:id/context
PATCH /api/sessions/:id/context
GET  /api/sessions/:id/artifacts
GET  /api/sessions/:id/artifacts/:artifactId
GET  /api/sessions/:id/artifacts/:artifactId/preview
DELETE /api/sessions/:id/artifacts/:artifactId
POST /api/sessions/:id/artifacts/pdf
POST /api/sessions/:id/artifacts/:artifactId/pdf
```

Superseded versions, retention, deletion, backup and historical memory are
documented in [`docs/MEMORY-LIFECYCLE.md`](docs/MEMORY-LIFECYCLE.md) (Italian).

Token budget, filters, diversity and retrieval reranking are described in
[`docs/MEMORY-RETRIEVAL-QUALITY.md`](docs/MEMORY-RETRIEVAL-QUALITY.md) (Italian).

Conversation is not memory. After a turn, Memora can create one or more
`MemoryCandidate` entries and show them in the Memory Inbox. Pending candidates
are not indexed and do not modify the Second Brain. Only after approval is the
content written to a Markdown file under `MEMORA_DATA_DIR` and reindexed.

The sidebar exposes two separate icons: **Second Brain** and **Settings**. The
Second Brain page collects all global and project Markdown memories in one
place, with search, global/project filtering and direct Markdown editing. The
**Chat memory** panel at the bottom contains the Memory Inbox and links to
global/project memories; it is no longer the full Second Brain page.

An assistant answer can be explicitly promoted with the **Memory** button. The
answer becomes a candidate with `sourceKind: assistant` provenance; it is not
written automatically and always requires approval in the Memory Inbox.

- authoritative source: Markdown;
- rebuildable index: SQLite/FTS5;
- candidates/audit: `memory-inbox/candidates.jsonl`;
- no automatic unapproved writes;
- no secret is proposed or written automatically.

Approved memories can be opened, edited or deleted from the Second Brain section.
The client uses only the source ID: the backend resolves the file from the index,
validates the Markdown directory and atomically rewrites only the target file.
After edit/delete it reindexes, so search immediately sees the new content or its
absence.

Core files `memory/profile.md`, `memory/preferences.md` and
`memory/decisions.md` are editable; the UI does not show full deletion because
they can contain multiple memories. Deleting a single bullet is not implemented
yet.

## Contributing

Guidelines, development setup and the Developer Certificate of Origin are in
[`CONTRIBUTING.md`](CONTRIBUTING.md). Before a significant change, open an issue
to discuss the design.

## Security

Do not open public issues for vulnerabilities. Use GitHub private vulnerability
reporting; details are in [`SECURITY.md`](SECURITY.md).

## License

Memora is distributed under the terms of **AGPL-3.0-only**. Contributions are
accepted under the same license and require a DCO sign-off. The **Memora** and
**Memo** names are covered by [`TRADEMARKS.md`](TRADEMARKS.md); third-party
notices are in [`NOTICE`](NOTICE).
