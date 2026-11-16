# Valutazione della memoria

Questa directory contiene dataset sintetici, baseline versionate e la
documentazione della harness di valutazione. Non contiene memorie personali,
sessioni, segreti o dati runtime.

## Cosa misura

- **Retrieval**: Recall@k, Precision@k, MRR, nDCG@k, latenza e dimensione media
  del contesto.
- **Curator**: classificazione `NEW`, `UPDATE`, `DUPLICATE`, `CONFLICT`, `NONE`,
  update intent, precisione/recall/F1 per classe, falsi positivi, falsi negativi,
  casi rifiutati ed errori.
- **Modalità**: lessicale, semantica e ibrida, separate.

## Dataset

### `retrieval.json`

46 query su 26 documenti sintetici in italiano. Copre:

- fatti stabili e preferenze;
- memoria storica e aggiornamenti temporali;
- duplicati formulati in modo diverso;
- documenti correlati ma non equivalenti;
- query ambigue;
- documenti lunghi con sezioni;
- identificativi esatti;
- query multi-hop.

Ogni query ha una o più evidenze gold:

```json
{
  "id": "vega-color",
  "query": "Qual è il colore identificativo di Vega?",
  "relevant": [
    {
      "id": "vega-color",
      "path": "projects/vega.md",
      "heading": "Identità",
      "terms": ["turchese"],
      "weight": 3
    }
  ]
}
```

Il match avviene su path, heading opzionale e termini obbligatori. Il peso è
usato solo per nDCG.

### `curator.json`

15 casi sintetici con memoria esistente, turno utente, output provider atteso e
azione gold. La modalità `replay` verifica la pipeline di validazione e le
soglie senza rete. La modalità `live` interroga il provider configurato e misura
il modello reale.

## Comandi

```bash
# Automatico: lexical; semantic/hybrid se il modello è presente
pnpm eval:memory

# Solo lessicale, senza embeddings
pnpm eval:memory -- --modes=lexical

# Modalità complete (richiede pnpm embeddings:setup o MEMORA_DATA_DIR)
MEMORA_DATA_DIR="$MEMORA_DATA_DIR" pnpm eval:memory -- --modes=semantic,hybrid

# Verifica regressioni rispetto a evaluation/baseline.json
pnpm eval:memory:check

# Parametri di retrieval
pnpm eval:memory -- --top-k=5 --max-chars=4000 --json=evaluation/latest-report.json

# Curator replay offline
pnpm eval:memory -- --modes=lexical --curator=replay
```

`eval:memory` compila `@memora/memory` prima di eseguire lo script. Il report
completo per query può essere scritto con `--json`; il file è ignorato da Git.

### Curator live

La modalità live è esplicita e invia soltanto i casi sintetici del dataset al
provider configurato:

```bash
MEMORA_DATA_DIR="$MEMORA_DATA_DIR" \
MEMORA_MEMORY_CURATOR_PROVIDER=opencode-go \
MEMORA_MEMORY_CURATOR_MODEL=beam-free \
MEMORA_MEMORY_CURATOR_REASONING_LEVEL=low \
pnpm eval:memory -- --modes=lexical --curator=live
```

La credenziale viene letta dall'environment oppure da
`$MEMORA_DATA_DIR/config/secrets.json`; non viene mai stampata. La baseline non
può essere scritta in modalità live, perché il modello non è deterministico.

Misurazione esemplificativa con OpenCode Go / `beam-free` sullo stesso dataset
sintetico (una singola esecuzione, non baseline):

| Reasoning | Accuracy | Macro F1 | Update intent | Errori |
|---|---:|---:|---:|---:|
| low | 86.7% | 0.564 | 100% | 0 |
| high | 73.3% | 0.564 | 100% | 1 |

Il livello più alto non ha migliorato la classificazione in questa singola
misurazione. I risultati live sono indicativi e vanno ripetuti e aggregati prima
di qualsiasi decisione di tuning.

## Baseline

`baseline.json` è la baseline versionata. Il controllo predefinito usa una
tolleranza assoluta di `0.02` sui metrici di qualità del retrieval e del Curator.
La latenza viene misurata ma non usata come gate, perché dipende dalla macchina.

