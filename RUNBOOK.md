# Runbook

`/setup` runs every phase below in order and ends at a checked `analysis.json`.
Reach for a single phase directly when you are re-running one — a fresh crawl after
the app changed, say — or when you want to see what failed.

**No command takes `--app`.** There is one application per checkout, the one `.env`
describes. To analyse a second, give it its own worktree:

```bash
npm run app:worktree -- <slug>
```

---

## Running a phase by hand

### 1 · Read the source — three skills

Ask your agent to run them by name, in this order. Each writes one section of
`analysis.json` and nothing else:

```
run the app-dossier skill       # stack, declared routes, entities
run the app-components skill    # the UI library, how labels attach to inputs
run the app-api skill           # endpoints, and how to log in
```

`app-dossier` must go first; the other two read what it wrote.

### 2 · Prove the login actually works

```bash
npm run verify-auth -- --write
```

This runs the login the skill *read out of your source* against the running app, then
calls a protected endpoint twice — once anonymously, once with the credential — and says
`verified` only if the first was refused and the second admitted. A citation is a
hypothesis; this makes it a fact.

A login answering `200` is not evidence. A re-rendered login page answers `200` too.

Until it says `verified`, nothing may build test setup on that login.

### 3 · Crawl the running app — two passes

```bash
playwright-cli -s=myapp open https://staging.example.com/

npm run crawl:map     # minutes: menus, buttons, tables
npm run crawl:deep    # longer: every control, proved unique
```

The **map** walks the application's own menus — because most business software does not
link its screens — and answers "where is everything?": every module, and per screen its
heading, buttons, fields and tables. Read the `map` section of `analysis.json`
afterwards; it is the quickest picture of an app this repo produces. It is budgeted per
module and reports what it skipped and why.

The **deep crawl** is what proves a locator resolves to exactly one element.

### 4 · Compile and gate

```bash
npm run compile     # joins source + crawl, scores every screen
npm run check       # says what is missing, and who has not run
```

`check` is the one to read. `0 error(s)` means the contract is complete. Warnings name
the step you skipped.

### 5 · Record a flow the crawl could not reach

```bash
npm run record:ingest -- recordings/<flow>-<timestamp>.json
npm run compile
```

The `app-recorder` skill drives the recording itself. `npm run check` fails if the
ingest happened and the compile did not.

The merge is **additive, and the crawl always wins.** A recording proves a human
addressed one element once; it cannot prove no *second* element carries the same handle,
which is the one thing the crawl exists to establish.

### 6 · Hand it to an agent

`analysis.json` is the deliverable. Point the agent that writes your tests at it and tell
it where to look:

- `map` — where a screen is, and how a person gets there through the menus.
- `screens[]`, found by `path` — the controls on that screen, what each is called, which
  ones are destructive, what a click proved it leads to, and `testability`.
- `components` — how each kind of control is addressed. The only place a selector lives.
- `api.resources` and `api.authVerification` — how to create test data without the UI,
  and whether the API login is proven.

A screen below 0.7 is the analysis telling the agent it does not know enough yet — record
the flow before asking for a test against it.

---

## Reading the testability score

`compile-model.ts` scores every screen in place. The number answers one question:
*is there enough here to address the controls a test would touch?*

| score | what to do |
| --- | --- |
| **≥ 0.7** | write the test |
| **0.3 – 0.7** | record the flow first |
| **< 0.3** | the screen is a URL and little else — re-crawl it |

A low score is a request for evidence, not a defect in your app. And a screen still
below 0.7 *after* being recorded is not asking for a second recording: its controls
cannot be addressed by name, and the fix is `npm run crawl:deep`. The `missing` list
says so in those words.

---

## When something goes wrong

**Start with `npm run preflight`.** Most setup failures are a `.env` value, a missing
clone or a missing tool, and it names them directly. It also catches the failure that
otherwise looks like success: an `analysis.json` left over from a *different*
application, which the compiler would happily run against.

| symptom | what it means |
| --- | --- |
| `/setup` stopped on a `FIX` line | that one is yours — the line says what and how |
| the crawl found 0 modules | it is not logged in. Check `AUTH_*`, especially `AUTH_READY_WHEN` |
| `check` says a section is missing | that skill has not run. It names which one |
| `verify-auth` says `failed` | the login read out of your source is wrong. The observations show which step broke |
| the map stopped short in a module | its budget ran out. `map.notes` names what was skipped; raise `CRAWL_MAX_SCREENS_PER_MODULE` or `--per-module-seconds` |
| the deep crawl reached few screens | it only follows `<a href>`, and most business apps do not link their screens. Add the map's screen URLs to `CRAWL_SEED_ROUTES` |
| a screen scores high but holds only navigation | the page rendered nothing for this user — no data, no permission. Record the flow, or crawl as a user who has the data |
| a screen is `crawled: false` | the source declares it and no crawl reached it — usually a form behind an "Add" or "Edit" button. Record it |
| `check` says the clone moved | the analysis describes an older commit. Re-run the skills, then compile |

---

## The tests of the pipeline itself

```bash
npm run pipeline:test        # the compiler and analysis suites
npm run pipeline:typecheck
```

Both run in CI on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).
