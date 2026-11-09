# Security Policy

## Supported versions

Fixes land on the latest minor of the current major. The major tracks the
Directus major it supports (12.x → Directus 12).

| Version | Supported |
| ------- | --------- |
| 12.x    | yes       |
| < 12    | no        |

## Reporting a vulnerability

Report privately through GitHub Security Advisories:
<https://github.com/staminna/mcp-server-claude/security/advisories/new>

Please do not open a public issue for a vulnerability. Include the version, the
transport (stdio or HTTP), what an attacker gains, and a reproduction if you
have one. Expect an acknowledgement within 72 hours and a fix or a plan within
14 days for anything exploitable.

## Scope and threat model

This server holds a **Directus static token** and acts with exactly that token's
permissions. Reports in scope include: a tool that writes without the
confirmation flag it documents, a path that leaks the token into logs or tool
output, schema or filter input that escapes its intended collection, TLS
verification that can be silently disabled, and dependency vulnerabilities that
are reachable from the server's own code paths.

Out of scope: anything the token is legitimately allowed to do (grant it a
least-privilege role — see the README), vulnerabilities in Directus itself
(report those to Directus), and the `test:live` scripts run against your own
instance.

## Handling credentials

- Credentials come from the environment or an `ENV_FILE`; never from arguments,
  and never hardcoded.
- `.env` and `.env.*` are gitignored, and local MCP client configs that may
  embed tokens are gitignored too.
- The logger redacts token values. If you find a path that prints one, that is a
  vulnerability — please report it.
