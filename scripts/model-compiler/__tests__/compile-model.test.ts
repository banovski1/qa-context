import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile, assertNoSelectors, pickKeyColumn, assignPageNames, pathIdentity } from '../compile-model.ts';
import { scoreScreens } from '../../analysis/testability.ts';

test('a page is identified by its full parameterless path', () => {
  assert.equal(pathIdentity('/pim/employee/{id}/edit'), 'pim/employee/edit');
  assert.equal(pathIdentity('/#Contact/view/:id'), '#Contact/view');
});

test('names extend toward the root only while two pages collide', () => {
  const n = assignPageNames(['/kye/assignments', '/kytp/assignments', '/contacts']);
  assert.equal(n.get('/contacts'), 'ContactsPage');
  assert.equal(n.get('/kye/assignments'), 'KyeAssignmentsPage');
  assert.equal(n.get('/kytp/assignments'), 'KytpAssignmentsPage');
});

test('names do not depend on read order', () => {
  const a = assignPageNames(['/kye/assignments', '/kytp/assignments']);
  const b = assignPageNames(['/kytp/assignments', '/kye/assignments']);
  assert.deepEqual([...a].sort(), [...b].sort());
});

test('the key column skips the select-all checkbox column', () => {
  assert.equal(pickKeyColumn(['Select All Results', 'Name', 'Email']), 'Name');
  assert.equal(pickKeyColumn([]), null);
});

test('a screen carrying a selector is a compile error, not a warning', () => {
  const screen: any = { name: 'X', uses: [{ component: 'Button', as: 'b', label: '.oxd-button' }] };
  assert.throws(() => assertNoSelectors([screen]), /looks like a selector/);
});

test('a label containing a dot or a bracket is not mistaken for a selector', () => {
  const ok: any = { name: 'X', uses: [
    { component: 'Button', as: 'a', label: 'Send draft to A.Beike' },
    { component: 'Button', as: 'b', label: 'Delete [archived]' },
  ] };
  assert.doesNotThrow(() => assertNoSelectors([ok]));
});

test('a label carrying markup is not mistaken for a selector', () => {
  // An application that renders labels through innerHTML puts tags in them, and the
  // closing angle bracket of one reads as a child combinator.
  const ok: any = { name: 'X', uses: [
    { component: 'TextField', as: 'a', label: 'Search, <strong>without</strong> multiselect' },
    { component: 'Button', as: 'b', label: 'Delete <em>everything</em>' },
  ] };
  assert.doesNotThrow(() => assertNoSelectors([ok]));
});

test('stripping markup does not let a real selector through', () => {
  const bad: any = { name: 'X', uses: [{ component: 'Button', as: 'b', label: 'div > .primary' }] };
  assert.throws(() => assertNoSelectors([bad]), /looks like a selector/);
});

// A miniature app, so the joining rules are tested on data small enough to read.
// One file, the shape a skill writes: `matches` is how many elements the control's
// semantic handle addresses, and 1 is the only value that makes it usable.
function control(over: Record<string, unknown>) {
  return {
    role: null, name: '', nameSource: null, label: null, placeholder: null, field: null,
    region: 'body', visible: true, disabled: false, href: null, matches: 1, y: 0, ...over,
  };
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-'));
  const nav = ['Contacts', 'Reports', 'Settings'].map(t =>
    control({ role: 'link', name: t, nameSource: 'accessible', region: 'navigation', href: '#' }));
  const screen = (path: string, title: string, extra: any[] = [], tables: any[] = []) => ({
    path, url: 'https://demo.test' + path, title,
    headings: [{ level: 1, text: title, y: 0 }], tables,
    controls: [...nav, ...extra],
    links: [{ href: '/contacts/add', resolved: 'https://demo.test/contacts/add', text: 'Add Contact' }],
  });
  const addLink = control({ role: 'link', name: 'Add Contact', nameSource: 'accessible', href: '/contacts/add' });
  const rowCheckbox = control({ role: 'checkbox', name: '', region: 'table', matches: -1 });
  const firstName = control({ role: 'textbox', name: 'First Name', nameSource: 'accessible' });

  writeFileSync(join(dir, 'analysis.json'), JSON.stringify({
    app: { name: 'demo', baseUrl: 'https://demo.test/', repoPath: '/r', repoCommit: 'abc', generatedAt: '' },
    source: {
      stack: { frontend: { framework: 'vue' }, backend: { framework: 'symfony' } },
      routes: [{ path: '/contacts' }, { path: '/contacts/add' }, { path: '/reports' }],
      entities: [], existingTests: [], docs: {}, dependencies: {},
    },
    conventions: {
      regions: [
        { name: 'NavigationBar', selector: '#nav' },
        { name: 'RecordTable', selector: '.tbl', row: 'tr', cell: 'td', rowKey: 'data-id' },
      ],
      labelAssociation: { preferredTemplate: '[data-name="{fieldName}"]' },
    },
    api: { apiPrefix: null, tiers: {}, spec: {}, auth: { kind: 'token' }, endpoints: [] },
    screens: [
      screen('/contacts', 'Contacts', [addLink, rowCheckbox],
        [{ columns: ['Select All Results', 'Name', 'Email'], rowCount: 3 }]),
      screen('/contacts/add', 'Add Contact', [firstName]),
    ],
    testability: { screens: {}, recordings: [] },
  }, null, 2));
  return dir;
}

