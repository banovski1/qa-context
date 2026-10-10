---
name: app-recorder
description: Record a human walking a flow through the running app under test, and pour what it proves back into analysis.json — routes, controls, transitions and the API calls the flow provoked. Use for "record this flow", "record a session", "the score says record first", "capture <flow>".
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(npm:*) Bash(node:*) Bash(cat:*) Bash(ls:*)
---

# Recording a flow, and making it count

A crawl proves that a locator resolves to exactly one element. It cannot prove what a
click *leads to*, and it cannot reach a screen that only exists three forms into a
workflow. That is what a recording is for, and it is the only evidence a crawl cannot
substitute for.

This skill spins the app up, hands the browser to a human, and turns what they did into
analysis the whole pipeline reads. **Every recording makes the next one smaller**: the
routes, controls, transitions and endpoints it proves go into `analysis.json`, so the
screens it touched stop asking to be recorded.

`playwright-cli` does all of it — the recording *and* the network capture, in one
session. There is no second browser driver here and no exception to that rule.

## 1. Read the config

```bash
npx tsx -e "import {loadProfile} from './scripts/config/profile.mjs'; console.log(JSON.stringify(loadProfile(),null,2))"
```

`APP_BASE_URL`, `APP_SESSION` and the `AUTH_*` block all come from the root `.env`.
**Never hardcode a URL or a credential** — the app under test is described in one
place.

If `APP_BASE_URL` is unset, stop and say `cp .env.example .env`. Do not guess a URL.

## 2. Spin up the app, logged in

```bash
playwright-cli -s=$APP_SESSION open $APP_BASE_URL
```

Then perform the login the profile declares — `AUTH_LOGIN_URL`, the two `fill`s, the
submit — and wait for `AUTH_READY_WHEN`:

```bash
playwright-cli -s=$APP_SESSION goto "$AUTH_LOGIN_URL"
playwright-cli -s=$APP_SESSION fill "$AUTH_USERNAME_SELECTOR" "$APP_USERNAME"
playwright-cli -s=$APP_SESSION fill "$AUTH_PASSWORD_SELECTOR" "$APP_PASSWORD"
playwright-cli -s=$APP_SESSION click "$AUTH_SUBMIT_SELECTOR"
playwright-cli -s=$APP_SESSION snapshot   # confirm AUTH_READY_WHEN is present
```

**The human starts inside the app, not on its login screen.** Recording the login for
the fiftieth time proves nothing; `auth.setup.ts` already logs every spec in. If
`AUTH_READY_WHEN` never appears, stop and say the login failed — do not hand over a
browser sitting on an error page and call whatever follows a recording of the flow.

Navigate to where the flow starts, if the request named a starting screen.

## 3. Hand over the browser

```bash
playwright-cli -s=$APP_SESSION recording-start
```

Then tell the human, in these terms:

> The browser is yours — walk the flow you want recorded, at whatever pace. Tell me when
> you are done and I will stop the recording. Everything you click is captured, and the
> requests the app makes are captured with it.

**Wait for them to say they are finished.** Do not poll, do not guess from the page, and
do not stop the recording because it has been quiet. A person reading a form is
indistinguishable from a person who has wandered off, and only one of them wants their
recording ended.

## 4. Stop, and capture the traffic

Both, in this order, in the same session — the second is why no HAR is needed:

```bash
playwright-cli -s=$APP_SESSION --raw recording-stop > .playwright-cli/recording.ts
playwright-cli -s=$APP_SESSION --json requests > .playwright-cli/requests.json
```

If `recording.ts` is empty, the human ended without doing anything. Say so and stop;
shaping an empty recording produces a file that looks like evidence and is not.

## 5. Build the two files

```bash
npx tsx scripts/analysis/build-session-doc.ts \
  --flow <slug> \
  --code .playwright-cli/recording.ts \
  --requests .playwright-cli/requests.json
```

`<slug>` is short kebab-case, read from what was actually recorded — the module and the
key action (`pim-add-employee`, `leave-apply-request`). The timestamp is appended for
you, so recordings accumulate as a library instead of overwriting each other.

This writes `recordings/<slug>-<timestamp>.md` (what a human reads) and
`recordings/<slug>-<timestamp>.json` (what the ingest reads). **Both are committed** — the
analysis is derived from them, and a derivation whose input is not in the repo cannot be
re-run. Credentials are redacted here; that is the only place they are in hand.

## 6. Ingest and compile, or it counts for nothing

```bash
npm run record:ingest -- recordings/<slug>-<timestamp>.json
npm run compile
```

The ingest writes the evidence and rescores every screen. **The compile is what makes it
matter** — `merge-recordings.ts` turns the evidence into screens, controls, transitions
and endpoints. Stopping after the ingest leaves a file that looks updated and has
derived nothing, which `npm run check` will tell you in those words.

## 7. Report

Say, plainly:

- the two file paths;
- step count, and how many ran through a locator that names no control;
- which routes were new to the analysis;
- each covered screen's score, before → after;
- how many endpoints the flow revealed.

### When a screen is still below 0.7 after being recorded

**It is not asking for another recording.** Its controls cannot be addressed by name, and
no amount of clicking through changes that — the fix is a re-crawl
(`npm run crawl:deep`). The screen's `missing` list already says this in those words;
quote it rather than inventing advice, and never propose recording the same flow twice.

## Rules

- `playwright-cli` is the only thing that drives a browser here. This skill is not an
  exception to that rule — it is the reason the exception was removed.
- Never hardcode `APP_BASE_URL` or a credential. One `.env`, one app.
- Never hand-edit `analysis.json`. `ingest-recording.ts` writes two sections through
  `write-section.ts`; nothing else touches the file.
- Raw `playwright-cli` output stays in `.playwright-cli/` and is gitignored. Only the two
  files under `recordings/` are committed.
- A recording is a record of what happened and is never edited afterwards. A recording
  that disagrees with the analysis is a reason to re-crawl, not to correct the recording.
