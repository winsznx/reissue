# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately: in this repository, go to **Security → Report a
vulnerability**. Don't open a public issue. You'll get an acknowledgement within a few days, and
the fix and its disclosure will be coordinated with you.

## Supported versions

Only the latest release on `main` gets security fixes.

## How Reissue handles sensitive data

- **Secrets stay out of the repository.** `pnpm bootstrap` generates them into `.env`, and
  `.env*` (except `.env.example`) and `.data/` are git-ignored.
- **Agent keys are stored locally.** Switch agent keys are kept in `.data/*-credentials.json`
  with file mode 600.
- **Agents get scoped tool tokens.** The examiner and liaison each get their own token for the
  Reissue MCP endpoint. The liaison's token only reaches supplier-safe briefs: no documents, no
  prices, no other cases.
- **Downloads use signed, expiring links.** Packets and source files are downloaded only through
  them.
- **Files are verified by hash.** Uploaded and chat-delivered files are screened for size and
  type and stored by SHA-256. A file that references another shipment is held for review.
- **Documents and messages are untrusted input.** Instructions inside them are treated as data
  and never change an agent's role or a case's state.

Reissue is built to run on infrastructure you control, against a self-hosted Switch server. If
you expose the API or web app beyond your machine, put them behind TLS and your own access
control, and rotate the generated secrets.