/** Add a screen to a fixture that already exists. */
function addScreen(dir: string, screen: Record<string, unknown>): string {
  const analysis = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));
  analysis.screens.push(screen);
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  return dir;
}

/** Two controls a screen names identically, and one named only by a rendered label. */
function ambiguous(): string {
  const dir = fixture();
  const twin = (y: number) => control({
    role: 'textbox', name: 'Type for hints...', nameSource: 'accessible',
    placeholder: 'Type for hints...', region: 'form', y, matches: 2,
  });
  const nearLabelled = control({
    role: 'combobox', name: 'Sub Unit', nameSource: 'proximity', region: 'form', y: 300,
  });
  return addScreen(dir, {
    path: '/reports', url: 'https://demo.test/reports', title: 'Reports',
    headings: [{ level: 1, text: 'Reports', y: 0 }], tables: [],
    controls: [twin(100), twin(200), nearLabelled], links: [],
  });
}

test('a handle that addresses two elements is emitted for neither', () => {
  const reports = compile(ambiguous(), 'T').screens.find(s => s.path === '/reports')!;
  assert.equal(reports.uses.filter(u => u.label === 'Type for hints...').length, 0);
  assert.ok(reports.unverified >= 2, 'both twins are reported as unverified, not dropped silently');
});

test('a heading that separates two same-named controls is used to scope them', () => {
  const dir = addScreen(fixture(), {
    path: '/reports', url: 'https://demo.test/reports', title: 'Reports',
    headings: [{ level: 2, text: 'Billing', y: 50 }, { level: 2, text: 'Shipping', y: 250 }],
    tables: [],
    controls: [
      control({ role: 'textbox', name: 'Name', nameSource: 'accessible', region: 'form', y: 100, matches: 2 }),
      control({ role: 'textbox', name: 'Name', nameSource: 'accessible', region: 'form', y: 300, matches: 2 }),
    ],
    links: [],
  });
  const reports = compile(dir, 'T').screens.find(s => s.path === '/reports')!;
  assert.deepEqual(reports.uses.filter(u => u.label === 'Name').map(u => u.within).sort(), ['Billing', 'Shipping']);
});

test('a proximity label is marked so the runtime repeats the same walk', () => {
  const subUnit = compile(ambiguous(), 'T').screens
    .find(s => s.path === '/reports')!.uses.find(u => u.label === 'Sub Unit')!;
  assert.equal(subUnit.via, 'proximity');
  assert.equal(subUnit.component, 'Select');
});

test('an accessible label carries no via, so the runtime asks the accessibility tree', () => {
  const add = compile(fixture(), 'T').screens.find(s => s.path === '/contacts/add')!;
  assert.equal(add.uses.find(u => u.label === 'First Name')!.via, undefined);
});

test('a collection is named after the heading above it, never the document title', () => {
  const contacts = compile(fixture(), 'T').screens.find(s => s.path === '/contacts')!;
  assert.equal(contacts.uses.find(u => u.component === 'RecordTable')!.as, 'contacts');
});

