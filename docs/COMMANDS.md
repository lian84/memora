# Commands

Useful development, test and operations commands.

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
- `MEMORA_TELEGRAM_BOT_TOKEN` (optional): Telegram bot token for automation
  notifications; normally configured in Administration → Telegram
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
