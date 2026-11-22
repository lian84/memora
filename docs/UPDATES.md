# Update checks

**English** | [Italiano](UPDATES.it.md)

Memora checks **published GitHub releases**, not every push to `main`.
Development pushes remain development builds and never trigger an update
notification.

## Version model

- `currentVersion` comes from `MEMORA_VERSION` (set by the installer/release
  environment), falling back to the application version.
- `latestVersion` comes from the latest GitHub release tag, for example
  `v0.2.0`.
- An update is available only when the release tag is newer than the installed
  version.

## Release workflow

`.github/workflows/release.yml` runs when a tag matching `v*.*.*` is pushed:

1. checks that `package.json` version matches the tag;
2. typechecks, lints, tests and builds;
3. runs the production smoke test;
4. publishes a GitHub Release with generated release notes.

Pushing to `main` runs CI only. It does not publish a release and does not create
an update notification.

## Configuration

```bash
MEMORA_UPDATE_REPO=lian84/memora
MEMORA_VERSION=0.1.0
# Optional for a private repository or a proxy:
MEMORA_UPDATE_CHECK_URL=https://api.github.com/repos/lian84/memora/releases/latest
MEMORA_UPDATE_CHECK_TOKEN=github_read_only_token
```

The token is read from the environment only, is never returned by the API and
must be read-only. When the repository becomes public, no token is necessary.

The default endpoint is:

```text
https://api.github.com/repos/<repo>/releases/latest
```

The check runs at most every six hours. A manual check is available in
**Administration → System → Updates**.

## UI and notifications

- The Updates section under **System** shows current version, latest release, release notes and a
  link to GitHub.
- Telegram notification is optional and is sent once per release tag to the
  first enabled Telegram account.
- No automatic update, download, restart or `update.sh` execution happens from
  the web process.

## Private repository

GitHub returns `404` for a private release without authentication. Memora shows
“repository private or no public release” and simply keeps checking in the
background. Configure a read-only token or make the repository public.

## Updating

`update.sh` will create a backup, apply a published release and verify the
service. It is not implemented in this milestone.
