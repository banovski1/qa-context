/**
 * Fold what a human recorded into what the crawl found.
 *
 * A recording used to raise one number and contribute nothing else: the routes it
 * walked, the controls it touched and the endpoints it provoked went into a Markdown
 * file no tool read. So the second recording of an app cost exactly what the first one
 * did, for ever. This is the pass that makes a recording pay for itself.
 *
 * **Additive only, and the crawl always wins.** A recording proves that a human
 * addressed one element once. It does not prove — and cannot prove — that a second
 * element does not carry the same handle, which is the single thing the crawl exists to
 * establish. So a recorded control may fill a gap and may never replace a proof. Where
 * the two disagree the disagreement is counted in `stats` and the crawl's answer stands,
 * because a locator that silently became less certain between two compiles is a failure
 * nobody would look for.
 *
 * Pure: an analysis in, a new analysis out. No I/O, no clock, no ordering that depends
 * on anything but its input — which is what lets the whole of it sit under the snapshot
 * suite.
 */
import { classify, nameIn } from '../analysis/locator-rung.ts';
import type {
  Analysis, AnalysisControl, AnalysisScreen, AnalysisRecording, RecordedStep,
} from '../analysis/analysis-types.ts';

/** Below this rung a locator names a position or a chunk of markup, not a control. */
const USABLE_RUNG = 6;

const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, ' ').trim();
const pascal = (s: string) => clean(s).split(' ').filter(Boolean)
  .map(w => w[0].toUpperCase() + w.slice(1)).join('');
const camel = (s: string) => { const p = pascal(s); return p ? p[0].toLowerCase() + p.slice(1) : ''; };

