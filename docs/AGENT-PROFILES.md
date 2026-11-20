# Agent profiles

**English** | [Italiano](AGENT-PROFILES.it.md)

Agent profiles are scoped presets for a chat. They change role, method and
available skills; they do not change Memora's safety policy, memory scope or
tool permissions.

## Stored profiles

Profiles live in the runtime data directory, never in the repository:

```text
$MEMORA_DATA_DIR/agents/
└── commercialista/
    ├── agent.json
    ├── PROMPT.md
    └── skills/
        ├── iva/
        │   └── SKILL.md
        └── bilancio/
            └── SKILL.md
```

`agent.json`:

```json
{
  "version": 1,
  "id": "commercialista",
  "name": "Commercialista",
  "description": "Supporto a contabilità, bilancio e adempimenti.",
  "icon": "briefcase"
}
```

The icon must be one of the project icons (`briefcase`, `code`, `star`, `globe`,
`book`, `rocket`, and so on). `PROMPT.md` is added after the immutable Memora
base prompt. The `skills/` directory uses the Agent Skills format, with a
`SKILL.md` containing `name` and `description` frontmatter.

## Lazy skills

Only skill names and descriptions are added to the system prompt. The model can
call `load_skill("iva")` when a task matches. The tool reads only inside the
profile directory, with a size limit and path-traversal protection.

Skills are instructions, not executable extensions. A skill cannot add tools,
permissions or filesystem access.

## First use

When `$MEMORA_DATA_DIR/agents` does not exist, Memora seeds four examples:
Brainstorming, Commercialista, Sviluppatore and Social media. They are ordinary
files and can be copied, edited or removed.

To create a custom profile:

1. create `$MEMORA_DATA_DIR/agents/<id>/`;
2. add `agent.json` and `PROMPT.md`;
3. optionally add `skills/<skill>/SKILL.md`;
4. reload the page and choose the profile before the first message.

The first message locks the profile. Existing chats keep the prompt snapshot
stored in their Pi JSONL; editing a profile affects new chats.

## Security

- Only an administrator with access to the data directory should edit profiles.
- Never put API keys or personal secrets in `PROMPT.md` or `SKILL.md`.
- Review imported skills as configuration code; they can influence model output.
- Profiles cannot override the base safety prompt, evidence rules, memory
  policy, tools or permissions.
