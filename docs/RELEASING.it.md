# Rilasciare Memora

**Italiano** | [English](RELEASING.md)

Le release Memora sono GitHub Release create da tag Git annotati. Solo i tag
`v*.*.*` avviano `.github/workflows/release.yml`; i push su `main` eseguono la CI
ma non creano release.

## Checklist

1. Aggiorna `package.json` alla versione della release (ad esempio `0.2.0`).
2. Sposta la sezione `Unreleased` di `CHANGELOG.md` sotto una sezione datata
   `## [0.2.0] - YYYY-MM-DD` e aggiungi il link della release.
3. Aggiungi `docs/RELEASE-0.2.0.md` e `.it.md` con novità, note di
   aggiornamento, link alla documentazione e limiti noti.
4. Aggiorna i riferimenti di versione in `README.md`, `README.it.md`,
   `ROADMAP.md`, `docs/UPDATES.md`, `docs/UPDATES.it.md` e `.env.example`.
5. Esegui la verifica completa:

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   pnpm smoke:prod
   ```

6. Committa su `main` e pusha:

   ```bash
   git push origin main
   ```

7. Crea e pusha un tag annotato:

   ```bash
   git tag -a v0.2.0 -m "Memora v0.2.0"
   git push origin v0.2.0
   ```

8. Il workflow di release verifica che `package.json` corrisponda al tag, esegue
   tutti i controlli e pubblica una GitHub Release. Il corpo della release viene
   letto da `docs/RELEASE-<versione>.md`; il file deve esistere prima del push del
   tag.
9. Verifica la release dall’API pubblica:

   ```bash
   curl -s https://api.github.com/repos/lian84/memora/releases/tags/v0.2.0
   ```

10. Verifica installer e aggiornamento su una VM pulita o usa-e-getta prima di
    annunciare la release.

## Note

- Tag e versione del package devono coincidere esattamente, senza prefisso `v`.
- Non spostare né riutilizzare un tag di versione pubblicato.
- Le note di release fanno parte della documentazione del repository e vanno
  scritte prima del tag.
- L’helper di aggiornamento non serve al workflow di release; applica le release
  pubblicate a un’installazione esistente.
