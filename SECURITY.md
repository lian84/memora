# Security Policy

Memora stores personal conversations, memories and provider credentials. Please
do not disclose security issues in a public issue.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

1. Open the repository **Security** tab.
2. Select **Report a vulnerability**.
3. Include a minimal reproduction, affected version/commit and impact.

If private reporting is unavailable, contact the maintainer through the GitHub
profile linked to the repository. Do not include secrets or personal data in
the report.

## Supported versions

Memora is currently pre-release. Security fixes are applied to the `main`
branch; no long-term support branches are maintained yet.

## Scope and baseline

The security model and operational assumptions are documented in
[`docs/SECURITY.md`](docs/SECURITY.md), including:

- single-user authentication;
- local data directory and file permissions;
- secret storage;
- SSRF protections for web access;
- untrusted memory and web content;
- backup and retention guidance.

Please avoid testing against systems you do not own or have permission to test.
