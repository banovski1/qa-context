/**
 * `analysis.json` — everything the four skills learn about one
 * application, in one file.
 *
 * There were eleven files and five reports here, and reviewing a change meant reading
 * a diff spread across all of them. One file with one section per skill is reviewable
 * by eye and loadable in one read by an agent, which is the same property from two
 * directions.
 *
 * Each skill owns exactly one top-level section and never writes another's. Nothing
 * merges sections implicitly: `write-section.ts` replaces one key and leaves the rest
 * byte-identical, so a re-run of one skill produces a diff scoped to its own work.
 */

export interface AnalysisApp {
  name: string;
  baseUrl: string;
  repoPath: string;
  repoCommit: string | null;
  generatedAt: string;
}

/** app-dossier: what the source declares about itself. */
export interface AnalysisSource {
  stack: { frontend?: Record<string, unknown>; backend?: Record<string, unknown> };
  /** Every route the app declares, whether or not a crawl ever reached it. */
  routes: { path: string; name?: string; component?: string; source?: string }[];
  /** Domain objects the app persists — what a precondition creates. */
  entities: { name: string; fields?: string[]; source?: string }[];
  /** Test tooling already in the repo, so the generator does not duplicate it. */
  existingTests: { framework: string; path: string; count?: number }[];
  /** Where the app documents itself: AGENTS.md, CI, a spec-generating command. */
  docs: Record<string, unknown>;
  dependencies: Record<string, unknown>;
  notes?: string[];
}

/** app-components: how the app is built, and how a label reaches an input. */
export interface AnalysisConventions {
  regions: { name: string; selector: string; [k: string]: unknown }[];
  labelAssociation: Record<string, unknown>;
  designSystem?: Record<string, unknown>;
  notes?: string[];
}

/** app-api: the endpoints, and the login that has been proved to work. */
export interface AnalysisApi {
  apiPrefix: string | null;
  tiers: Record<string, number>;
  spec: Record<string, unknown>;
  auth: Record<string, unknown> | null;
  /** Written only by scripts/api-auth/verify-auth.ts. Absent means unproven. */
  authVerification?: Record<string, unknown>;
  endpoints: Record<string, unknown>[];
  /**
   * Derived by the compiler, not by the skill: one entry per resource the endpoints
   * describe, with the operations that create, read and delete it, the resources it
   * depends on, and whether it can stand up a precondition at all.
   */
  resources?: Record<string, unknown>;
  notes?: string[];
}

/**
 * One control the crawl saw, distilled.
 *
 * The raw crawl carried a ranked candidate ladder and a bounding box for every element
 * on every screen — 15 MB for one app, none of it readable and most of it consumed by
 * one function. What survives is what a decision downstream depends on: how to name the
 * control, whether the name resolves to one element, and where the name came from.
 */
export interface AnalysisControl {
  role: string | null;
  name: string;
  /** `proximity` means the app renders the label but never associated it. */
  nameSource: 'accessible' | 'proximity' | null;
  label: string | null;
  placeholder: string | null;
  field: string | null;
  region: string;
  visible: boolean;
  disabled: boolean;
  href: string | null;
  /** How many elements the control's *semantic* handle matches. >1 is not addressable. */
  matches: number;
  /** Vertical position, the only evidence of which heading a control sits under. */
  y: number;
  /**
   * Where the control came from. Absent means the crawl, which is the default and the
   * only source that proves `matches`. A recorded control is real but unproven: a human
   * addressed it once, which says nothing about whether a second element carries the
   * same handle.
   */
  source?: 'crawl' | 'recording';
}

/**
 * One screen, and everything known about it.
 *
 * The crawl writes the observation — what is on the page. The compiler writes the
 * derived half — the page object's name, the components mapped onto it, the transitions
 * it proved, and how confidently a test can be written against it. Both live in the same
 * entry because splitting them meant looking one screen up in two places.
 */
export interface AnalysisScreen {
  // --- observed, by app-explorer ---
  path: string;
  url: string;
  title: string;
  headings: { level: number; text: string; y: number }[];
  tables: { columns: string[]; rowCount: number }[];
  /** Counted, not listed: nothing downstream addresses a control the user cannot see. */
  hiddenControls?: number;
  controls: AnalysisControl[];
  links: { href: string; resolved: string; text: string }[];

  // --- derived, by compile-model.ts ---
  /** The screen's page-object class name, e.g. `ApplyLeavePage`. */
  name?: string;
  /** Crawled URLs that fold onto this screen's declared parameterised route. */
  aliases?: string[];
  /** The anchored URL pattern a test asserts the screen by, and the heading it showed. */
  identity?: { urlPattern: string; heading: string | null };
  source?: { component: string | null; route: string | null };
  /** false: the route is declared and no crawl ever reached it. */
  crawled?: boolean;
  /**
   * The crawl never reached this route; a human walked it with the recorder.
   *
   * Distinct from `crawled: false` alone, which is the compiler's marker for a declared
   * route behind which nothing is known. Here the controls are real observations — they
   * are simply unproven, so the screen must not be mistaken for a crawled one.
   */
  recordedOnly?: boolean;
  /** Components mapped onto this screen. English only — never a selector. */
  uses?: Record<string, unknown>[];
  /** Transitions the crawl proved, through a control this screen owns. */
  actions?: { name: string; via: string; leadsTo: string; provenBy?: 'crawl' | 'recording' }[];
  /** Controls the crawl saw and could not name. Never silently dropped. */
  unverified?: number;
  testability?: ScreenTestability;
}

