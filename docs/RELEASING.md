# Releasing Memora

**English** | [Italiano](RELEASING.it.md)

Memora releases are GitHub Releases created from annotated Git tags. Only tags
matching `v*.*.*` trigger `.github/workflows/release.yml`; pushes to `main` run
CI but do not create a release.

## Checklist

1. Update `package.json` to the release version (for example `0.2.1`).
2. Move the `Unreleased` section of `CHANGELOG.md` under a dated
   `## [0.2.1] - YYYY-MM-DD` section and add the release link.
3. Add `docs/RELEASE-0.2.1.md` and `.it.md` with highlights, upgrade notes,
   documentation links and known limitations.
4. Update version references in `README.md`, `README.it.md`, `ROADMAP.md`,
   `docs/UPDATES.md`, `docs/UPDATES.it.md` and `.env.example`.
5. Run the full verification locally:

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   pnpm smoke:prod
   ```

6. Commit on `main` and push it:

   ```bash
   git push origin main
   ```

7. Create and push an annotated tag:

   ```bash
   git tag -a v0.2.1 -m "Memora v0.2.1"
   git push origin v0.2.1
   ```

8. The release workflow checks that `package.json` matches the tag, runs all
   checks and publishes a GitHub Release. The release body is read from
   `docs/RELEASE-<version>.md`; the file must exist before the tag is pushed.
9. Verify the release from the public API:

   ```bash
   curl -s https://api.github.com/repos/lian84/memora/releases/tags/v0.2.1
   ```

10. Verify the installer/update path on a clean or disposable VM before
    announcing the release.

## Notes

- The tag and package version must match exactly, without the `v` prefix.
- Do not move or reuse a published version tag.
- Release notes are part of the repository documentation and must be written
  before tagging.
- The update helper is not required for the release workflow; it applies
  published releases to an existing installation.
