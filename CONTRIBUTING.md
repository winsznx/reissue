# Contributing to Reissue

Thanks for helping. This guide covers how to run Reissue, the checks a change has to pass, and
the rules the code keeps.

## Run it locally

You need Node 22 or newer (24 recommended), pnpm 12, Docker, [uv](https://docs.astral.sh/uv/)
and Tesseract (`brew install tesseract`). The examiner and liaison agents call the Claude Code
CLI, so install it and sign in if you want those two agents to run.

```bash
pnpm bootstrap                 # dependencies, .env with fresh secrets, Postgres/Redis/S3, migrations, builds
scripts/stack.sh start         # document worker, API :4210, workflow worker, web :3210
```

To include Switch, start the local server and its Mattermost bridge, then set up agents and rooms:

```bash
scripts/switch-local.sh up
pnpm --filter @reissue/switch-coordinator setup:local
scripts/stack.sh restart
pnpm verify:switch
```

[switch/setup.md](switch/setup.md) explains how to connect real Slack and Telegram.

## Checks before a pull request

| Check | Command |
|---|---|
| Types | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Unit tests | `pnpm turbo run test --filter='!@reissue/tests'` |
| Integration on real Postgres, Redis, S3 and the document worker | `pnpm test:integration` (needs `pnpm infra:up`) |
| Workbench in a browser | `pnpm --filter @reissue/web test:e2e` |
| Live loop through Switch | `pnpm test:live` (needs the local Switch setup) |

CI runs types, lint, the build and the unit tests on every push and pull request.

The scenario browser tests start demo cases. Those cases post into whichever operations room is
bound in `.env`. If a real Slack channel is bound, the posts land there.

## Rules the code keeps

- **Models read, code decides.** Models propose extractions and phrase messages. Deterministic
  code decides versions, conversions, arithmetic, issue state, readiness and what goes in the
  packet.
- **The supplier sees only what they need:** the case code, the field, both stated values and
  the page. The liaison's tool token can't reach documents, prices or other cases.
- **Original bytes are never changed.** Files are stored by SHA-256, and the packet refuses any
  file whose bytes differ.
- **Every outbound message is sent exactly once,** through the outbox and its dedupe key.
- **Untrusted input stays data.** Text inside a PDF or chat message can't change an agent's role
  or a case's state.

## Commits and pull requests

- Keep each commit to one logical change. Write the subject as a plain sentence that says what
  changed, and use the body to say why.
- Add or update a test for each behaviour you change. Fix bugs at the root, not by hiding the
  symptom.
- Never commit `.env` files, anything under `.data/`, keys, tokens or customer documents. The
  test fixtures in `tests/fixtures/documents` are generated, controlled documents.
- Update the README or the docs in `docs/` when you change behaviour someone relies on.

## Reporting issues

Use the issue templates. For anything security related, follow [SECURITY.md](SECURITY.md)
instead of opening a public issue.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE),
and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