export interface ScreenTestability {
  confidence: number;
  addressable: number;
  unaddressable: number;
  hasTable: boolean;
  crawled: boolean;
  recorded: boolean;
  missing: string[];
}

/**
 * How much of a screen is known well enough to write a test against it without
 * asking a human to record the flow first.
 */
export interface AnalysisTestability {
  /** The roll-up. Per-screen detail lives on the screen itself. */
  summary: { write: number; recordFirst: number; unknown: number; total: number };
  /** Flows a human recorded with the app-recorder skill, by name. */
  recordings: { flow: string; path: string; recordedAt: string; screens: string[] }[];
}

/**
 * The menu map: where everything is, walked through the app's own navigation.
 *
 * Written by `map.mjs`, which navigates the application's own menus rather than
 * following `<a href>` — most business software does not link its screens. It is the
 * coarse layer: every module, every menu entry, and per screen its heading, buttons,
 * fields with types, and tables with columns.
 */
export interface AnalysisMap {
  modules: {
    name: string;
    url?: string;
    screens: {
      name: string; url?: string; heading?: string;
      buttons?: string[]; fields?: string[];
      tables?: { kind: string; columns: string[]; rows: number }[];
      valueList?: { sample: string[]; total: number };
    }[];
    skipped?: string;
  }[];
  budget?: Record<string, unknown>;
}

/**
 * One flow a human recorded, and everything it proved.
 *
 * This is evidence, not conclusion: the raw locator the recorder emitted, the route it
 * ran against, and the request it provoked, exactly as observed. `merge-recordings.ts`
 * turns it into screens, controls and endpoints; nothing else reads it.
 *
 * It is deliberately separate from `testability.recordings`, which is a list of flow
 * names for the scorer and holds no evidence at all. One says *that* a flow was
 * recorded; this says *what the recording saw*.
 */
export interface AnalysisRecording {
  flow: string;
  recordedAt: string;
  /** The committed human-readable record the evidence was read from. */
  file: string;
  steps: RecordedStep[];
  routes: { path: string; url: string; headings: string[] }[];
  requests: RecordedRequest[];
}

export interface RecordedStep {
  action: 'goto' | 'click' | 'fill' | 'select' | 'check' | 'uncheck' | 'press' | 'other';
  /** The locator as the recorder emitted it. Evidence — never emitted into a page object. */
  rawLocator: string | null;
  /** From locator-rung.ts. 1-6 stable, 7-8 not. */
  rung: number;
  /** Redacted: a recording is not a place to keep a password. */
  value: string | null;
  /** The screen this step ran against, from the most recent navigation. */
  screenPath: string | null;
  /** The `screens[].controls` name this step resolves to, or null if nothing matched. */
  resolvedControl: string | null;
}

/**
 * One request the flow provoked.
 *
 * Shapes, not values: a precondition needs to know an endpoint takes a `name` and a
 * `jobTitleId`, and knowing the particular name this human typed helps nobody and
 * commits their data to the repo.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  status: number;
  kind: 'xhr' | 'fetch' | 'document';
  requestShape: string[] | null;
  responseShape: string[] | null;
}

export interface Analysis {
  app: AnalysisApp;
  source: AnalysisSource;
  conventions: AnalysisConventions;
  api: AnalysisApi;
  map: AnalysisMap;
  /** The locator layer. The only place in this file a selector may appear. */
  components: Record<string, unknown>;
  screens: AnalysisScreen[];
  testability: AnalysisTestability;
  /** What a human recorded, as evidence. Empty means the recorder has not run. */
  recordings: AnalysisRecording[];
  stats: Record<string, number>;
}

export const SECTIONS = ['app', 'source', 'conventions', 'api', 'map', 'components', 'screens', 'testability', 'recordings', 'stats'] as const;
export type Section = typeof SECTIONS[number];

/**
 * Which skill owns which section. A skill writing another's section is a bug.
 *
 * `screens` is the one section with two writers, and the order matters: the explorer
 * writes what it observed, then the compiler adds what it derived to the same entries.
 * A crawl re-run without a recompile therefore leaves the derived half stale, which is
 * exactly what check-model.ts reports.
 */
export const SECTION_OWNER: Record<Section, string> = {
  app: 'app-dossier',
  source: 'app-dossier',
  conventions: 'app-components',
  api: 'app-api',
  map: 'app-explorer (map.mjs)',
  components: 'compile-model.ts',
  screens: 'app-explorer (explore.mjs), enriched by compile-model.ts',
  testability: 'compile-model.ts',
  recordings: 'app-recorder (ingest-recording.ts)',
  stats: 'compile-model.ts',
};
