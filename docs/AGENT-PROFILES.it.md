# Profili agente

**Italiano** | [English](AGENT-PROFILES.md)

I profili agente sono preset circoscritti a una chat. Cambiano ruolo, metodo e
competenze disponibili; non cambiano la policy di sicurezza di Memora, la
portata della memoria o i permessi dei tool.

## Dove vivono

I profili stanno nella directory dati runtime, mai nel repository:

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

L’icona deve essere una di quelle dei progetti (`calculator`, `terminal`,
`lightbulb`, `megaphone`, `briefcase`, `code`, `star`, `globe` e le altre icone
dei progetti). L’editor admin offre una palette fissa di 10 colori; `color`
resta un valore esadecimale opzionale per i file modificati a mano e, se manca,
viene scelto in base all’id. `PROMPT.md` viene aggiunto dopo il prompt base
immutabile di Memora. La directory `skills/` usa il formato Agent Skills, con un
`SKILL.md` che contiene i frontmatter `name` e `description`.

## Competenze on demand

Nel system prompt finiscono solo nomi e descrizioni. Il modello può chiamare
`load_skill("iva")` quando il compito corrisponde. Il tool legge solo dentro la
directory del profilo, con limite di dimensione e protezione da path traversal.

Le competenze sono istruzioni, non extension eseguibili. Una competenza non può
aggiungere tool, permessi o accesso al filesystem.

## Editor in amministrazione

Apri **Amministrazione → Agenti** per creare, modificare e spostare nel cestino i
profili. L’editor gestisce metadati, icona, una palette fissa di 10 colori,
prompt e competenze; ogni competenza ha nome, descrizione per il routing e
istruzioni Markdown. Il salvataggio aggiorna i file in `$MEMORA_DATA_DIR/agents`.

Le chat che hanno già usato un profilo mantengono lo snapshot di prompt e
competenze. Nome, icona e colore vengono invece risolti dal profilo corrente,
quindi una modifica a questi campi visivi aggiorna anche le chat esistenti. Usa
**Aggiorna profilo** in una chat esistente per applicare il nuovo prompt o il
nuovo catalogo competenze dal messaggio successivo; la cronologia resta
invariata. L’eliminazione sposta la directory in `.trash/agents`; il profilo
sparisce dal selettore delle nuove chat senza rompere le conversazioni
esistenti.

Import/export di pacchetti profilo non fa parte di questo primo editor.

## Primo uso

Memora crea 16 esempi, tra cui Brainstorming, Commercialista, Sviluppatore,
Social media, Suno Songwriter, Tutor, Avvocato, Traduttore, Scrittore, Chef,
Viaggi, Finanza personale, Marketing, Designer, Ricercatore e Business.

**Suno Songwriter** prepara canzoni originali in formato copia-incolla per Suno:
titolo, prompt di stile, eventuali stili esclusi e testo con tag di sezione.
Conosce prosodia, hook, struttura e vincoli del prompt di produzione; non usa
nomi di artisti né materiale protetto. Su una data directory
esistente aggiunge una sola volta i default mancanti, senza sovrascrivere i file
presenti. Sono normali file, copiabili, modificabili o eliminabili.

Per creare un profilo personalizzato:

1. crea `$MEMORA_DATA_DIR/agents/<id>/`;
2. aggiungi `agent.json` e `PROMPT.md`;
3. aggiungi eventualmente `skills/<skill>/SKILL.md`;
4. ricarica la pagina e scegli il profilo prima del primo messaggio.

Il primo messaggio blocca il profilo. Le chat esistenti mantengono lo snapshot
del prompt salvato nel JSONL Pi; modificare un profilo vale per le nuove chat.

## Sicurezza

- Solo un amministratore con accesso alla data directory deve modificare i profili.
- Non inserire API key o segreti personali in `PROMPT.md` o `SKILL.md`.
- Tratta le competenze importate come configurazione: possono influenzare
  l’output del modello.
- I profili non possono sovrascrivere prompt base, regole sulle fonti, policy di
  memoria, tool o permessi.
