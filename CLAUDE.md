# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A pipeline that turns an application — its source *and* its running instance — into one
file, `analysis.json`, that an agent can write tests from without guessing: every screen,
every control on it, a locator proved to address exactly one element, and the API behind it.

**That file is the product.** This repo used to go on to generate a Playwright framework
and drive test-writing agents; both were removed so that the analysis could be the one
thing it does, and do it reliably. A change that makes the analysis more complete, more
reproducible or more honest about what it does not know is the kind of change this repo
wants. A change that adds a consumer of it belongs somewhere else.

```
.env                                the only hand-written file: repoPath, baseUrl, auth, seeds, budget
        │
        │   four skills, one artifact — each owns one section of analysis.json
        ├─► app-dossier ─────► app, source        what the source declares
        ├─► app-components ──► conventions        how the app is built
        ├─► app-api ─────────► api                endpoints, and how to log in
        └─► app-explorer ────► map, screens       what the running app presents
                    │
        compile-model.ts ◄──┘   deterministic, pure, snapshot-tested
                    │
                    └─► components, screens[].uses, api.resources, testability, stats
                                    │
                                    └─► check-model.ts   the gate: complete, current, addressable
```

**One app per checkout**, and at its root two files: the one you write and the one the
pipeline produces.

| file | what it is |
| --- | --- |
| `.env` | yours. The only app-specific thing anyone writes by hand. `.env.example` is its committed template |
| `analysis.json` | everything known about the app: ten sections, one contract |

**Neither is committed.** A clone of this repo starts with no app data at all — both
describe whichever application the person cloning it happens to point at, so shipping one
would ship somebody else's crawl. `.gitignore` covers them and CI fails if `analysis.json`
reappears in the index. This does not soften the write policy below: `analysis.json` is
still produced and never hand-edited.

There were sixteen files, then four, then two. Anything derived from `analysis.json` and
committed beside it is a second thing to diff and a second thing to keep honest.

## The contract: `analysis.json`

Ten sections, always all ten, each with exactly one owner. A section that is present
but empty means a skill has not run — `check-model.ts` says which.

| section | owner | holds |
| --- | --- | --- |
| `app` | app-dossier | name, baseUrl, repoPath, repoCommit, stack |
| `source` | app-dossier | declared routes, entities, dependencies, existing tests, self-documentation |
| `conventions` | app-components | the UI library, region selectors, how a label reaches an input |
| `api` | app-api | endpoints, tiers, spec, `auth`, `authVerification`, and `resources` (derived) |
| `map` | app-explorer (`map.mjs`) | the menu map: modules, entries, and each screen's buttons, fields and tables |
| `components` | compile-model | the locator layer. **The only place a selector may appear** |
| `screens` | app-explorer, enriched by compile-model | one entry per screen: what was observed *and* what was derived |
| `testability` | compile-model | the roll-up, and the recordings that raised it |
| `recordings` | app-recorder (`ingest-recording.ts`) | what a human's recording saw: steps, routes, and the requests the flow provoked |
| `stats` | compile-model | the counts a review reads first |

`screens` is the one section with two writers, and the order matters: the explorer writes
what it observed — controls, tables, links, headings — then the compiler adds what it
derived to the same entries: the screen's name, the components mapped onto it, the
transitions it proved, and the confidence. Everything about one screen is in one entry,
because looking it up in two places is what the second file was.

The compiler writes back into the section it reads, so `crawled: false` is load-bearing:
it marks a screen the compiler itself added for a declared route no crawl reached, and
keeps a recompile from counting it as something the crawl found. There is a test for it.

Raw crawl output stays in `.crawl/` and is gitignored — a candidate ladder and a bounding
box per element, fifteen megabytes for one app, never read again once uniqueness has been
decided.

The two halves answer different questions, and tests need both. **Source** knows every route the
app declares, how a label attaches to an input, and which endpoint creates a record. **The running
app** is the only thing that can prove a locator resolves to exactly one element. Neither replaces
the other, and the compiler is where they join.

**No command takes `--app`.** There is one application per checkout — the one `.env` describes —
so nothing in a path or a command line has to name it. Analysing a second application is a second
git worktree, never a second directory here: `npm run app:worktree -- <slug>`, and the
`app-worktree` skill explains the rest.

The cost is real and worth stating. Four apps side by side used to mean a change shaped around one
of them showed up as a diff in the other three, for free. Now that cross-check is a deliberate act:
make the worktrees, re-analyse in each, compare. **A crawler or compiler change validated against a
single application has not been validated.**

## Commands

`package.json` at the root wraps each of these (`npm run compile`, and likewise `check`,
`verify-auth`, `crawl:map`, `crawl:deep`, `record:ingest`, `preflight`). The `npx tsx`
forms below are canonical; the aliases exist so a newcomer following README.md does not
have to know the paths. `npm install` is the whole toolchain, and `cp .env.example .env`
is the first thing anyone does.

