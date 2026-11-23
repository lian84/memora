# Memory

Retrieval, Curator and the file-first memory model. See also [Memory data model](MEMORY-DATA-MODEL.md), [Memory lifecycle](MEMORY-LIFECYCLE.md), [Retrieval quality](MEMORY-RETRIEVAL-QUALITY.md) and [Memory security](MEMORY-SECURITY.md).

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
(16 examples including Brainstorming, Commercialista, Sviluppatore, Social
media and Suno Songwriter). A profile adds a scoped prompt and lazily loaded skills; it does not add tools or permissions.
If no profile is selected, Memo base is used. After sending, the picker
disappears and the selected profile icon remains next to the attachment and web
controls; the same icon appears beside the chat in the sidebar. Existing chats
can explicitly apply the current profile with **Refresh profile**. Profiles are file-based under `$MEMORA_DATA_DIR/agents` and can be managed from
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
