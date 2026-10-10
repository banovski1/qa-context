---
name: setup
description: Use for "/setup", "set this up", "analyse my app", "get me started" — runs the whole analysis end to end from a filled-in .env to a checked analysis.json, installing what is missing and stopping with a specific fix when something is wrong.
---

# setup

The user has filled in `.env`. Everything from there to a complete, checked
`analysis.json` is your job. They should not have to know the steps in RUNBOOK.md.

**Run the phases in order. Stop at the first blocking failure and tell the user exactly
what to change** — a vague "setup failed" wastes the whole point of this skill.

Report progress as you go: each phase takes real time (the crawl takes minutes), and a
silent agent looks hung.

---

## Phase 0 — preflight

```bash
node scripts/setup/preflight.mjs
```

This is the gate. It checks the `.env` keys, that the source clone exists, that the login
block is coherent, the toolchain, and whether an existing `analysis.json` belongs to a
*different* application.

- **Any `FIX` line → stop.** Show the user the `FIX` lines and their `->` suggestions
  verbatim. Do not try to work around them and do not proceed to Phase 1. These are things
  only the user can decide (their URL, their clone, their credentials).
- **`warn` lines → report, then continue.** They name degraded results, not blockers. The
  one worth calling out explicitly is missing `APP_USERNAME`/`APP_PASSWORD`: the crawl
  will only see what a logged-out visitor sees, which is usually a login page and nothing
  else. Ask whether to continue anyway.

If `playwright-cli` is reported missing, offer to install it
(`npm install -g @playwright/cli@latest`) — that one you *can* fix, with the user's
agreement, since it is a global install on their machine.

## Phase 1 — install

```bash
npm install
```

## Phase 2 — read the source (three skills, in order)

Invoke each by name and wait for it to finish. Each writes exactly one section of
`analysis.json` through `scripts/analysis/write-section.ts` and nothing else.

1. `app-dossier` — stack, declared routes, entities. **Must go first**; the other two read
   the `source` section it writes.
2. `app-components` — the UI library, how a label reaches an input.
3. `app-api` — endpoints, tiers, and how a test logs in.

If `APP_REPO_PATH` has no source worth reading, these produce thin sections. Say so rather
than presenting an empty `source` as success.

## Phase 3 — prove the login

```bash
npm run verify-auth -- --write
```

This executes the login `app-api` read out of the source against the running app, then
calls a protected endpoint twice — once anonymously, once with the credential — and only
stamps `verified` when the first is refused and the second admitted.

A `failed` verdict is **not** a reason to stop the whole setup: the UI half of the analysis
still works. Report it and continue, but say plainly that until it passes, nothing may
build test setup on that API login.

## Phase 4 — crawl the running app

The browser session must exist first:

```bash
playwright-cli -s=$APP_SESSION open $APP_BASE_URL
```

Then both crawls. The map is fast and broad; the deep crawl is slow and is what proves a
locator resolves to exactly one element.

```bash
npm run crawl:map     # minutes: modules, menus, buttons, fields, tables
npm run crawl:deep    # longer: every control, uniqueness proved
```

Tell the user before starting the deep crawl that it takes minutes and is bounded by
`CRAWL_MAX_SCREENS`.

If the map reports **0 modules**, the crawl is almost certainly not logged in, or
`AUTH_READY_WHEN` names something that is not visible. Check that before running the deep
crawl — a deep crawl of the login page is a waste of minutes.

## Phase 5 — compile and gate

```bash
npm run compile     # joins source and crawl, scores every screen
npm run check       # staleness, naming, addressability
```

`check` is the one to read out. `0 error(s)` means the contract is complete; warnings name
a step that did not run.

## Phase 6 — report

Tell the user, concretely:

- how many screens were found, how many were crawled, and **how many score >= 0.7**
  (`npm run check` prints this, and `testability.summary` holds it). That number is how
  much of the app an agent can write tests against from `analysis.json` alone.
- what the map skipped and why (`map.notes`), and any screen the deep crawl failed on.
- whether the API login verified, and what that means for test setup.
- anything preflight warned about that is still true.

If many screens score low, say so and name the remedy: record the flow with the
`app-recorder` skill, then `npm run record:ingest -- <the .json it wrote>` and
`npm run compile`. A low score is a request for evidence, not a defect in their app —
and each recording makes the next one smaller.

---

## Rules

- **Never edit `analysis.json` by hand** to make a phase appear to pass. The fix is
  always upstream: re-run the skill, then the compiler.
- **Never put credentials anywhere but `.env`.** If a phase needs a password, it reads
  `APP_USERNAME`/`APP_PASSWORD` from the environment.
- **`playwright-cli` is the only thing that drives a browser.** Never the Playwright MCP
  tools.
- If a phase fails for a reason preflight could have caught, that is a gap in
  `scripts/setup/preflight.mjs` — say so, so the check can be added.
