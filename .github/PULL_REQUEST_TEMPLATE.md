## What changed and why

## How it was tested

- [ ] `pnpm typecheck` and `pnpm lint`
- [ ] Unit tests: `pnpm turbo run test --filter='!@reissue/tests'`
- [ ] `pnpm test:integration`, if the change touches workflows, storage or the API
- [ ] `pnpm --filter @reissue/web test:e2e`, if the change touches the web app
- [ ] A live run through Switch, if the change touches agents, rooms or messaging

## Checklist

- [ ] No secrets, `.env` files, `.data/` contents or real customer documents
- [ ] Docs updated where behaviour changed
