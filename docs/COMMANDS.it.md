# Comandi

Comandi utili per sviluppo, test e operazioni.

```bash
pnpm install          # installa le dipendenze del monorepo
pnpm dev              # development: backend Fastify su :3000
pnpm build            # build backend + frontend React
pnpm start            # production: Fastify serve API + React su :3000
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm typecheck        # TypeScript strict
pnpm test             # Vitest
pnpm smoke:dist       # smoke dei moduli compilati
pnpm smoke:prod       # smoke del runtime production completo
pnpm embeddings:setup     # download esplicito e verifica offline del modello
pnpm embeddings:benchmark # benchmark sintetico locale (richiede setup)
pnpm eval:memory          # valutazione memoria: lexical, più semantic/hybrid se disponibili
pnpm eval:memory:check    # confronto con evaluation/baseline.json
pnpm memory:metadata:migrate # dry-run metadata dei bullet legacy
pnpm memory:history:prune  # dry-run retention delle versioni superate
pnpm memory:integrity      # controllo read-only di indice, metadata e Inbox
pnpm memory:consolidate    # audit read-only delle memorie attive simili
pnpm memory:consolidate:llm # report LLM read-only su duplicati/conflitti
pnpm memory:feedback      # tuning advisory delle soglie
pnpm projects:migrate     # dry-run project.json per i progetti legacy
```

Variabili d'ambiente (vedi `.env.example`). Le variabili Memora usano il prefisso `MEMORA_*`; le credenziali provider e `NODE_ENV` mantengono i nomi standard.
- `NODE_ENV` (`development` oppure `production`)
- `MEMORA_HOST` (default `127.0.0.1`)
- `MEMORA_PORT` (default `3000`)
- `MEMORA_DATA_DIR` (default `./data`)
- `MEMORA_WEB_DIST_DIR` (opzionale): override della build frontend servita in production
- `MEMORA_ASSISTANT_CWD` (opzionale): CWD isolato delle sessioni personal assistant
- `MEMORA_MEMORY_SEARCH_MODE`: `lexical` (default), `semantic` o `hybrid`.
- `MEMORA_MEMORY_TOP_K` (default `5`), `MEMORA_MEMORY_MAX_CHARS` (default `4000`) e `MEMORA_MEMORY_MAX_TOKENS` (default `1000`, stima `caratteri/4`): limiti del contesto memoria per turno.
- `MEMORA_MEMORY_DIVERSITY` (default `0.15`, `0..1`): penalità di similarità per evitare chunk ridondanti.
- `MEMORA_EMBEDDINGS_ENABLED` (default `false`): carica e indicizza embeddings locali, necessari per `semantic` e `hybrid`.
- `MEMORA_HYBRID_SEARCH_ENABLED` è legacy: `true` seleziona `hybrid` solo se `MEMORA_MEMORY_SEARCH_MODE` non è impostata; la modalità esplicita ha sempre precedenza.
- `MEMORA_EMBEDDING_MODEL` (default `Horizon-Labs/multilingual-embedding-small`) e `MEMORA_EMBEDDING_DIMENSIONS` (default `1024`).
- `MEMORA_MEMORY_CURATOR_ENABLED` (default `false`): abilita il Curator LLM opzionale; `MEMORA_MEMORY_CURATOR_AUTO` (default `true`) abilita le proposte automatiche.
- `MEMORA_MEMORY_CURATOR_PROVIDER` (default `openrouter`) e `MEMORA_MEMORY_CURATOR_MODEL` (default vuoto): provider e modello indipendenti da quelli della chat; `MEMORA_MEMORY_CURATOR_MIN_CONFIDENCE` (default `0.75`) e `MEMORA_MEMORY_CURATOR_MIN_SALIENCE` (default `0.70`) sono soglie separate.
- `MEMORA_MEMORY_QUEUE_MAX_ATTEMPTS` (default `3`) e `MEMORA_MEMORY_QUEUE_RETRY_DELAY_MS` (default `5000`): retry della coda Curator durevole.
- `OPENCODE_API_KEY` e `OPENROUTER_API_KEY`: credenziali provider lette dal secret store locale o dall'environment.
- `MEMORA_CHAT_PROVIDER`: `openrouter` o `opencode-go`; `OPENROUTER_MODEL` resta il nome storico della variabile per il modello chat predefinito. La UI Impostazioni permette di scegliere provider, modello, chiave e livello reasoning.
- `MEMORA_CHAT_REASONING_LEVEL` (default `medium`) e `MEMORA_MEMORY_CURATOR_REASONING_LEVEL` (default `low`): livelli `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

Le variabili di configurazione runtime hanno precedenza su
`$MEMORA_DATA_DIR/config/settings.json`. Un valore impostato dall'ambiente è
mostrato come bloccato nella pagina Impostazioni. Il pannello è organizzato in
pagine: Aspetto, Generale, Chat, Memoria, Curator, Web e Sistema. Embeddings e
dati/provider sono raggruppati nelle pagine Memoria e Sistema.
Token budget e diversità sono modificabili da **Memoria** e si applicano live.
La pagina **Aspetto** gestisce tema chiaro/scuro/sistema, dimensione del testo,
densità, larghezza conversazione e movimento ridotto. Queste preferenze sono
locali al browser (`localStorage`), non vengono inviate al server e si applicano
subito. La sidebar è comprimibile con il pulsante nella topbar o `Ctrl+B`.
- `MEMORA_MEMORY_WRITER_ENABLED` (default `false`): abilita l'estrazione
  automatica conservativa dei candidati memoria. Le richieste esplicite
  (“ricorda che…”, “salva questa informazione…”) funzionano comunque.
