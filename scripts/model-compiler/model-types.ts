// The contract between the analysis skills and the framework generator. Anything the
// generator needs to know lives here; anything it does not, does not reach it.

/** How a screen names one of its controls. English, never a selector. */
export interface Identity {
  /** The visible or accessible label: "Submit Request". */
  label?: string;
  /** The app's own field identifier, where the label is absent or translated. */
  field?: string;
  /** The heading a region sits under, used to disambiguate a repeated label. */
  within?: string;
  /** ARIA role, where two controls share a label but not a role. */
  role?: string;
  /**
   * How the crawl found `label`. `proximity` means the app renders it beside the
   * control without associating the two, so only the same DOM walk resolves it again.
   */
  via?: 'accessible' | 'proximity';
}

export type ComponentKind = 'region' | 'field' | 'collection';

export interface LocatorSpec {
  strategy: 'role' | 'label' | 'placeholder' | 'testId' | 'text' | 'css' | 'scoped';
  args: string[];
}

export interface ComponentDef {
  kind: ComponentKind;
  /** Region components only: the private root. The one place a selector may appear. */
  root?: LocatorSpec;
  /** Region components only: controls discovered on every instance of the region. */
  controls?: Record<string, LocatorSpec>;
  /** Field components: the selector shape used when an identity gives `field`. */
  /** Collection components: the app's table shape. */
  table?: {
    row: string;
    cell: string;
    headerCell?: string;
    rowKeyAttribute?: string;
  };
  /** How many screens this component was observed on. 1 means screen-local. */
  seenOn: number;
  description: string;
}

export interface ComponentUse extends Identity {
  component: string;
  /** The property name a page object for this screen would carry. */
  as: string;
  /** Collections only: the columns observed, and the one that identifies a row. */
  columns?: string[];
  keyColumn?: string | null;
}

export interface ScreenAction {
  name: string;
  via: string;
  leadsTo: string;
}

export interface Screen {
  name: string;
  path: string;
  url: string;
  title: string;
  aliases: string[];
  identity: { urlPattern: string; heading: string | null };
  source: { component: string | null; route: string | null };
  crawled: boolean;
  uses: ComponentUse[];
  actions: ScreenAction[];
  /** Elements the crawl saw but could not name semantically. Never silently dropped. */
  unverified: number;
  /**
   * The compiler's answer to "is there enough here to address what a test would touch?"
   * Whoever writes a test against this screen deserves to know what it was built from.
   */
  testability?: {
    confidence: number;
    addressable: number;
    unaddressable: number;
    hasTable: boolean;
    crawled: boolean;
    recorded: boolean;
    missing: string[];
  };
}

export interface ApiAuth {
  kind: string;
  loginEndpoint?: unknown;
  storageStatePath?: string;
  [k: string]: unknown;
}

export interface AppModel {
  app: {
    name: string;
    baseUrl: string;
    repoPath: string;
    repoCommit: string;
    stack: string;
    generatedAt: string;
  };
  components: Record<string, ComponentDef>;
  screens: Screen[];
  api: { resources: Record<string, unknown>; endpoints: unknown[]; auth: ApiAuth | null };
  stats: Record<string, number>;
}
