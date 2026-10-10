// Pure: analysis.json in, analysis.json out — the compiler fills in the five sections
// no skill owns.
// No network, no browser, no judgement that is not stated as a constant below. This is
// the determinism boundary: everything above it is skill output reviewed by eye,
// everything from here down is snapshot-tested code.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// The profile's login steps are the one flow the analysis knows: a crawl cannot run
// without performing it. Carrying it into the model is what lets the generator emit a
// working login instead of a placeholder.
// @ts-ignore -- a deliberately small YAML reader, shared with the explorer
import { loadProfile, ROOT as REPO_ROOT } from '../config/profile.mjs';
import { readAnalysis, writeSection } from '../analysis/analysis-file.ts';
import { scoreScreens, verdictFor } from '../analysis/testability.ts';
import { deriveResources, tagEndpoints } from './api-resources.ts';
import { mergeRecordings } from './merge-recordings.ts';
import { mountPrefix } from './mount.ts';
import type { AppModel, ComponentDef, ComponentUse, Screen, LocatorSpec } from './model-types.ts';
import { pathToFileURL } from 'node:url';

/** A region is shared when it recurs on this many screens... */
export const RECURRENCE_MIN_SCREENS = 2;
/** ...with at least this proportion of its controls present on each. */
export const RECURRENCE_MIN_CONTROL_MATCH = 0.7;
/** ...and carrying at least this many controls, or it is a crawl partition, not a class. */
export const MIN_REGION_CONTROLS = 3;

interface CrawlElement {
  tag: string; type: string | null; role: string | null; name: string;
  label: string | null; placeholder: string | null; id: string | null;
  nameAttr: string | null; testId: string | null; data: Record<string, string>;
  nameSource?: 'accessible' | 'proximity' | null;
  region: string; visible: boolean; disabled: boolean; href: string | null;
  locator: { strategy: string; args: string[]; matchCount: number };
  candidates?: { strategy: string; args: string[]; matchCount: number }[];
  box?: { x: number; y: number; w: number; h: number };
  unique: boolean; fragile: boolean;
}
interface CrawlScreen {
  url: string; path: string; title: string;
  headings: { level: number; text: string }[];
  tables: { columns: string[]; rowCount: number }[];
  elements: CrawlElement[];
  links: { href: string; resolved: string; text: string }[];
}

// A selector, not a label: leading sigil, a combinator, an attribute test, or Playwright
// syntax. A label may contain a dot ("A.Beike") or a bracket; only these shapes are banned.
const CSS_SHAPED = /^\s*[.#\[]|[>~]\s*[.#\w]|:nth-|:has\(|\[[\w-]+[~^$*|]?=|^locator\(|^getBy/;

// An application that renders its labels through innerHTML can put markup in one, and
// "<strong>without</strong> multiselect" carries a `>w` that reads exactly like a child
// combinator. The tags are not what makes a string a selector, so take them out before
// asking: a real selector is still a selector without them, and a sentence is still a
// sentence.
const withoutMarkup = (value: string) => value.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');

/** Invariant 1: a screen may carry English, never a selector. Enforced, not intended. */
export function assertNoSelectors(screens: Screen[]): void {
  for (const s of screens) {
    for (const u of s.uses) {
      for (const [k, v] of Object.entries(u)) {
        if (typeof v !== 'string' || k === 'as' || k === 'component') continue;
        if (CSS_SHAPED.test(withoutMarkup(v))) {
          throw new Error(
            `${s.name}.${u.as}: identity "${k}" looks like a selector (${v}). ` +
            `A screen carries labels; a component owns selectors.`,
          );
        }
      }
    }
  }
}

const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, ' ').trim();
const pascal = (s: string) => clean(s).split(' ').filter(Boolean)
  .map(w => w[0].toUpperCase() + w.slice(1)).join('');
const camel = (s: string) => { const p = pascal(s); return p ? p[0].toLowerCase() + p.slice(1) : ''; };

