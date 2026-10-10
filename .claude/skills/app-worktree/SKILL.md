---
name: app-worktree
description: Use when the user wants to analyse or test a second application — sets up a git worktree with its own .env and analysis.json, because the pipeline is one-app-per-checkout.
---

# app-worktree

The pipeline is single-app on purpose. One `.env` and one `analysis.json`, both at the
repository root, and no `--app` flag anywhere.
Nothing in a command line has to say which application is meant, because there is
only one.

A second application therefore needs a second checkout, not a second directory.

## Making one

```bash
npm run app:worktree -- <slug>          # e.g. conduit, espocrm, calcom
```

That runs `scripts/worktree/new-app.mjs`, which:

1. creates `.worktrees/<slug>` on a new branch `app/<slug>`,
2. copies `.env.example` to `.env` there,
3. **deletes the inherited `analysis.json`** — it describes the app you branched from,
   and leaving it would let `compile` and `generate` succeed against the wrong model.

`.worktrees/` is gitignored. Each worktree shares one git history and one copy of the
scripts; only the app-specific files differ.

## Then, in the new worktree

```bash
cd .worktrees/<slug>
$EDITOR .env        # APP_NAME, APP_BASE_URL, APP_REPO_PATH, APP_SESSION, AUTH_*
npm install
```

Every value in the copied `.env` still describes the previous app. `APP_SESSION` in
particular must differ — two crawls sharing a playwright-cli session name will collide.

Then run the normal pipeline from that directory: the analysis skills, `npm run crawl:map`,
`npm run crawl:deep`, `npm run compile`, `npm run check` — or `/setup`, which runs them all.

## Removing one

```bash
git worktree remove .worktrees/<slug>
```

## When NOT to use this

Retargeting *this* checkout at a different application is just editing `.env`. Use a
worktree when you want to keep two applications' analyses alive at the same time — for
example to check that a change to the generator improves one without breaking the other.

That cross-checking is what the four-app corpus used to provide. With one app per
checkout it is a deliberate act: make the worktrees, regenerate in each, and compare the
diffs. A generator change validated against a single application has not been validated.
