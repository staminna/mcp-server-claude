# Contributing

Thanks for taking the time. This is a small, strictly-typed codebase with a high
test bar; the rules below are what keeps it that way.

## Local setup

```bash
npm ci
cp .env.example .env    # fill in DIRECTUS_URL and DIRECTUS_TOKEN
npm run build
```

Never commit a `.env`. Only `.env.example` is tracked, and it carries
placeholders, never real values. Secrets belong in the environment.

## Before you push

```bash
npm run typecheck && npm run typecheck:test
npm run lint
npm run test:coverage     # unit + integration, 95% thresholds enforced
npm run test:e2e          # spawns the stdio server
npm run tdqs              # tool-definition quality gate (no API key needed)
```

CI runs exactly these on Node 26. A pull request that fails any of them will not
be merged, so run them locally first.

`npm run test:live` is deliberately outside `npm test`: it needs a credential and
a reachable Directus instance, so it is a manual gate rather than a CI one.

## Adding or changing a tool

Tool definitions live in `TOOL_DEFINITIONS` in `src/server.ts`. A new tool needs:

1. An entry in `TOOL_DEFINITIONS` with `annotations.title` prefixed
   `Directus - `, the right `readOnlyHint`/`destructiveHint`/`idempotentHint`,
   and `keywords` for `search_tools`.
2. A description that passes the project bar: what the tool does, when to use it
   instead of its siblings, the side effects and failure modes an agent cannot
   infer from the schema, and what it returns. Destructive tools say so and say
   what gates them. See [TDQS](https://tdqs.dev) — `npm run tdqs` checks the
   deterministic part of this.
3. A `description` on every parameter in `inputSchema`. Coverage below 80%
   lowers the score for the whole server.
4. Dispatch in `callTool`, and a unit test in `tests/unit/server-handlers.test.ts`.

Anything that writes must be covered by tests that assert nothing is written
without the confirmation flag.

## Commits and pull requests

- Conventional-commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`).
- One concern per pull request.
- Say in the body what a reviewer should run to see the change work.
- Releases follow `PUBLISHING.md`; the version must agree in all four places it
  appears before a tag is cut.
