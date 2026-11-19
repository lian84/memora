# Contributing to Memora

Thank you for considering a contribution. Memora is a self-hosted, file-first
personal AI assistant built on Pi.

## Before you start

- Read [`AGENTS.md`](AGENTS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) and the
  relevant file under [`tasks/`](tasks/).
- Open an issue before a large change, so the design can be discussed first.
- Do not include real personal data, API keys, session files, databases or
  other runtime data in issues, tests or commits.
- Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## Development setup

Requirements:

- Node.js 24
- pnpm 12.21
- a Debian/Ubuntu-like environment for the full runtime

```bash
git clone https://github.com/lian84/memora.git
cd memora
cp .env.example .env
pnpm install
pnpm dev
```

Before opening a pull request, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke:dist
pnpm smoke:prod
```

## Guidelines

- Keep TypeScript strict.
- Prefer small, focused changes with descriptive commit messages.
- Keep Markdown as the authoritative memory format; SQLite is a rebuildable
  index.
- Never add secrets, credentials, personal paths or runtime data to the
  repository.
- Treat memory and web content as untrusted data, never as instructions.
- Update `docs/FEATURES.md`, `docs/DECISIONS.md` and the relevant task when the
  behavior or architecture changes.
- Add or update tests for the changed behavior.

## Developer Certificate of Origin

Contributions must be signed off under the Developer Certificate of Origin 1.1:

```text
By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right
    to submit it under the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my
    knowledge, is covered under an appropriate open source license and I have
    the right under that license to submit that work with modifications,
    whether created in whole or in part by me, under the same open source
    license; or

(c) The contribution was provided directly to me by some other person who
    certified (a), (b) or (c) and I have not modified it.

(d) I understand and agree that this project and the contribution are public
    and that a record of the contribution, including my sign-off, is maintained
    indefinitely and may be redistributed consistent with this project or the
    open source license(s) involved.
```

Sign every commit:

```bash
git commit -s
```

The sign-off must use the contributor's real name and a reachable email address.

## License

By contributing, you agree that your contribution is licensed under
AGPL-3.0-only, the same license as this project.