Baseline corrente, `topK=10`, modello locale
`Horizon-Labs/multilingual-embedding-small` (1024 dimensioni, q8):

| Modalità | Recall@10 | nDCG@10 | MRR | P95 | Token stimati |
|---|---:|---:|---:|---:|---:|
| lexical | 98.6% | 0.914 | 0.896 | 0.45 ms | 134 |
| semantic | 98.6% | 0.981 | 0.989 | 30.7 ms | 126 |
| hybrid | 99.6% | 0.959 | 0.953 | 30.4 ms | 138 |

I token sono una stima (`caratteri / 4`) del solo contenuto dei chunk, non un
conteggio del tokenizer del provider e non includono JSON, metadati o system
prompt. La latenza include il costo dell'embedding della query.

### Effetto di topK

Stessi dati, senza Curator:

| topK | Modalità | Recall@10 | nDCG@10 | MRR | Token stimati |
|---:|---|---:|---:|---:|---:|
| 3 | lexical | 92.8% | 0.888 | 0.888 | 41 |
| 5 | lexical | 95.7% | 0.902 | 0.892 | 68 |
| 10 | lexical | 98.6% | 0.914 | 0.896 | 134 |
| 3 | semantic | 98.6% | 0.981 | 0.989 | 42 |
| 5 | semantic | 98.6% | 0.981 | 0.989 | 69 |
| 10 | semantic | 98.6% | 0.981 | 0.989 | 126 |
| 3 | hybrid | 97.5% | 0.948 | 0.953 | 41 |
| 5 | hybrid | 97.5% | 0.948 | 0.953 | 69 |
| 10 | hybrid | 99.6% | 0.959 | 0.953 | 138 |

`topK=3` riduce molto il contesto ma penalizza il retrieval lessicale. Il
semantico mantiene la recall perché i chunk rilevanti sono già in testa.

Con `maxChars=4000` la baseline non cambia, perché i chunk del dataset sono
piccoli; il limite verrebbe esercitato da documenti molto più lunghi.

### Curator replay

Baseline con soglie `minConfidence=0.75`, `minSalience=0.70`:

| Metrica | Valore |
|---|---:|
| Accuracy | 93.3% |
| Macro F1 | 0.960 |
| Update intent accuracy | 80.0% |
| Rifiutati | 1 |
| Falsi positivi | 0 |
| Falsi negativi | 1 |

Il caso `augment-drops-fact` è volutamente un falso negativo: il provider
propone un AUGMENT che perde un fatto esistente e la validazione lo rifiuta.

Effetto delle soglie sullo stesso replay:

| Soglie | Accuracy | Macro F1 | Update intent | Rifiutati |
|---|---:|---:|---:|---:|
| 0.75 / 0.70 | 93.3% | 0.960 | 80.0% | 1 |
| 0.90 / 0.70 | 86.7% | 0.744 | 80.0% | 2 |
| 0.75 / 0.90 | 46.7% | 0.271 | 0.0% | 8 |

Le soglie troppo alte riducono i falsi positivi ma eliminano aggiornamenti
legittimi. La taratura va fatta sul corpus reale, non solo su questi casi.

## CI

`pnpm test` esegue:

- test delle metriche;
- replay completo del dataset Curator;
- valutazione lexical del dataset retrieval;
- confronto con la baseline lexical a tolleranza `0.02`.

La modalità semantica/ibrida non è eseguita in CI senza il modello locale; lo
script la richiede esplicitamente. Il check completo si può eseguire su una
macchina con `MEMORA_DATA_DIR` configurata.

## Limiti

- Il dataset è sintetico e non sostituisce una valutazione su conversazioni
  reali anonimizzate.
- Le query sono state scritte insieme ai documenti: il rischio di overfitting
  è reale.
- La precision@k è bassa quando una query ha una sola evidenza gold su dieci
  risultati; non è un errore, ma va letta insieme a Recall e nDCG.
- La tokenizzazione è stimata, non misurata con il tokenizer del provider.
- La modalità live è non deterministica, ha costo e può cambiare tra provider,
  modello e reasoning.
- La baseline va aggiornata solo per modifiche intenzionali e con una nota nel
  commit o in `docs/DECISIONS.md`.
