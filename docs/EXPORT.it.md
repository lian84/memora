# Esportazione dati leggibile

**Italiano** | [English](EXPORT.md)

Memora può esportare un archivio leggibile con conoscenza e cronologia
dell’utente, senza configurazione o segreti.

## Cosa viene esportato

- `memory/` — memoria Markdown;
- `projects/` — metadati, fonti e file di progetto;
- `agents/` — profili agente e competenze;
- `automations/` — job e cronologia;
- `memory-inbox/` — candidati e dati di audit;
- `pi-sessions/` — trascrizioni chat;
- `artifacts/` e `chat-attachments/` — documenti e allegati;
- `export-manifest.json` — formato, versione ed esclusioni.

L’archivio è un file `.tar.gz` e contiene dati personali: conservalo in un luogo
sicuro.

## Cosa non viene esportato

Configurazione e segreti:

```text
config/  (auth, API key provider, token Telegram/MCP, chiavi web)
index/   (indice SQLite ricostruibile)
models/, browser-libs/, searxng/, runtime/, backups/, tools/
```

Dopo l’import in un’installazione pulita bisogna completare il primo accesso e
riconfigurare provider e integrazioni.

## UI

In **Amministrazione → Sistema → Esportazione dati**:

- crea un export;
- lo scarica;
- elimina i vecchi export (vengono conservati i cinque più recenti).

## Import

L’import è limitato a una data directory vuota o all’installer. Non unisce mai
dati in un’installazione attiva.

```bash
node scripts/import-export.mjs \
  --file /percorso/memora-export-....tar.gz \
  --data-dir /var/lib/memora \
  --yes
```

Anche l’installer propone un passo di import. Non serve una password backup
perché l’export leggibile non è cifrato; deve essere protetto dall’operatore.

## Differenza dal backup

| Backup | Export |
|---|---|
| cifrato | leggibile |
| include config/segreti | esclude config/segreti |
| restore esatto | portabilità/migrazione |
| solo restore | import in installazione pulita |