test('the navigation recurs on both screens, so it becomes one component', () => {
  const m = compile(fixture(), 'T');
  const nav = m.components.NavigationBar;
  assert.equal(nav.kind, 'region');
  assert.equal(nav.seenOn, 2);
  assert.deepEqual(Object.keys(nav.controls!).sort(), ['contacts', 'reports', 'settings']);
  assert.deepEqual(nav.root, { strategy: 'css', args: ['#nav'] });
});

test('a screen references the navigation without repeating its controls', () => {
  const m = compile(fixture(), 'T');
  const contacts = m.screens.find(s => s.path === '/contacts')!;
  assert.ok(contacts.uses.some(u => u.component === 'NavigationBar'));
  assert.ok(!contacts.uses.some(u => u.label === 'Reports'));
});

test('no screen carries a locator anywhere in its uses', () => {
  const m = compile(fixture(), 'T');
  for (const s of m.screens) for (const u of s.uses) assert.ok(!('root' in u) && !('strategy' in u));
});

test('a table becomes a key-addressed collection', () => {
  const m = compile(fixture(), 'T');
  const table = m.screens.find(s => s.path === '/contacts')!.uses.find(u => u.component === 'RecordTable')!;
  assert.equal(table.keyColumn, 'Name');
  assert.equal(m.components.RecordTable.table!.rowKeyAttribute, 'data-id');
});

test('a row checkbox is the collection’s business, not an unverified page control', () => {
  const m = compile(fixture(), 'T');
  assert.equal(m.screens.find(s => s.path === '/contacts')!.unverified, 0);
});

test('an action is emitted only where the crawl proved the transition', () => {
  const m = compile(fixture(), 'T');
  const contacts = m.screens.find(s => s.path === '/contacts')!;
  assert.deepEqual(contacts.actions, [{ name: 'goToAddContact', via: 'addContact', leadsTo: 'AddPage' }]);
  assert.deepEqual(m.screens.find(s => s.path === '/contacts/add')!.actions, []);
});

test('a declared route the crawl never reached is still a page, flagged', () => {
  const m = compile(fixture(), 'T');
  const reports = m.screens.find(s => s.path === '/reports')!;
  assert.equal(reports.crawled, false);
  assert.equal(reports.uses.length, 0);
  assert.equal(reports.url, 'https://demo.test/reports');
});

test('compiling twice gives byte-identical output', () => {
  const dir = fixture();
  assert.equal(JSON.stringify(compile(dir, 'T')), JSON.stringify(compile(dir, 'T')));
});

test('a layout table with no header row is not a collection', () => {
  const dir = fixture();
  const analysis = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));
  analysis.screens.find((s: any) => s.path === '/contacts').tables.push({ columns: [], rowCount: 2 });
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(analysis));
  const m = compile(dir, 'T');
  assert.equal(m.screens.find(s => s.path === '/contacts')!.uses.filter(u => u.component === 'RecordTable').length, 1);
});

test('a route made only of parameters is still named', () => {
  const n = assignPageNames(['/{user}/{type}', '/{user}']);
  assert.equal(n.get('/{user}'), 'UserPage');
  assert.equal(n.get('/{user}/{type}'), 'TypePage');
});

test('a crawled record URL folds onto its declared parameterised route', () => {
  const dir = fixture();
  const analysis = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));
  analysis.source.routes = [{ path: '/contacts' }, { path: '/contacts/add' }, { path: '/contacts/{id}' }];
  const contacts = analysis.screens.find((s: any) => s.path === '/contacts');
  analysis.screens.push({ ...contacts, path: '/contacts/42', title: 'Ada' });
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(analysis));
  const m = compile(dir, 'T');
  const detail = m.screens.find(s => s.path === '/contacts/{id}')!;
  assert.equal(detail.crawled, true);
  assert.deepEqual(detail.aliases, ['/contacts/42']);
  assert.ok(!m.screens.some(s => s.path === '/contacts/42'));
});

test('an app served below a path joins its declared routes to what the crawl saw', () => {
  // OrangeHRM: the source declares /pim/viewEmployeeList, the browser is at
  // /web/index.php/pim/viewEmployeeList, and goto() resolves a leading slash on the origin.
  const dir = fixture();
  const analysis = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));
  analysis.app.baseUrl = 'https://demo.test/web/index.php/';
  for (const s of analysis.screens) s.path = '/web/index.php' + s.path;
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(analysis));
  const m = compile(dir, 'T');
  const contacts = m.screens.find(s => s.path === '/web/index.php/contacts')!;
  assert.equal(contacts.crawled, true);
  assert.equal(contacts.name, 'ContactsPage');
  assert.ok(!m.screens.some(s => s.path === '/contacts'));
  assert.equal(m.screens.find(s => s.path === '/web/index.php/reports')!.url, 'https://demo.test/web/index.php/reports');
});

