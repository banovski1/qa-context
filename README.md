<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
  <img src="assets/logo.png" alt="qa-context" width="440">
</picture>

**Point it at a web app. Get one file that tells an agent everything it needs to write a test.**

Every screen, every control on it, a locator proved to match exactly one element, and the API behind it.

[![CI](https://github.com/banovski1/qa-context/actions/workflows/ci.yml/badge.svg)](https://github.com/banovski1/qa-context/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-5FA04E.svg)](https://nodejs.org)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2.svg)](https://github.com/sponsors/banovski1)

<sub>Built by [Tsvetomir Banovski](https://github.com/banovski1) · [what this is and why](#who-built-this-and-why)</sub>

</div>

```
your app's source ──┐
                    ├──►  analysis.json  ──►  any agent that writes your tests
your app running ───┘
```

> **Where it stands today.** The analysis is driven by **Claude Code** skills and a
> **Playwright**-based crawler. What comes out is plain JSON, and any agent or runner can
> read it. If you want to help take it to other agent clients, see
> [CONTRIBUTING.md](CONTRIBUTING.md) or open an issue.

---

## Why this exists

Ask an LLM to write an end-to-end test and it guesses. It guesses the URL, the button's
name, whether the label is wired to the input, and which of the three "Save" buttons you
meant. Then the test fails on step three and you spend an hour finding out which guess
was wrong.

This repo does the looking first and writes down only what it proved. One file,
`analysis.json`, holds what the source declares and what the running app presents, joined
screen by screen. Hand it to the agent, and it doesn't have to guess.

### Four decisions that make it trustworthy

**A locator is recorded only if it addresses exactly one element.** Not "probably one":
the crawl counts every candidate against the live page. Controls are grouped by the
handle each would carry. A group of one is addressable. A larger group is retried scoped
to the heading above each member, and whatever that doesn't separate is marked unverified
instead of guessed.

**Source and the running app answer different questions, and you need both.** Source
knows every route the app declares and which endpoint creates a record. Only the running
app can prove a locator is unique. The compiler is where the two join.

**The analysis knows what it does not know.** Every screen carries a confidence score
between 0 and 1, plus a `missing` list saying what would raise it. Below 0.7 the honest
answer is "record this flow first", not a test written on a guess.

**Authentication is verified, never asserted.** The login read out of source is executed
against the running app. It counts as `verified` only when a protected endpoint refused
an anonymous caller and admitted this credential.

---

## What you need

| | why |
| --- | --- |
| **Node.js 22+** | the pipeline runs on it |
| **Claude Code** | the skills that read the source and drive the crawl |
| **A clone of the app's source** | declared routes, entities, endpoints. Any language |
| **A running instance you may crawl** | staging, a local `docker compose`, or a public demo |
| **`playwright-cli`** | the only thing allowed to drive a browser here — `npm i -g @playwright/cli@latest` |

**The crawl is read-only.** It follows menus and links, and never presses a button that
could create or change data. Point it at staging first anyway.

---

## Quickstart

### 1 · Install

```bash
git clone https://github.com/banovski1/qa-context.git && cd qa-context
npm install
npm run pipeline:test    # if these pass, the pipeline itself is sound
```

### 2 · Fill in `.env` — the only file you write by hand

```bash
cp .env.example .env && $EDITOR .env
```

It is commented line by line. Five things have to be right:

| | |
| --- | --- |
| `APP_BASE_URL` | where the running app lives |
| `APP_REPO_PATH` | where you cloned its source |
| `APP_USERNAME` / `APP_PASSWORD` | a test account — without it the crawl sees a login page and nothing else |
| `AUTH_*_SELECTOR` | the username field, the password field, the submit button |
| `AUTH_READY_WHEN` | something **visible** that exists only once you are logged in |

> That last one earns its own sentence. Without it, nothing can tell a successful login
> from a re-rendered login page, and you get an analysis full of screens that were never
> reached. A container with zero height proves nothing, so pick something you can see.

**`.env` is gitignored. `.env.example` is the committed template and holds placeholders only.**

### 3 · Say `/setup`

```
/setup
```

It installs what is missing, reads your source, proves the login works, crawls the running
app twice, compiles, and checks the result. It reports each phase as it goes, and it takes
a few minutes, mostly the crawl.

### When it stops instead

`/setup` runs a preflight first, which you can also run yourself:

```bash
npm run preflight
```

Every line is `ok`, `warn` or `FIX`, and each `FIX` names the one thing to change:

```
ok   APP_BASE_URL           https://staging.example.com/
FIX  source clone           /Users/you/Projects/my-app does not exist
                            -> Clone the application's source there, or point
                               APP_REPO_PATH at where it already is.
warn APP_USERNAME           not set - the crawl only sees what a logged-out visitor sees
```

`FIX` stops the run, because those are decisions only you can make. `warn` continues, degraded.

---

## What you get

One file, `analysis.json`, with ten sections, each written by exactly one step:

| section | answers |
| --- | --- |
| `map` | where is everything? Every module in the primary menu, every entry in each module's own menu, and per screen its heading, buttons, fields and tables |
| `screens` | what is on this screen? One entry per screen: its URL pattern, every control with the name a person reads, which are destructive, what a click proved it leads to, and a testability score |
| `components` | how is each kind of control addressed? The only place a selector appears |
| `api` | which endpoints exist, how to create and clean up test data, and whether the API login is verified |
| `conventions` | how the app is built: the UI library, and how a label reaches its input |
| `app`, `source` | the stack, and every route and entity the source declares |
| `recordings`, `testability`, `stats` | what human recordings added, and the roll-up a review reads first |

One screen from a real OrangeHRM analysis, trimmed:

```json
{
  "path": "/web/index.php/leave/viewLeaveList",
  "name": "ViewLeaveListPage",
  "identity": { "urlPattern": "/web/index.php/leave/viewLeaveList", "heading": null },
  "uses": [
    { "component": "TextField", "as": "fromDate", "label": "From Date", "via": "proximity" },
    { "component": "Select", "as": "showLeaveWithStatus", "label": "Show Leave with Status", "via": "proximity" },
    { "component": "TextField", "as": "employeeName", "label": "Employee Name", "via": "proximity" },
    { "component": "Button", "as": "reset", "label": "Reset" },
    { "component": "RecordTable", "as": "leaveList", "keyColumn": "Date",
      "columns": ["Date", "Employee Name", "Leave Type", "Number of Days", "Status", "Actions"] }
  ],
  "testability": {
    "confidence": 0.89,
    "missing": ["4 control(s) cannot be addressed by name", "no heading to assert the screen by"]
  }
}
```

There's no CSS selector in it. That app has no `for=` on a single label, and
`via: "proximity"` records that the crawl found each label by walking outward from the
control. An agent reads that and knows to do the same. The `missing` list is the analysis
saying, in plain words, what it couldn't prove.

### Using it

Point the agent that writes your tests at `analysis.json`, and tell it to look up each
screen a test touches in `screens` by its `path`. If a screen scores below 0.7, record the
flow first:

```
record this flow     # the app-recorder skill
```

It opens your app, logs you in, and hands you the browser. You click the flow once. It
captures the clicks **and** the requests your app made while you worked. Then
`npm run record:ingest` and `npm run compile` pour that into `analysis.json`, and the
routes, controls, transitions and endpoints it proved stay there for every test after it.

> A screen still below 0.7 *after* being recorded isn't asking for a second recording.
> Its controls have no addressable names, and the fix is a re-crawl.

---

## The rules

- **Never hand-edit `analysis.json`.** A wrong report is fixed by re-running the step
  that wrote it. Each step replaces its own section and leaves every other byte alone.
- **`playwright-cli` is the only thing that drives a browser.**
- **Credentials live in `.env` and nowhere else.** `analysis.json` and `recordings/` are
  gitignored, and CI fails if one is committed.

---

## Things learned the hard way, encoded

**Most business software does not link its screens.** A crawler that follows `<a href>`
finds a tenth of the app. The map navigates through the application's own menus instead,
including entries that only open a submenu, and entries that are an `<li>` with a caret
navigating by script.

**An id minted per render is not a locator.** `contact-edit-3598` is stable within one
crawl and different in the next. Generated ids are refused wherever a locator might
anchor to one, which was the single largest source of run-to-run drift.

**Settle on evidence, never on a timer.** In-flight requests drain, the DOM mutation count
holds steady, and then the app's content container must be visibly rendered. Without that
last gate, a list that hasn't arrived yet is recorded as a nearly empty screen.

**A label the app renders but never associated is still the label.** Three date fields
whose accessible name is `yyyy-mm-dd` are three controls with one name. "From Date" is
what a person reads, so the crawl walks out from the control until it finds that.

**A `<table>` with no header row is a layout table, not a collection.** One app in the
corpus has dozens.

**A screen's identity is its URL pattern, anchored.** Without the anchor, `/#Contact` also
matches `/#Contact/view/123`.

---

## Who built this, and why

I'm [Tsvetomir Banovski](https://github.com/banovski1). I write test automation, and I got
tired of watching agents write tests from guesses: a plausible selector, a button name
that is almost right, a test that fails on step three.

The interesting part was never generating test code. Any LLM can do that. The interesting
part is **knowing the application well enough that the code is right the first time**, and
**being honest about which screens aren't known well enough yet.**

So the whole design is organised around evidence. Authentication is verified against the
running app rather than read out of source and believed. A locator is recorded only when
the crawl proved it resolves to one element. A screen the crawl couldn't reach is marked
`crawled: false` rather than guessed at. And when the evidence is thin, the score says so
and asks for a recording.

If that resonates, or you want to talk about testing, agents, or any of the decisions
above, [open an issue](https://github.com/banovski1/qa-context/issues) or find me on
[GitHub](https://github.com/banovski1).

---

## Where to go next

| | |
| --- | --- |
| [**RUNBOOK.md**](RUNBOOK.md) | run any phase by hand, and what to do when something breaks |
| [**CLAUDE.md**](CLAUDE.md) | the architecture, and every rule with the reason it exists |
| [**CONTRIBUTING.md**](CONTRIBUTING.md) | how to send a change, and what a good one looks like |
| `scripts/analysis/README.md` | the `analysis.json` contract, section by section |

## Support this project

qa-context is Apache-2.0 and free to use. If it saved your agents a week of guessing,
[**sponsor it**](https://github.com/sponsors/banovski1). It funds the corpus of apps every
crawler change is validated against.

## Licence

[Apache-2.0](LICENSE) © Tsvetomir Banovski.

Contributions are licensed under the same terms. Apache-2.0 includes an explicit
contribution grant (section 5), so there is nothing extra to sign.
