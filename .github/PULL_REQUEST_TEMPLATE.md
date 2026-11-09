## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem it solves, from the point of view of an agent using the tools. -->

## How to see it work

<!-- The command, tool call or scenario a reviewer should run. -->

## Checklist

- [ ] `npm run typecheck && npm run typecheck:test` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:coverage` passes (95% thresholds)
- [ ] `npm run test:e2e` passes
- [ ] `npm run tdqs` passes (tool definitions)
- [ ] No credential, token or `.env` content in the diff
- [ ] Tool definitions touched? Descriptions state purpose, when to use it over
      its siblings, side effects and return shape; every parameter has a
      `description`; annotations match the behaviour
- [ ] Destructive behaviour is gated by `confirm` and covered by a test
- [ ] README / CHANGELOG updated if the public surface moved