/** A page's identity is its full parameterless path; params are record slots, not identity. */
export function pathIdentity(path: string): string {
  return path.split('/').filter(seg => seg && !/^[:{]/.test(seg)).join('/');
}

/** Named from trailing segments, extended toward the root only while two pages collide. */
export function assignPageNames(paths: string[]): Map<string, string> {
  // A route made only of parameters ("/{user}/{type}") has no literal segment to be
  // named from, but the parameter names describe it perfectly well.
  const nameSegs = (p: string) => {
    const literal = pathIdentity(p).split('/').filter(Boolean);
    if (literal.length) return literal;
    return p.split('/').filter(Boolean).map(seg => seg.replace(/[{:}]/g, ''));
  };
  const segs = new Map(paths.map(p => [p, nameSegs(p)]));
  const out = new Map<string, string>();
  const taken = new Set<string>();
  const depthOf = new Map(paths.map(p => [p, 1]));
  for (let round = 0; round < 6; round++) {
    const byName = new Map<string, string[]>();
    for (const p of paths) {
      const s = segs.get(p)!;
      const d = Math.min(depthOf.get(p)!, s.length);
      const name = pascal(s.slice(s.length - d).join(' ')) || 'Home';
      byName.set(name, [...(byName.get(name) ?? []), p]);
    }
    let collided = false;
    for (const [name, ps] of byName) {
      if (ps.length === 1) { out.set(ps[0], name); continue; }
      for (const p of ps) {
        if (depthOf.get(p)! < segs.get(p)!.length) { depthOf.set(p, depthOf.get(p)! + 1); collided = true; }
        else out.set(p, name);
      }
    }
    if (!collided) break;
  }
  // Anything still colliding is a genuine ambiguity: two components on one path.
  const final = new Map<string, string>();
  for (const p of paths) {
    let stem = out.get(p) ?? pascal(pathIdentity(p));
    if (!/^[A-Za-z_]/.test(stem)) stem = 'Record' + stem; // "/#User/view/1" is not a class name
    const base = (stem || 'Home') + 'Page';
    let name = base; let n = 2;
    while (taken.has(name)) name = base.replace(/Page$/, String(n++) + 'Page');
    taken.add(name); final.set(p, name);
  }
  return final;
}

/** Which generated class addresses this element, from role and tag alone. */
function fieldComponentFor(el: CrawlElement): string | null {
  const r = el.role ?? '';
  if (r === 'button') return 'Button';
  if (r === 'link') return 'Link';
  if (r === 'checkbox') return 'Checkbox';
  if (r === 'radio') return 'RadioButton';
  if (r === 'combobox' || el.tag === 'select') return 'Select';
  // A switch is a checkbox that renders as a slider; it answers check/uncheck the same way.
  if (r === 'switch') return 'Checkbox';
  if (r === 'searchbox' || r === 'textbox') return 'TextField';
  if (r === 'tab') return 'Tab';
  if (r === 'menuitem') return 'MenuItem';
  return null;
}

/**
 * Strategies whose expression is a sentence about the app rather than about the DOM's
 * current shape. The ladder itself lives in the crawler (rank-locators.js); this is the
 * compiler's copy of where the semantic half of it ends.
 */
const SEMANTIC_STRATEGIES = new Set(['testId', 'role', 'label', 'placeholder', 'proximity', 'scoped']);

/**
 * How many elements the crawl saw for this element's *semantic* handle.
 *
 * The crawl records `unique: true` whenever some candidate resolved to one element —
 * including a positional CSS path, which always does. That is structural luck, and it
 * was being read as a semantic result: two fields sharing a placeholder both came out
 * as `{ label: 'Type for hints...' }`, each resolving to two elements at run time.
 * `fragile` already marks the difference; this reads the count behind it.
 */
function semanticMatches(el: CrawlElement, id: { label?: string; field?: string; via?: string }): number {
  const value = id.label ?? id.field ?? '';
  const semantic = (el.candidates ?? []).filter(c => SEMANTIC_STRATEGIES.has(c.strategy));
  const forThisHandle = semantic.filter(c => c.args?.includes(value));
  const pool = forThisHandle.length ? forThisHandle : semantic;
  if (!pool.length) return el.fragile ? Infinity : 1;
  return Math.min(...pool.map(c => c.matchCount));
}

/**
 * A handle as the accessibility tree reports it: runs of whitespace collapse to one
 * space. The browser computes an accessible name that way, so a label carrying the
 * newlines and tabs of the markup it was read from cannot match the name it came from —
 * the getter would be emitted, typecheck, and resolve to nothing at run time.
 */
const flatten = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The element's English handle, preferring what a human would recognise. */
function identityOf(el: CrawlElement): { label?: string; field?: string; via?: 'proximity' } | null {
  const name = flatten(el.name || '');
  // A proximity name has to be marked, or the runtime asks the accessibility tree for a
  // name the app never put there and every getter on the screen fails with NOT_FOUND.
  if (name) return el.nameSource === 'proximity' ? { label: name, via: 'proximity' } : { label: name };
  const label = flatten(el.label || el.placeholder || '');
  if (label) return { label };
  const dataName = el.data?.['data-name'] ?? el.nameAttr ?? null;
  if (dataName) return { field: dataName };
  if (el.testId) return { field: el.testId };
  return null;
}

/**
 * Decide, for one screen, which controls a test can actually address.
 *
 * This is a screen-level question, not an element-level one, and treating it as the
 * latter is what produced `select, select2, select4, select5` — four getters carrying
 * one identical locator between them. A handle that addresses two elements is not made
 * safe by a numeric suffix on the property name: both getters resolve to both elements,
 * and the failure surfaces as AMBIGUOUS inside a test instead of here.
 *
 * So: group the screen's controls by the handle they would be emitted with. A group of
 * one is addressable. A larger group is retried with the heading each control sits
 * under, which is the disambiguator a person would reach for — and it is accepted only
 * when it genuinely separates every member. Whatever is still ambiguous is unverified,
 * and the page object says how many rather than pretending.
 */
function addressableIdentities(
  els: CrawlElement[],
  headingFor: (el: CrawlElement) => string | undefined,
): Map<CrawlElement, { label?: string; field?: string; within?: string; via?: 'proximity' }> {
  const out = new Map<CrawlElement, { label?: string; field?: string; within?: string; via?: 'proximity' }>();
  const groups = new Map<string, { el: CrawlElement; id: { label?: string; field?: string; via?: 'proximity' } }[]>();

  for (const el of els) {
    const id = identityOf(el);
    if (!id) continue;
    const key = `${fieldComponentFor(el)}|${id.label ?? ''}|${id.field ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), { el, id }]);
  }

  for (const members of groups.values()) {
    if (members.length === 1) {
      const [{ el, id }] = members;
      // One on this screen, but the crawl may still have seen the same handle resolve
      // to several elements — a control the crawl skipped, or one outside its region.
      if (semanticMatches(el, id) <= 1) out.set(el, id);
      continue;
    }
    const headings = members.map(m => headingFor(m.el));
    const distinct = new Set(headings.filter(Boolean));
    if (headings.every(Boolean) && distinct.size === members.length) {
      members.forEach((m, i) => out.set(m.el, { ...m.id, within: headings[i] as string }));
    }
    // Otherwise every member stays out. Four controls called "Select" under one heading
    // cannot be told apart by anything this analysis holds, and saying so is the result.
  }
  return out;
}

/**
 * The heading a control sits under: the nearest one above it on the page.
 *
 * Two "Type for hints..." fields on one screen are told apart by the section each
 * belongs to, which is what a person reads to tell them apart too. Geometry is the only
 * evidence the crawl keeps about that relationship, so this uses the vertical order the
 * crawl recorded rather than the DOM tree it did not.
 */
function headingResolver(crawl: CrawlScreen): (el: CrawlElement) => string | undefined {
  const headings = (crawl.headings ?? [])
    .map(h => ({ text: h.text?.trim() ?? '', y: (h as { y?: number }).y ?? -1 }))
    .filter(h => h.text && h.y >= 0)
    .sort((a, b) => a.y - b.y);
  if (!headings.length) return () => undefined;
  return (el: CrawlElement) => {
    const y = el.box?.y;
    if (y === undefined) return undefined;
    let found: string | undefined;
    for (const h of headings) {
      if (h.y <= y) found = h.text;
      else break;
    }
    return found;
  };
}

const controlKey = (el: CrawlElement) => `${el.role ?? el.tag}|${(el.name || '').trim()}`;


/**
 * Regions that are really table rows.
 *
 * A list of fifty records puts a hundred nameless action buttons on the page, all in
 * one region and each addressable only by its position in the list. They are the
 * collection's business, not the screen's — but only when the crawl actually found the
 * table. When it did not, they used to arrive as `control1 … control102` on the page
 * object. Their shape gives them away without needing the table: a region whose
 * controls are overwhelmingly unnamed and positionally addressed is a row region.
 */
const ROW_REGION_MIN_CONTROLS = 8;
const ROW_REGION_MIN_ANONYMOUS = 0.8;

function collectionRegionsOf(crawl: CrawlScreen): Set<string> {
  const byRegion = new Map<string, CrawlElement[]>();
  for (const el of crawl.elements) {
    if (!el.visible) continue;
    byRegion.set(el.region, [...(byRegion.get(el.region) ?? []), el]);
  }
  const out = new Set<string>();
  for (const [region, els] of byRegion) {
    if (els.length < ROW_REGION_MIN_CONTROLS) continue;
    const anonymous = els.filter(e => !(e.name || '').trim() || e.fragile).length;
    if (anonymous / els.length >= ROW_REGION_MIN_ANONYMOUS) out.add(region);
  }
  return out;
}


/**
 * What to call a collection on a page object.
 *
 * `document.title` was the old answer, which on any app with a constant title names
 * every table after the product — `leaveList.orangeHRM.expectRow(...)` reads as nonsense.
 * The heading above the list is what a person would say, and it is already plural; the
 * screen's own name is next; `records` is the honest fallback.
 */
function collectionName(pageName: string | undefined, crawl: CrawlScreen): string {
  // The heading first: it is the word the app itself puts above the list, and it is
  // already plural where the screen name is not — "Contacts", not "contact".
  const heading = camel(crawl.headings?.[0]?.text ?? '');
  if (heading) return heading;
  const fromPage = camel((pageName ?? '').replace(/Page$/, '').replace(/^View/, ''));
  return fromPage || 'records';
}

/** Rule 3: a region recurring on >=N screens with >=M of its controls shared is a class. */
function discoverRegions(screens: CrawlScreen[], conventions: any) {
  const declared: Record<string, any> = {};
  for (const r of conventions?.regions ?? []) declared[r.name] = r;

  const byRegion = new Map<string, { screen: string; keys: Set<string>; els: CrawlElement[] }[]>();
  for (const s of screens) {
    const groups = new Map<string, CrawlElement[]>();
    for (const el of s.elements) {
      if (!el.visible || !el.unique) continue;
      groups.set(el.region, [...(groups.get(el.region) ?? []), el]);
    }
    for (const [region, els] of groups) {
      const named = els.filter(e => (e.name || '').trim() && fieldComponentFor(e));
      if (!named.length) continue;
      byRegion.set(region, [
        ...(byRegion.get(region) ?? []),
        { screen: s.path, keys: new Set(named.map(controlKey)), els: named },
      ]);
    }
  }

  const components: Record<string, ComponentDef> = {};
  const regionClassOf = new Map<string, string>();
  const sharedKeys = new Map<string, Set<string>>();

  for (const [region, instances] of byRegion) {
    if (instances.length < RECURRENCE_MIN_SCREENS) continue;
    const counts = new Map<string, number>();
    for (const inst of instances) for (const k of inst.keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    const shared = [...counts.entries()]
      .filter(([, n]) => n / instances.length >= RECURRENCE_MIN_CONTROL_MATCH)
      .map(([k]) => k);
    if (!shared.length) continue;

    // The declared conventions supply the name and the root; recurrence supplies
    // membership. A region with no declared root is a crawl partition ("body", "footer"),
    // not a component: it has no selector of its own to own, so it is left inline.
    const decl: any = Object.values(declared).find((d: any) =>
      !d.row && (d.name || '').toLowerCase().includes(region.toLowerCase()));
    if (!decl?.selector || shared.length < MIN_REGION_CONTROLS) continue;
    const className = decl.name;
    const controls: Record<string, LocatorSpec> = {};
    const sample = new Map<string, CrawlElement>();
    for (const inst of instances) for (const el of inst.els) if (!sample.has(controlKey(el))) sample.set(controlKey(el), el);
    for (const k of shared) {
      const el = sample.get(k)!;
      const prop = camel(el.name) || camel(k);
      if (prop) controls[prop] = { strategy: el.locator.strategy as any, args: el.locator.args };
    }
    components[className] = {
      kind: 'region',
      root: { strategy: 'css', args: [decl.selector] },
      controls,
      seenOn: instances.length,
      description: `${region} region — ${Object.keys(controls).length} controls shared across ${instances.length} screens`,
    };
    regionClassOf.set(region, className);
    sharedKeys.set(region, new Set(shared));
  }
  return { components, regionClassOf, sharedKeys };
}

/** The first column that identifies a row: a link column, else the first text column. */
export function pickKeyColumn(columns: string[]): string | null {
  const usable = columns.filter(c => c && !/select all|^\s*$/i.test(c));
  return usable[0] ?? null;
}

function uniqueProp(taken: Set<string>, raw: string): string {
  const base = /^[A-Za-z_]/.test(raw) ? raw : raw ? `control${pascal(raw)}` : 'control';
  let name = base; let n = 2;
  while (taken.has(name)) name = `${base}${n++}`;
  taken.add(name);
  return name;
}

/**
 * The newest input, not the clock.
 *
 * A wall-clock stamp makes every recompile a diff, which is exactly the noise that hides
 * a real change — and this repo's whole review model is that a model diff means the
 * output moved. Stamping the newest input keeps the field meaningful (it dates the
 * analysis) while making a no-op recompile produce no diff at all.
 */
export function newestInput(appDir: string): string {
  const files = ['analysis.json', '.env']
    .map(f => join(appDir, f))
    .filter(existsSync);
  const newest = files.reduce((max, f) => Math.max(max, statSync(f).mtimeMs), 0);
  return new Date(newest).toISOString();
}

export function compile(appDir: string, now = newestInput(appDir)): AppModel {
  // One input file. Each skill owns one section of it, and the compiler reads all of them.
  const raw: any = JSON.parse(readFileSync(join(appDir, 'analysis.json'), 'utf8'));
  // What a human recorded joins what the crawl found before anything is derived from
  // either, so a recorded control takes part in recurrence detection like any other. A
  // merge that ran afterwards would contribute controls to screens and never to
  // components, which is half the point of recording.
  const analysis: any = mergeRecordings(raw);
  // Kept aside because the model's own `stats` is built at the very end, from the
  // compiled screens, and would otherwise replace these wholesale.
  const recordingStats = Object.fromEntries(
    Object.entries(analysis.stats ?? {}).filter(([k]) => k.startsWith('record')),
  );
  const dossier = { ...analysis.app, ...analysis.source.stack };
  const routes = { routes: analysis.source.routes ?? [] };
  const conventions = analysis.conventions ?? { regions: [] };
  const api = analysis.api ?? { endpoints: [], auth: null };
  // The hand-written configuration now lives in one flat `.env` at the root rather than a
  // YAML profile beside the artifact. A fixture directory has no `.env` and needs none —
  // only the UI-login block is read from here — so a missing one is not an error.
  let profile: any = {};
  try { profile = loadProfile(); } catch { profile = {}; }

  // The distilled screen carries `controls` and a per-control `matches`; the compiler's
  // own vocabulary is `elements` with a candidate ladder, so translate once here rather
  // than teaching every function downstream about both shapes.
  // The compiler writes back into the section it reads, so a declared-but-unreached
  // screen it added last run must not be mistaken for something a crawl found this run.
  // `crawled: false` is the marker the compiler itself put there; a screen the explorer
  // just wrote carries no such key at all.
  // A recorded-only screen also carries `crawled: false` — the crawl really never
  // reached it — but its controls are observations a human made, not the empty shell the
  // compiler leaves behind for a declared route. Excluding it here would merge a
  // recording's controls into the file and then compile as though they were not there.
  const crawled: CrawlScreen[] = (analysis.screens ?? [])
    .filter((s: any) => s.crawled !== false || s.recordedOnly === true)
    .map((s: any) => ({
      ...s,
      elements: (s.controls ?? []).map((c: any) => ({
        tag: '', type: null, role: c.role, name: c.name, nameSource: c.nameSource,
        label: c.label, placeholder: c.placeholder, id: null, nameAttr: c.field,
        testId: null, data: {}, region: c.region, visible: c.visible, disabled: c.disabled,
        href: c.href, box: { x: 0, y: c.y, w: 0, h: 0 },
        // The region component is emitted from these args, so they have to be the same
        // pair the crawl chose: role and accessible name, or the field identifier.
        locator: c.name
          ? { strategy: 'role', args: [c.role ?? '', c.name], matchCount: c.matches }
          : { strategy: 'scoped', args: [c.field ?? ''], matchCount: c.matches },
        candidates: [{ strategy: 'role', args: [c.name], matchCount: c.matches < 0 ? Infinity : c.matches }],
        // Every control in the section is one the crawl resolved; `matches` says whether
        // it did so semantically. `-1` — no semantic handle at all — must still reach the
        // screen loop, or a control the crawl saw and could not name vanishes from the
        // report instead of being counted in `unverified`.
        unique: true,
        fragile: c.matches !== 1,
      })),
    }));

  const { components, regionClassOf, sharedKeys } = discoverRegions(crawled, conventions);

  // Field components are parameterised and always present: one class per role, not per element.
  // None of them carries a selector. How a label reaches an input is one app-wide fact, it is
  // `conventions.labelAssociation`, and the runtime reads it from there as FIELD_TEMPLATE —
  // copying it onto eight components said the same thing eight times and said it wrongly on
  // the four that address their control by visible text, not by a label beside an input.
  for (const [name, desc] of Object.entries({
    TextField: 'a text input or textarea, addressed by its label',
    Select: 'a select or combobox, addressed by its label',
    Checkbox: 'a checkbox, addressed by its label',
    RadioButton: 'a radio button, addressed by its label',
    Button: 'a button, addressed by its visible text',
    Link: 'a link, addressed by its visible text',
    Tab: 'a tab, addressed by its visible text',
    MenuItem: 'a menu item, addressed by its visible text',
  })) {
    components[name] = { kind: 'field', seenOn: 0, description: desc };
  }

  const tableConv = (conventions?.regions ?? []).find((r: any) => r.row && r.cell);
  // Which crawl region the collection component covers, matched by name the same way
  // regions are: "RecordTable" covers the crawl's "table" partition.
  const collectionRegion = tableConv
    ? ['table', 'grid', 'list'].find(r => (tableConv.name || '').toLowerCase().includes(r)) ?? null
    : null;
  if (tableConv) {
    components.RecordTable = {
      kind: 'collection',
      root: { strategy: 'css', args: [tableConv.selector] },
      table: { row: tableConv.row, cell: tableConv.cell, headerCell: tableConv.headerCell, rowKeyAttribute: tableConv.rowKey },
      seenOn: 0,
      description: 'a data table whose rows are addressed by the value in their key column',
    };
  }

  // Routes are the union: declared + crawled, matched on path.
  // The source declares routes relative to the app's mount ("/pim/viewEmployeeList"); the
  // crawl records `location.pathname` ("/web/index.php/pim/viewEmployeeList"), and the
  // emitted `goto(path)` resolves a leading slash against the origin. So a declared route
  // takes the base URL's path as its prefix, or the two halves never join.
  const mount = mountPrefix(dossier.baseUrl);
  const declaredByPath = new Map<string, any>();
  for (const r of routes.routes ?? []) {
    const full = mount && !r.path.startsWith(mount + '/') ? mount + r.path : r.path;
    declaredByPath.set(full, { ...r, path: full });
  }
  // A crawl reaches concrete records ("/#User/view/1"); the source declares the shape
  // ("/#User/view/{id}"). They are one screen, and the declared path is its identity —
  // an id is a record slot, never a page. The concrete URL survives as an alias.
  const paramRoutes = [...declaredByPath.keys()]
    .filter(p => /[{:]/.test(p))
    .map(p => ({
      path: p,
      re: new RegExp('^' + p.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?[{:][^/}]*\}?/g, '[^/]+') + '$'),
    }));
  const crawledByPath = new Map<string, CrawlScreen>();
  const aliases = new Map<string, string[]>();
  for (const s of crawled) {
    const declared = declaredByPath.has(s.path)
      ? s.path
      : paramRoutes.find(r => r.re.test(s.path))?.path;
    const key = declared ?? s.path;
    if (declared && declared !== s.path) aliases.set(key, [...(aliases.get(key) ?? []), s.path]);
    if (!crawledByPath.has(key)) crawledByPath.set(key, { ...s, path: key });
  }
  const allPaths = [...new Set([...declaredByPath.keys(), ...crawledByPath.keys()])].sort();
  const names = assignPageNames(allPaths);

  const screens: Screen[] = [];
  const navTargets = new Map<string, string>();
  let unverifiedTotal = 0;
  for (const path of allPaths) {
    const decl = declaredByPath.get(path);
    const crawl = crawledByPath.get(path);
    const uses: ComponentUse[] = [];
    const taken = new Set<string>();
    let unverified = 0;

    if (crawl) {
      for (const t of crawl.tables ?? []) {
        if (!components.RecordTable) break;
        // A <table> with no header row is a layout table: the app is using it to place
        // things, not to list records. It has no rows to address and no key to address
        // them by, so it is not a collection.
        if (pickKeyColumn(t.columns ?? []) === null) continue;
        uses.push({
          component: 'RecordTable',
          as: uniqueProp(taken, collectionName(names.get(path), crawl)),
          heading: crawl.headings?.[0]?.text,
          columns: t.columns,
          keyColumn: pickKeyColumn(t.columns),
        } as ComponentUse);
      }
      const headingFor = headingResolver(crawl);
      const rowRegions = collectionRegionsOf(crawl);
      // Owned elsewhere, so not this screen's to name and not a gap in it either: a
      // control the shared region carries, and a row control the collection carries.
      const owned = (el: CrawlElement) => {
        const regionClass = regionClassOf.get(el.region);
        if (regionClass && sharedKeys.get(el.region)?.has(controlKey(el))) return true;
        if (collectionRegion && el.region === collectionRegion) return true;
        return rowRegions.has(el.region);
      };
      const mine = crawl.elements.filter(el => el.visible && el.unique && !owned(el));
      const candidates = mine.filter(el => fieldComponentFor(el) !== null);
      unverified += mine.length - candidates.length;
      const identities = addressableIdentities(candidates, headingFor);
      for (const el of candidates) {
        const id = identities.get(el);
        if (!id) { unverified++; continue; }
        const base = camel(id.label ?? id.field ?? '') || 'control';
        uses.push({ component: fieldComponentFor(el)!, as: uniqueProp(taken, base), ...id });
      }
      for (const region of new Set(crawl.elements.map(e => e.region))) {
        const cls = regionClassOf.get(region);
        if (cls) uses.unshift({ component: cls, as: uniqueProp(taken, camel(region)) });
      }
    }
    unverifiedTotal += unverified;

    // Actions: only transitions the crawl proved, and only through a control this screen
    // actually owns. A link the crawl saw but no component exposes is not an action —
    // it would generate a method with nothing behind it.
    const byLabel = new Map<string, string>();
    for (const u of uses) if (u.label) byLabel.set(u.label.trim(), u.as);
    const actions: { name: string; via: string; leadsTo: string }[] = [];
    if (crawl) {
      const seen = new Set<string>();
      for (const l of crawl.links ?? []) {
        const text = l.text.trim();
        const via = byLabel.get(text);
        if (!via) continue;
        // Exact path match. endsWith() would make "/#Account" match "/#Account/create".
        let linkPath: string;
        try { const u = new URL(l.resolved); linkPath = u.pathname.replace(/\/$/, '') + u.hash; }
        catch { continue; }
        if (!linkPath.startsWith('/')) linkPath = '/' + linkPath;
        const target = crawledByPath.has(linkPath) ? linkPath : undefined;
        if (!target || target === path || target === '/') continue;
        const name = 'goTo' + pascal(text);
        if (seen.has(name)) continue;
        seen.add(name);
        actions.push({ name, via, leadsTo: names.get(target)! });
        navTargets.set(text, names.get(target)!);
      }
    }

    screens.push({
      name: names.get(path)!,
      path,
      url: crawl?.url ?? new URL(path, dossier.baseUrl).toString(),
      title: crawl?.title ?? decl?.path ?? path,
      aliases: aliases.get(path) ?? [],
      identity: { urlPattern: path, heading: crawl?.headings?.[0]?.text ?? null },
      source: { component: decl?.component ?? null, route: decl?.path ?? null },
      // A recorded-only screen is in the crawl set so its controls compile, but no crawl
      // reached it and saying otherwise would let `stats.crawled` count a screen whose
      // locators nothing has proved unique.
      crawled: Boolean(crawl) && (crawl as any).recordedOnly !== true,
      uses,
      actions,
      unverified,
    });
  }

  // A shared region's transitions belong to the region, once, not to all 60 screens.
  for (const def of Object.values(components)) {
    if (def.kind !== 'region' || !def.controls) continue;
    const regionActions: { name: string; via: string; leadsTo: string }[] = [];
    for (const [prop] of Object.entries(def.controls)) {
      for (const [text, target] of navTargets) {
        if (camel(text) === prop) regionActions.push({ name: 'goTo' + pascal(text), via: prop, leadsTo: target });
      }
    }
    if (regionActions.length) (def as any).actions = regionActions;
  }

  // What the API is for, derived from its own shape: which resource each endpoint
  // addresses, what a call to it establishes, and what it cannot run without.
  const resources = deriveResources(api.endpoints ?? []);
  const taggedEndpoints = tagEndpoints(api.endpoints ?? [], resources);

  assertNoSelectors(screens);

  // `seenOn` is a count of screens, and only the region discovery could fill it in at the
  // point the component was built — a parameterised field class is created before any screen
  // has been mapped onto it. Counting here, from the mappings themselves, is the only place
  // the number is true for every kind of component at once.
  const screensPerComponent = new Map<string, Set<string>>();
  for (const s of screens) {
    for (const u of s.uses) {
      if (!screensPerComponent.has(u.component)) screensPerComponent.set(u.component, new Set());
      screensPerComponent.get(u.component)!.add(s.name);
    }
  }
  for (const [name, component] of Object.entries(components)) {
    component.seenOn = screensPerComponent.get(name)?.size ?? 0;
  }

  return {
    app: {
      name: dossier.name ?? dossier.app,
      baseUrl: dossier.baseUrl,
      repoPath: dossier.repoPath,
      repoCommit: dossier.repoCommit,
      stack: `${dossier.frontend?.framework ?? '?'} / ${dossier.backend?.framework ?? '?'}`,
      generatedAt: now,
    },
    components,
    screens,
    api: {
      resources,
      endpoints: taggedEndpoints,
      auth: api.auth
        ? {
            ...api.auth,
            uiLogin: profile.auth
              ? { loginUrl: profile.auth.loginUrl, steps: profile.auth.steps ?? [], readyWhen: profile.auth.readyWhen }
              : null,
            storageStatePath: profile.auth ? '.auth/user.json' : undefined,
          }
        : null,
    },
    stats: {
      // What the merge counted comes first, and the compiler's own counts follow. Both
      // are written in one place: `check-model.ts` reads `stats.recordings` to tell a
      // recording that has been ingested and compiled from one that was ingested and
      // left, and dropping these here would make every recording look like the latter.
      ...recordingStats,
      screens: screens.length,
      crawled: screens.filter(s => s.crawled).length,
      declaredOnly: screens.filter(s => !s.crawled).length,
      components: Object.keys(components).length,
      regions: Object.values(components).filter(c => c.kind === 'region').length,
      uses: screens.reduce((n, s) => n + s.uses.length, 0),
      actions: screens.reduce((n, s) => n + s.actions.length, 0),
      unverified: unverifiedTotal,
      endpoints: (api.endpoints ?? []).length,
      resources: Object.keys(resources).length,
      creatable: Object.values(resources).filter(r => r.ops.create).length,
      cleanable: Object.values(resources).filter(r => r.cleanup === 'delete').length,
    },
  };
}

/**
 * Fold the compiler's findings back into analysis.json.
 *
 * There is one artifact per app, and the compiled half belongs in it: a page object's
 * components sat in a second file while the controls they were built from sat in the
 * first, so answering "what can I address on this screen?" meant opening both and
 * joining them by path. The compiler is the last writer in the pipeline — it never
 * overwrites an observation, it adds what it derived to the entry that holds it.
 */
export function foldIntoAnalysis(model: AppModel): { write: number; total: number } {
  // The same merge the compile ran, over the file as it stands. Without it the recorded
  // controls take part in deriving components and are then dropped on the way back out —
  // `observed` below is what gets written, and it would be the pre-merge screens.
  // The merge is idempotent, which is what makes running it twice the simple answer.
  const analysis = mergeRecordings(readAnalysis());
  const observed = new Map(analysis.screens.map(s => [s.path, s]));
  // Both directions of the same fact: a recorded action names a path, an emitted one
  // names a class, and nothing else in the file translates between them.
  const byPath = new Map(model.screens.map(s => [s.path, s]));
  const known = new Set(model.screens.map(s => s.name));

  const screens = model.screens.map(page => {
    const seen = observed.get(page.path) ?? observed.get(page.aliases?.[0] ?? '');
    return {
      // observed
      path: page.path,
      url: page.url,
      title: page.title,
      headings: seen?.headings ?? [],
      tables: seen?.tables ?? [],
      hiddenControls: seen?.hiddenControls,
      controls: seen?.controls ?? [],
      links: seen?.links ?? [],
      recordedOnly: seen?.recordedOnly,
      // derived
      name: page.name,
      aliases: page.aliases,
      identity: page.identity,
      source: page.source,
      crawled: page.crawled,
      uses: page.uses as unknown as Record<string, unknown>[],
      // The compiler derives actions from transitions the crawl took. A recording proves
      // transitions a crawl never could — "clicking Apply lands you on the leave list" —
      // and rebuilding `actions` from the crawl alone would discard them every compile.
      // A recording names its destination by path, because when the merge ran no page
      // had a class name yet. `leadsTo` in a compiled action is a screen name, so
      // resolve it here — the one place both are in hand. An action whose destination is
      // not a known screen is dropped: it would point a reader at a screen that does not
      // exist.
      actions: [
        ...page.actions,
        ...(seen?.actions ?? [])
          .filter(a => a.provenBy === 'recording')
          .map(a => ({ ...a, leadsTo: byPath.get(a.leadsTo)?.name ?? a.leadsTo }))
          .filter(a => known.has(a.leadsTo))
          .filter(a => !page.actions.some(p => p.via === a.via && p.leadsTo === a.leadsTo)),
      ],
      unverified: page.unverified,
    };
  });

  const testability = scoreScreens(screens, analysis.testability?.recordings ?? []);

  writeSection('app', { ...analysis.app, ...model.app });
  // `model.api.auth` is the skill's auth block plus the UI login the profile declares
  // and the storage-state path the generator writes to — dropping it here leaves the
  // emitted project with no setup project and every spec starting logged out.
  writeSection('api', {
    ...analysis.api,
    auth: model.api.auth ?? analysis.api.auth,
    resources: model.api.resources,
  });
  writeSection('components', model.components);
  writeSection('screens', screens);
  writeSection('testability', testability);
  writeSection('stats', model.stats);
  return { write: testability.summary.write, total: testability.summary.total };
}

// `file://${process.argv[1]}` is not this module's URL on Windows: argv carries a
// drive-letter path with backslashes and import.meta.url is a percent-encoded file
// URL with forward slashes. The two never matched, so running this file directly did
// nothing at all and said so with exit code 0. pathToFileURL is the comparison that
// holds on every platform.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const model = compile(REPO_ROOT);
  const { write, total } = foldIntoAnalysis(model);
  console.log(`analysis.json  ${JSON.stringify(model.stats)}`);
  console.log(`               ${write}/${total} screens ready to write a test against`);
}