test('compiling twice over its own output changes nothing', () => {
  // The compiler writes back into the section it reads, so a declared-but-unreached
  // screen it added last run must not be counted as something a crawl found this one.
  const dir = fixture();
  const first = compile(dir, 'T');
  const analysis = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));
  const observed = new Map(analysis.screens.map((s: any) => [s.path, s]));
  analysis.screens = first.screens.map((page: any) => ({
    ...(observed.get(page.path) ?? { headings: [], tables: [], controls: [], links: [] }),
    path: page.path, url: page.url, title: page.title,
    name: page.name, crawled: page.crawled, uses: page.uses, actions: page.actions,
  }));
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));

  const second = compile(dir, 'T');
  assert.equal(second.stats.crawled, first.stats.crawled);
  assert.equal(second.stats.declaredOnly, first.stats.declaredOnly);
  assert.equal(second.stats.uses, first.stats.uses);
});

test('a declared screen the crawl never reached scores zero, whatever its controls say', () => {
  const screens: any[] = [
    { path: '/a', headings: [], tables: [], controls: [{ name: 'X', matches: 1 }], links: [] },
    { path: '/b', crawled: false, headings: [], tables: [], controls: [], links: [] },
  ];
  const summary = scoreScreens(screens, []);
  assert.equal(screens[0].testability.confidence > 0, true);
  assert.equal(screens[1].testability.confidence, 0);
  assert.equal(screens[1].testability.crawled, false);
  assert.equal(summary.summary.total, 2);
});

test('every component reports the number of screens that actually map onto it', () => {
  // A parameterised field class is built before any screen has been mapped onto it, so
  // the count it is born with is zero. Reporting that zero is worse than reporting
  // nothing: it says a class nothing uses and a class every screen uses are the same.
  const model = compile(fixture(), 'T');
  const expected = new Map<string, Set<string>>();
  for (const s of model.screens) {
    for (const u of s.uses) {
      if (!expected.has(u.component)) expected.set(u.component, new Set());
      expected.get(u.component)!.add(s.name);
    }
  }
  for (const [name, component] of Object.entries(model.components)) {
    assert.equal(component.seenOn, expected.get(name)?.size ?? 0, `${name}.seenOn`);
  }
  assert.ok([...expected.keys()].length > 0, 'the fixture maps at least one component');
});

test('no component carries the app-wide field template', () => {
  // How a label reaches an input is one fact and lives in `conventions`; a copy on each
  // component is a second place to keep honest, and was wrong on every component that
  // addresses its control by visible text rather than by a label beside an input.
  const model = compile(fixture(), 'T');
  for (const [name, component] of Object.entries(model.components)) {
    assert.ok(!('fieldTemplate' in component), `${name} carries a fieldTemplate`);
  }
});

test('a label read off markup is flattened to the name the browser computes', () => {
  // The accessible name collapses runs of whitespace, so a label carrying the newlines
  // and tabs of the markup it came from would resolve to nothing at run time — and, in
  // a single-quoted TypeScript literal, would not even parse.
  const dir = addScreen(fixture(), {
    path: '/uploads', url: 'https://demo.test/uploads', title: 'Uploads',
    headings: [{ level: 1, text: 'Uploads', y: 0 }], tables: [],
    controls: [control({
      role: 'button',
      name: '<div>Max. no. of files: 5</div>\n\t\t\t<div>max. size: 50MB</div>',
      nameSource: 'accessible',
    })],
    links: [],
  });
  const uploads = compile(dir, 'T').screens.find(s => s.path === '/uploads')!;
  const use = uploads.uses.find(u => (u.label ?? '').startsWith('<div>Max.'))!;
  assert.ok(use, 'the control is still addressable');
  assert.equal(use.label, '<div>Max. no. of files: 5</div> <div>max. size: 50MB</div>');
  assert.ok(!/[\n\t]/.test(use.label!), 'no raw newline or tab survives into an identity');
});