/** The role a recorded locator names, when it names one at all. */
function roleIn(locator: string): string | null {
  const m = locator.match(/^\s*getByRole\(\s*(['"`])(.*?)\1/);
  if (m) return m[2];
  if (/^\s*getByLabel\(|^\s*getByPlaceholder\(/.test(locator)) return 'textbox';
  return null;
}

/**
 * A recorded step, as a control — or null if the step names no control.
 *
 * A step whose locator is positional or raw CSS is evidence that something is there and
 * evidence that nothing can address it. Inventing a control from it would put a name in
 * the analysis that no test could ever resolve, which is worse than the gap it fills.
 */
function controlFrom(step: RecordedStep): AnalysisControl | null {
  if (!step.rawLocator) return null;
  const { rung, stable } = classify(step.rawLocator);
  // Trust the ingest's recorded rung over a re-classification, so a change to the ladder
  // does not silently re-interpret recordings already in the file.
  const effective = Number.isFinite(step.rung) ? step.rung : rung;
  if (!stable || effective > USABLE_RUNG) return null;

  const name = nameIn(step.rawLocator);
  if (!name) return null;

  const isField = step.action === 'fill' || step.action === 'select'
    || step.action === 'check' || step.action === 'uncheck';

  return {
    role: roleIn(step.rawLocator),
    name,
    // The recorder reads the name off the page the way a test would; if it had come from
    // a proximity walk the ingest would have said so, and it does not guess.
    nameSource: 'accessible',
    label: isField ? name : null,
    placeholder: null,
    field: isField ? camel(name) : null,
    region: 'main',
    visible: true,
    disabled: false,
    href: null,
    // A step that ran is a step whose locator resolved to something clickable. That is
    // one match at that moment — not a proof of uniqueness, which `source` records.
    matches: 1,
    y: 0,
    source: 'recording',
  };
}

/** An empty screen for a route only the recorder ever reached. */
function screenFrom(route: { path: string; url: string; headings: string[] }): AnalysisScreen {
  return {
    path: route.path,
    url: route.url,
    title: route.path,
    headings: route.headings.map((text, i) => ({ level: 1, text, y: i * 10 })),
    tables: [],
    controls: [],
    links: [],
    // Both marks are load-bearing and neither implies the other. `crawled: false` stops a
    // recompile counting this as something the crawl found; `recordedOnly` says the
    // controls below it are real observations rather than an empty declared route.
    crawled: false,
    recordedOnly: true,
  };
}

/**
 * The transitions a recording proves.
 *
 * A crawl can only prove a transition it took deliberately; a recording proves whatever
 * the human happened to do, which is the more interesting half — "clicking Add on the
 * employee list lands you on the add form" is exactly the fact a crawl of either page
 * never establishes. The evidence is a navigation that follows a click, with no
 * navigation between them.
 */
function transitionsIn(steps: RecordedStep[]): { from: string; via: string; to: string }[] {
  const out: { from: string; via: string; to: string }[] = [];
  let lastClick: { from: string; via: string } | null = null;
  let current: string | null = null;

  for (const step of steps) {
    if (step.action === 'goto') {
      if (lastClick && step.screenPath && step.screenPath !== lastClick.from) {
        out.push({ from: lastClick.from, via: lastClick.via, to: step.screenPath });
      }
      current = step.screenPath ?? current;
      lastClick = null;
      continue;
    }
    if (step.action === 'click' && step.rawLocator) {
      const name = nameIn(step.rawLocator);
      const from: string | null = step.screenPath ?? current;
      lastClick = name && from ? { from, via: name } : null;
      continue;
    }
    // Anything else (a fill, a keypress) is not a transition and breaks the pairing:
    // the click that preceded it plainly did not navigate.
    lastClick = null;
  }
  return out;
}

/**
 * Merge every recording's evidence into the analysis.
 *
 * Order is fixed and deliberate: routes first so a control always has a screen to land
 * on, then controls, then transitions, then endpoints. Running it twice produces the
 * same file as running it once — every step asks whether the fact is already present
 * before adding it — which matters because this runs inside the compiler, and the
 * compiler is expected to be re-runnable without accumulating anything.
 */
export function mergeRecordings(analysis: Analysis): Analysis {
  const out: Analysis = structuredClone(analysis);
  const recordings: AnalysisRecording[] = out.recordings ?? [];
  // A fixture analysis carries only the sections its test is about, and the compiler
  // runs this on whatever it was handed. Defaulting the keys this pass writes to is
  // cheaper than a second empty-shape constant that could drift from the first.
  out.screens ??= [];
  out.stats ??= {};
  out.api ??= { apiPrefix: null, tiers: {}, spec: {}, auth: null, endpoints: [] };
  out.api.endpoints ??= [];

  let conflicts = 0;
  let unresolved = 0;
  let addedScreens = 0;
  let addedControls = 0;
  let addedActions = 0;
  let addedEndpoints = 0;

  // Everything this pass adds is *derived* from the recordings, so it is rebuilt from
  // them rather than added to whatever is already in the file. Without this, a merge that
  // used to compute something differently leaves its old answer behind for ever, and a
  // recording that was re-recorded keeps contributing the controls it no longer has.
  for (const screen of out.screens) {
    screen.controls = (screen.controls ?? []).filter(c => c.source !== 'recording');
    if (screen.actions) screen.actions = screen.actions.filter(a => a.provenBy !== 'recording');
    if (screen.recordedOnly) delete screen.recordedOnly;
  }

  const byPath = new Map(out.screens.map(s => [s.path, s]));

  for (const rec of recordings) {
    // --- routes ------------------------------------------------------------------
    for (const route of rec.routes) {
      let screen = byPath.get(route.path);
      if (!screen) {
        screen = screenFrom(route);
        out.screens.push(screen);
        byPath.set(route.path, screen);
        addedScreens += 1;
        continue;
      }
      // A heading the crawl missed is the cheapest thing a recording contributes, and
      // the one a test needs most: without it there is nothing to assert the screen by.
      if (!screen.headings.length && route.headings.length) {
        screen.headings = route.headings.map((text, i) => ({ level: 1, text, y: i * 10 }));
      }
    }

    // --- controls ----------------------------------------------------------------
    for (const step of rec.steps) {
      if (step.action === 'goto' || !step.screenPath) continue;
      const screen = byPath.get(step.screenPath);
      if (!screen) continue;

      const control = controlFrom(step);
      if (!control) {
        if (step.rawLocator) unresolved += 1;
        continue;
      }
      const existing = screen.controls.find(c => c.name === control.name);
      if (existing) {
        // The crawl proved this one. A recording cannot improve on a proof, and the
        // disagreement is worth counting even though nothing is applied.
        if (existing.source !== 'recording') conflicts += 1;
        continue;
      }
      screen.controls.push(control);
      addedControls += 1;
      // A declared route the crawl never reached now has an observed control on it. It
      // stays `crawled: false` — no crawl reached it and none is being claimed — but it
      // is no longer an empty shell, and the compiler must stop skipping it or these
      // controls reach the file and never reach a page object.
      if (screen.crawled === false) screen.recordedOnly = true;
    }

    // --- transitions --------------------------------------------------------------
    for (const t of transitionsIn(rec.steps)) {
      const screen = byPath.get(t.from);
      if (!screen || !byPath.has(t.to)) continue;
      screen.actions ??= [];
      // Matched on `via` alone, not on the destination: at this level `leadsTo` is still
      // a path, and by the time the compiler has written the file back it is a page-object
      // name. Comparing destinations would fail to recognise the action it wrote last run
      // and append a second copy of it on every compile.
      const already = screen.actions.some(a => a.via === camel(t.via) && a.leadsTo === t.to);
      if (already) continue;
      // `via` is the property name the control carries in `uses`, not the label — a test
      // calls `await this.<via>.click()`, and a label with a space in it is not a
      // property. It is the same `camel(label)` the compiler uses to name the control.
      screen.actions.push({
        name: 'goTo' + pascal(t.via), via: camel(t.via), leadsTo: t.to, provenBy: 'recording',
      });
      addedActions += 1;
    }

    // --- endpoints ----------------------------------------------------------------
    for (const req of rec.requests) {
      // A document navigation is the browser fetching a page. It is already a route, and
      // calling it an endpoint would offer a precondition that cannot set anything up.
      if (req.kind === 'document') continue;
      const endpoints = out.api.endpoints as Record<string, unknown>[];
      const already = endpoints.some(e => e.path === req.path && e.method === req.method);
      // An endpoint read out of source carries its declared shape; the observed one is a
      // single sample. Where both exist the declaration is the better record.
      if (already) continue;
      endpoints.push({
        method: req.method,
        path: req.path,
        status: req.status,
        requestShape: req.requestShape,
        responseShape: req.responseShape,
        source: 'recording',
        observedIn: rec.flow,
      });
      addedEndpoints += 1;
    }
  }

  out.stats = {
    ...out.stats,
    recordings: recordings.length,
    recordedScreens: addedScreens,
    recordedControls: addedControls,
    recordedActions: addedActions,
    recordedEndpoints: addedEndpoints,
    // A recorded control the crawl already proved. Not a problem — evidence that the two
    // halves agree about what is on the screen.
    recordingConflicts: conflicts,
    // A step whose locator names a position or a chunk of markup. This is the number that
    // says a re-crawl would help, and no further recording would.
    recordingUnresolved: unresolved,
  };

  return out;
}