**`/setup` runs the whole of the below**, from a filled-in `.env` to a checked
`analysis.json` — `scripts/setup/preflight.mjs` gates it and stops with the one thing the
user must change. Run the phases individually when re-running one, or when debugging.

```bash
# 0. Is this machine and this .env ready? /setup runs this first and stops on any FIX.
npm run preflight

# 1. Analysis — the three skills read the clone. Invoke them by name; each writes its
#    own section via scripts/analysis/write-section.ts.
#    app-dossier → app-components and app-api (both read `source`) → app-explorer.

# 2. Crawl the running app. Two crawls, two questions.
playwright-cli -s=<session> open <baseUrl>
node .claude/skills/app-explorer/lib/map.mjs      # menus, minutes
node .claude/skills/app-explorer/lib/explore.mjs  # controls, deep

# 3. Prove the documented API login actually works (stamps api.authVerification)
npx tsx scripts/api-auth/verify-auth.ts --write   # credentials come from .env

# 4. Compile, then gate the contract
npx tsx scripts/model-compiler/compile-model.ts   # merges recordings, fills the compiler's five sections
npx tsx scripts/model-compiler/check-model.ts     # staleness, naming, addressability

# 4b. Record a flow the crawl could not reach, and pour it back in
#     (the app-recorder skill drives these; `npm run check` fails if the ingest
#      happened and the compile did not)
npm run record:ingest -- recordings/<flow>-<timestamp>.json
npm run compile

# 5. The tests of the pipeline itself — both run in CI
npm run pipeline:test        # config, explorer, compiler, analysis and api-auth suites
npm run pipeline:typecheck
```

**The deep crawl only follows `<a href>`.** On an app whose screens hang off menus it
reaches a fraction of what the map found. Seed it with the map's screen URLs
(`CRAWL_SEED_ROUTES`) — the process environment overrides `.env`, so a one-off wider
crawl needs no edit to the user's file.

## The corpus

`orangehrm` (`~/Projects/orangehrm`, Vue 3 + Symfony) — labels with no `for=`, and a design system
outside the clone. It is the app this checkout describes.

Three others were analysed side by side until the layout went flat, and each still names a problem
the pipeline had to solve. They live in git history at `3a108e0`, and a worktree brings any of
them back:

| app | clone | stack | what it proved |
| --- | --- | --- | --- |
| `espocrm-demo` | `~/Projects/espocrm` | Backbone + PHP | hash routes; a router that names no component; no test ids |
| `conduit` | `~/Projects/angular-realworld-example-app` | Angular | no labels at all — placeholders are the whole vocabulary |
| `calcom` | `~/Projects/cal.diy` | Next.js app-router + tRPC | 78 declared routes, 4 crawlable: the declared-but-unreached path |

Retargeting to a new app is a new `.env`, never a code change.

## The map

The `map` section answers "where is everything?" — the primary menu, each module's own menu including
entries that only open a submenu, and per screen its heading, buttons, fields with types, and
tables with columns. It navigates through the application's own menus rather than following
`<a href>`, because most business software does not link its screens.

**It is read-only.** Menu entries are followed; no button on a page is ever pressed. A map can be
taken against an environment you care about.

It is budgeted per module and reports what it skipped and why. OrangeHRM: 12 modules, 76 screens,
52 tables in seven minutes. Conduit: 3 modules, 5 screens in eleven seconds — and its "Popular
Tags" sidebar is recorded as a `valueList` with two samples, not crawled as fifteen menu entries.

The map is the coarse layer. The deep crawl sharpens the screens that matter; a recorded session
sharpens them further.

## What the compiler guarantees

Across `components` and `screens`, **only `components` holds a locator**.

- **A screen carries English, never a selector.** `{ component: 'Button', as: 'submitRequest',
  label: 'Submit Request' }`. `assertNoSelectors` makes a violation a compile error, with a test.
  A region whose only handle is CSS owns that CSS privately inside its own component class.
- **A handle is recorded only if it addresses one element.** The crawl proves this, and
  the compiler groups a screen's controls by the handle each would carry: a group of one
  is addressable, a larger one is retried scoped to the heading above each member, and
  whatever the heading does not separate is unverified. A numeric suffix on the property
  name never disambiguates anything — `select` and `select2` carrying one identical
  locator both resolve to both elements, and the failure lands inside a test instead of
  in the compiler.
- **A label the app renders but never associated is marked `via: 'proximity'`.** The
  crawl finds it by walking out from the control until a label appears in a wrapper
  holding no other control, and whoever writes the test must perform the same walk.
  Without the mark a test asks the accessibility tree for a name the app never put
  there, and every lookup on the screen fails. For a control that takes input this label
  beats both its own text and its placeholder — three date fields whose accessible name
  is `yyyy-mm-dd` are three controls with one name; "From Date" is what a person reads.
