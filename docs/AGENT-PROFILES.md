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
  "icon": "calculator",
  "color": "#0f8a6a"
}
```

The icon must be one of the project icons (`calculator`, `terminal`, `lightbulb`,
`megaphone`, `briefcase`, `code`, `star`, `globe`, and the other project
icons). The admin editor offers a fixed 10-color palette; `color` remains an
optional hex value for hand-edited files and defaults by profile id. `PROMPT.md`
is added after the immutable Memora base prompt. The `skills/` directory uses the Agent Skills format, with a
`SKILL.md` containing `name` and `description` frontmatter.

## Lazy skills

Only skill names and descriptions are added to the system prompt. The model can
call `load_skill("iva")` when a task matches. The tool reads only inside the
profile directory, with a size limit and path-traversal protection.

Skills are instructions, not executable extensions. A skill cannot add tools,
permissions or filesystem access.

## Admin editor

Open **Administration → Agents** to create, edit and move profiles to the trash. The editor covers metadata, icon, a fixed 10-color palette, prompt and skills; each skill has a name, routing description and Markdown instructions. Saving a profile updates the files under `$MEMORA_DATA_DIR/agents`.

Profiles already used by chats keep their prompt and skill snapshot. Their
name, icon and color are resolved from the current profile, so a change to those
visual fields updates existing chats too. Use **Refresh profile** in an existing
chat to apply a new prompt or skill catalog from its next message; the
conversation history remains unchanged. Deleting a profile moves its directory
to `.trash/agents`; it disappears from the new-chat picker without breaking
existing conversations.

Import/export of profile bundles is not part of this first editor.

## First use

Memora seeds 16 examples, including Brainstorming, Commercialista, Sviluppatore,
Social media, Suno Songwriter, Tutor, Avvocato, Traduttore, Scrittore, Chef,
Viaggi, Finanza personale, Marketing, Designer, Ricercatore and Business.

**Suno Songwriter** prepares original songs in a copy-ready Suno format: title,
style prompt, optional excluded styles, and lyrics with section tags. It knows
prosody, hooks, song structure and production-prompt constraints, and never uses
artist names or copyrighted material. On an existing data
directory, only missing defaults are added once; existing files are not
overwritten. They are ordinary files and can be copied, edited or removed.

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
