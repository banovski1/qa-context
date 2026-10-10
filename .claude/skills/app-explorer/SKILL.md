---
name: app-explorer
description: Document a running web application from its base URL alone — every screen, the components on it, a proved-unique locator for every control, and the API surface the app actually calls. Use for "analyse the app under test", "document this app", "build the locator strategy", "what screens does the app have", "regenerate ".
---

# app-explorer

Turns a base URL and a login recipe into durable documentation of a running
application. No clone of the app's source is involved, and no framework is
assumed: the analyzer reads a rendered DOM and the traffic the app itself makes.

This is the browser-driven counterpart to `scripts/repo-analyzer`. Where that one
answers *what the source defines*, this one answers *what the running app
presents* — and it can prove a locator resolves to exactly one element, which
static analysis cannot.

## What it produces

The app is whatever the root `.env` describes:

```

  .env   the only app-specific file — you write this one
  analysis.json      every skill's findings, one section each. You own `map` and `screens`
  .crawl/            raw crawl output — working material, gitignored, never an artifact
```

Two files. There were sixteen, and reviewing a change meant reading a diff spread across
all of them.

The raw crawl carries a ranked candidate ladder and a bounding box for every element on
every screen — fifteen megabytes for one app, none of it readable, and none of it read
again once uniqueness has been decided. It stays in `.crawl/` and is distilled into the
`screens` section: how to name each control, whether that name resolves to exactly one
element, and where the name came from.

Everything except `.env` is generated. Never hand-edit it — re-run
the phase that wrote it.

## Two crawls, two questions

The deep crawl proves a locator for every control on every screen it can reach. It is thorough
and it is slow, and reaching a screen at all depends on that screen being linked by an `<a href>`.
Most business applications are not built that way: their modules hang off a menu, their submenus
open on a click, and half their screens have no inbound link anywhere in the DOM.

So there is a second, coarser crawl that navigates the way a person does.

```bash
node .claude/skills/app-explorer/lib/map.mjs \
  [--only Leave,Time] [--budget-min 15] [--per-module-seconds 90] [--max-per-module 12]
```

It writes the `map` section of `analysis.json`: every module in the
primary menu, every entry in each module's own menu including the ones that only open a submenu,
and for each screen its heading, its buttons, its fields with their types, and its tables with
their columns. **Minutes, not hours** — the budget is enforced per module, and a module cut short
says so in `notes` rather than appearing thin for no stated reason.

**It never writes.** It follows menus and it reads screens. No button on a page is ever pressed —
only menu entries — so a map can be taken against an environment you care about.

The map is the coarse layer. The deep crawl sharpens the screens that matter, and a recorded
session sharpens them further still.

## Running it

```bash
# 1. open a browser session (the profile's `session:` names it)
playwright-cli -s=<session> open <baseUrl>

# 2. crawl — logs in, discovers routes, extracts screens, records traffic
node .claude/skills/app-explorer/lib/explore.mjs

# 3. probe for a machine-readable API specification, using the logged-in session
node .claude/skills/app-explorer/lib/probe-openapi.mjs

# 4. re-render the four reports (folds in whatever step 3 found)
node .claude/skills/app-explorer/lib/explore.mjs --reports-only
```

Useful flags: `--resume` continues an interrupted crawl from `.crawl/crawl-state.json`,
`--max-screens N` and `--batch-size N` override the profile's budget.

## Targeting a new app

Write a profile. Nothing else changes — no code in `lib/` knows about any
application.

```yaml
name: My App
baseUrl: https://app.example.com/
session: myapp

auth:
  loginUrl: https://app.example.com/login
  steps:
    - { action: fill, selector: "#username", value: "env:APP_USERNAME" }
    - { action: fill, selector: "#password", value: "env:APP_PASSWORD" }
    - { action: click, selector: "button[type=submit]" }
  readyWhen: "nav a[href='/dashboard']"

seedRoutes: ["/dashboard", "/customers", "/customers/new"]
exclude: ["/logout", "/admin/"]
budget: { maxScreens: 60, maxDepth: 2 }
settings:
  testIdAttribute: data-testid
  contentSelector: "#main"
```

A `value:` of `env:NAME` is read from the environment when the crawl runs, so a
credential never enters the profile or any artifact.

Two fields decide whether the crawl is stable, and both take a **visibly
rendered** element:

- `auth.readyWhen` proves the login worked. A zero-height container does not
  count as visible — pick something the user can actually see.
- `settings.contentSelector` proves the *application* finished rendering into the
  page. Settling proves the page stopped changing; without this gate a screen
  whose list has not arrived yet is recorded as a nearly empty one.

## What the map crawl learned the hard way

Each of these cost a wrong run, and each is now a comment in the code that explains itself:

- **A menu entry is not always a link or a button.** OrangeHRM's `Entitlements` is an `<li>` with
  a caret, and its children carry `href="#"` and navigate by script. Recognising only `a[href]`
  finds half a menu and none of its depth.