- **Recurrence makes a component.** The same region on ≥2 screens with ≥70% of its controls shared
  (`RECURRENCE_MIN_SCREENS`, `RECURRENCE_MIN_CONTROL_MATCH`, `MIN_REGION_CONTROLS` — one constant
  each). A region with no declared root is a crawl partition, not a class.
- **`kind` says how a component is addressed.** `region` → named controls; `field` → by its label
  (`TextField { label: 'City' }`); `collection` → rows addressed by key, never by index.
- **Routes are the union.** Declared ∪ crawled. A declared route is joined onto the base URL's
  mount path (`/web/index.php`) before matching. A crawled record URL folds onto its declared
  parameterised route and survives as an alias; a declared route the crawl never reached becomes a
  screen with a URL and nothing else, flagged `crawled: false`.
- **Actions are proven, never inferred.** `screens[].actions` lists a transition only where the
  crawl or a recording proved it through a control the screen owns. Every route is still reachable
  by its URL.

## Testability: write it, or record it first

`compile-model.ts` scores every screen in place: `screens[].testability` carries a
confidence between 0 and 1, the count of controls that can and cannot be addressed, and
a `missing` list saying what would raise it. `testability.summary` is the roll-up.

The number answers one question: *is there enough here to address the controls a test
would touch?* **≥ 0.7 — write the test. 0.3 to 0.7 — ask for the flow to be recorded
first. Below 0.3 — the screen is a URL and little else.** A low score is a request for
evidence, not a defect in the app.

A recording is the one thing a crawl cannot substitute for: it says what a click leads
to, not merely what is on the page.

**And a recording pays for itself.** The `app-recorder` skill records a human walking the
flow, captures the requests it provoked from the same `playwright-cli` session, and writes
both to `recordings/`. `ingest-recording.ts` puts the evidence in the `recordings`
section; `merge-recordings.ts` — inside the compiler, before component derivation — folds
it into `screens`, `components` and `api.endpoints`. So the routes, controls, transitions
and endpoints one recording proved are there for every test after it, and each recording
makes the next one smaller.

The merge is **additive, and the crawl always wins**. A recording proves a human addressed
one element once; it cannot prove no second element carries the same handle, which is the
one thing the crawl exists to establish. A recorded control may fill a gap and may never
replace a proof — the disagreement is counted in `stats.recordingConflicts` and the
crawl's answer stands.

A screen still below 0.7 *after* being recorded is not asking for a second recording. Its
controls cannot be addressed by name, and the fix is a re-crawl; `missing` says so in
those words.

## Authentication is verified, never asserted

An `auth` block in `api.json` is read out of source, and a citation is a hypothesis.
`scripts/api-auth/verify-auth.ts` executes it against the running instance and stamps
`authVerification` with the verdict. **`verified` means one specific thing**: a
parameter-free `GET` from the app's own endpoint list refused an anonymous caller and
admitted this credential. A login answering `200` is not evidence — a re-rendered login
page answers `200` too.

No `authVerification`, no proven login. Nothing may build test setup on an
unverified one. The block is written by the tool or it is absent; hand-editing it is the
same lie as hand-editing anything else under `analysis/`.

## Things learned the hard way, encoded

- **A `<table>` with no header row is a layout table**, not a collection. EspoCRM has dozens.
- **A screen's identity is its URL pattern, anchored** — without the anchor `/#Contact` also
  matches `/#Contact/view/123`. The heading is recorded too, but it is one crawl of one moment.
- **A high score is not proof the page rendered its content.** A screen that showed this user
  nothing — no leave balance, no permission — scores on the controls that *were* there, which may
  be navigation alone. Check `uses` before trusting a score on a form you expected to be full.

## Write policy

Never hand-edit `analysis.json`. A skill writes its section through
`scripts/analysis/write-section.ts`, which replaces one key and leaves every other byte
alone. The fix for a wrong report is upstream — re-run the skill, then the compiler.

`.gitattributes` pins `eol=lf`; do not relax it.

## Browser automation rule

`playwright-cli` (skill at `.claude/skills/playwright-cli/`) is the only thing that drives a browser
here. Never use the Playwright MCP (`mcp__playwright__*`) tools. Scratch output lands in
`.playwright-cli/` (gitignored).

**There is no exception.** Human recording is `playwright-cli recording-start` /
`recording-stop`, which the `app-recorder` skill drives — and because the same session
answers `requests`, the network the flow provoked comes back with it, needing no HAR and
no trace. `playwright-codegen` used to be the exception here and has been deleted.

Recordings land in `recordings/<flow>-<timestamp>.{md,json}`, and like `analysis.json`
they are gitignored: a recording is a walk through *your* application, and it is the one
artifact here that can carry a real credential, so it stays on the machine that made it.
Keep them anyway — `analysis.json` is derived from them, and a derivation whose input you
deleted cannot be re-run. They are evidence of what happened and are never edited
afterwards. If a screen's elements are missing, re-crawl; if a *flow* is unknown, record it.
