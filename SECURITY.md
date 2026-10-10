# Security policy

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository, or email
<cvetomirbanovski@gmail.com>.

You will get an acknowledgement within 72 hours and a fix or a decision
within 14 days. Report privately and you will be credited in the release notes.

## What is in scope

This repository generates code and drives a browser against an application
*you* point it at. The parts worth reporting:

| area | why it matters |
| --- | --- |
| `.env` handling | it holds the credentials for the app under test |
| `recordings/` and `analysis.json` | a recording is redacted before it is written; a leak of a real password into either is a vulnerability |
| `scripts/analysis/write-section.ts` | it writes `analysis.json` from crawl and recording data — a path escape is a vulnerability |

## What is not

- The application under test. Point this at your own staging, and report its
  bugs to whoever owns it.
- Credentials you put in `.env` and then committed. `.env` is gitignored;
  `.env.example` is the committed template and holds placeholders only.

## Supported versions

The `master` branch. There are no backports.
