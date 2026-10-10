# analysis

`analysis.json` — everything known about one application, in one file.

There were sixteen files here, five of them markdown reports, plus a separate
`app-model.json` holding the compiled half. Answering "what can I address on this
screen?" meant opening two of them and joining by path.

## Ten sections, always all ten

| section | owner | holds |
| --- | --- | --- |
| `app` | app-dossier | name, baseUrl, repoPath, repoCommit, stack |
| `source` | app-dossier | declared routes, entities, dependencies, existing tests, self-documentation |
| `conventions` | app-components | the UI library, region selectors, how a label reaches an input |
| `api` | app-api | endpoints, tiers, spec, `auth`, `authVerification`, `resources` (derived) |
| `map` | app-explorer (`map.mjs`) | the menu map: modules, menu entries, and each screen's buttons, fields and tables |
| `components` | compile-model | the locator layer. **The only place a selector may appear** |
| `screens` | app-explorer, enriched by compile-model | one entry per screen |
| `testability` | compile-model | the roll-up, and the recordings that raised it |
| `recordings` | app-recorder (`ingest-recording.ts`) | what a human's recording saw: steps, routes, and the requests the flow provoked |
| `stats` | compile-model | the counts a review reads first |

A section present but empty means its skill has not run. `check-model.ts` names it.

## Writing a section

```bash
npx tsx scripts/analysis/write-section.ts --section api --file /tmp/api.json
```

One key is replaced; every other byte is left alone. That is what lets four writers share
one file without any of them merging the others, and what keeps a re-run of one skill to
a diff of its own work. Nothing edits `analysis.json` by hand.

## Two writers on `screens`, in order

The explorer writes what it observed — controls, tables, links, headings. The compiler
then adds what it derived to the same entries: the page object's name, the components
mapped onto it, the transitions it proved, and the confidence. Everything about one
screen is in one entry.

The compiler therefore writes back into a section it reads, which makes `crawled: false`
load-bearing: it marks a screen the compiler added for a declared route no crawl reached,
and stops the next compile counting it as something the crawl found. `compiling twice
over its own output changes nothing` is the test that holds this.

## Testability

`screens[].testability.confidence` answers one question: is there enough here to address
the controls a test would touch? **>= 0.7 write the test. 0.3-0.7 record the flow first.
Below 0.3 the screen is a URL and little else.** A low score is a request for evidence,
not a defect in the app — a crawl says what is on a page, and only a recording says what
a click leads to.