- **When a wrapper and a link share a name, keep the link.** The wrapper owns the popup, but only
  the link says where the entry goes. Preferring the outermost element turned every module into a
  click target with no URL, and the crawl became far more fragile for no gain.
- **A click that navigates has not navigated when it returns.** Reading the URL immediately
  reports the previous screen, so a real navigation looks like a dead menu item. Wait for the
  address to change — but only where a change is expected, since opening a dropdown correctly
  changes nothing.
- **A redirect destroys the execution context an evaluate is running in.** That is ordinary
  behaviour in an application that redirects after load. Retry it; do not record it as a broken
  screen.
- **`page.goto` throws when the page is already navigating.** Letting that exception escape
  abandoned the whole module and left the crawl recording the *previous* module's screen under the
  new module's name.
- **A module can hold the session.** OrangeHRM's Maintenance screen refuses to leave until a
  password is given, so the two modules after it were silently mapped as copies of it. Every
  module now starts from the home page, verifies it arrived, and re-checks *after* capturing —
  an application can let you arrive and then send you back.
- **The section test must be containment, not position.** `/pim/viewMyDetails` legitimately
  becomes `/pim/viewPersonalDetails/empNumber/7`. Comparing path positions rejects every screen
  whose URL carries a record id.
- **The run-code sandbox has no `URL` constructor.** Resolution belongs in the browser; origins
  are compared as text. This one cost two separate bugs, in two separate functions.
- **A shared batch budget starves the last module in the batch.** Time looked broken for three
  runs. It was simply last in line behind three large modules.

## How it stays stable

- **Settle on evidence, never on a timer.** In-flight requests drain, then the
  DOM mutation count must hold steady across consecutive samples. Then the
  content gate above. No `sleep` decides anything.
- **Generated ids are refused.** An id like `contact-edit-3598` is minted per
  render: stable within one crawl, different in the next. `looksGenerated` in
  `extract-screen.js` rejects those wherever a locator might anchor to one — this
  was the single largest source of run-to-run drift.
- **Failures are recorded, never skipped.** A screen that will not yield is
  retried once, then written to `.crawl/crawl-state.json` with its reason. A screen that
  was never reached still appears in `testability` with `crawled: false`, so a missing
  screen is visible rather than absent.
- **Read-only.** The crawl navigates and reads. It opens create and edit screens
  because they are routes, but never activates a control, so nothing is saved,
  sent or deleted. Controls whose name matches the destructive pattern are
  flagged `destructive: true` in the JSON for whoever writes the tests.
- **Bounded and resumable.** `budget:` caps screens and depth; every batch writes
  state before the next begins.

## The locator ladder

`lib/rank-locators.js` defines the ranking, and it is the only place it exists —
the reports read it back from that file rather than keeping a copy. Best to
worst:

`testId` → `role` → `label` → `placeholder` → `scoped` → `attribute` → `text` → `css`

Every candidate is counted against the live DOM when it is built, so **unique
means one element answered to it on the rendered page**. The best *uniquely
resolving* candidate wins; a candidate matching several elements can never be
chosen.

`scoped` is the rung worth understanding: an expression anchored to an attribute
the application names on purpose — `[data-name="firstName"] input`. It is CSS, but
it breaks only when the field is renamed, so it counts as semantic. It is the
answer for a form-heavy app whose inputs carry no `for`-associated label.

A bare `css` path always resolves to one element, so it is never counted as a
semantic win. Those controls carry `matches: -1` in the `screens` section: they are
the locators that will break first, and the controls worth fixing upstream.

## Using the output

The `screens` section is the contract. Each control
carries `locator` (the chosen one), `candidates` (all of them, with match
counts), `unique`, `fragile`, `region`, `visible` and `destructive`. An agent writing tests
reads the JSON; so does anything else that wants to know what is on a screen.

Counts in the reports cover **visible** controls only. Hidden ones — collapsed
menus, closed dropdowns — stay in the JSON but are excluded from the totals,
because a locator for something nobody can see is not one a test can act on.

## Verifying a run

The claim this tool makes is reproducibility, so check it:

```bash
cp -r screens /tmp/runA
node .claude/skills/app-explorer/lib/explore.mjs
# then diff the chosen locator of every visible element, per screen
```

On the EspoCRM demo this is 60 screens out of 60 identical. A screen that differs
is a finding: either genuinely live content, or a stability bug worth fixing here.

## The contract

`analysis.json` has ten sections and always all ten. You own **`map` and `screens`**
and write no other.

| section | owner |
| --- | --- |
| `app`, `source` | app-dossier |
| `conventions` | app-components |
| `api` | app-api |
| `map` | app-explorer (`map.mjs`) |
| `components`, `testability`, `stats` | compile-model.ts |
| `screens` | app-explorer (`explore.mjs`), enriched by compile-model.ts |

A section that is present but empty means its skill has not run, and `check-model.ts`
reports it by name. Leaving yours empty because you found nothing is a claim — say where
you looked in `notes` instead.
