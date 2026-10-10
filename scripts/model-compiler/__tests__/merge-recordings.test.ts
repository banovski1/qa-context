import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecordings } from '../merge-recordings.ts';
import type { Analysis, AnalysisRecording, AnalysisControl } from '../../analysis/analysis-types.ts';

const control = (over: Partial<AnalysisControl>): AnalysisControl => ({
  role: 'textbox', name: 'City', nameSource: 'accessible', label: 'City',
  placeholder: null, field: 'city', region: 'main', visible: true, disabled: false,
  href: null, matches: 1, y: 100, ...over,
});

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  app: { name: 'x', baseUrl: 'https://app.test/', repoPath: '', repoCommit: null, generatedAt: '' },
  source: { stack: {}, routes: [], entities: [], existingTests: [], docs: {}, dependencies: {} },
  conventions: { regions: [], labelAssociation: {} },
  api: { apiPrefix: null, tiers: {}, spec: {}, auth: null, endpoints: [] },
  map: { modules: [] },
  components: {},
  screens: [],
  testability: { summary: { write: 0, recordFirst: 0, unknown: 0, total: 0 }, recordings: [] },
  recordings: [],
  stats: {},
  ...over,
});

const recording = (over: Partial<AnalysisRecording> = {}): AnalysisRecording => ({
  flow: 'apply-leave',
  recordedAt: '2026-09-13T10:00:00.000Z',
  file: 'recordings/apply-leave-20260913-100000.md',
  steps: [],
  routes: [],
  requests: [],
  ...over,
});

test('a recorded route the crawl never reached becomes a screen, marked as such', () => {
  const a = analysis();
  a.recordings = [recording({
    routes: [{ path: '/leave/applyLeave', url: 'https://app.test/leave/applyLeave', headings: ['Apply Leave'] }],
    steps: [{
      action: 'fill', rawLocator: "getByLabel('From Date')", rung: 3,
      value: '2026-01-01', screenPath: '/leave/applyLeave', resolvedControl: null,
    }],
  })];

  const merged = mergeRecordings(a);
  const screen = merged.screens.find(s => s.path === '/leave/applyLeave');

  assert.ok(screen, 'the recorded route should have produced a screen');
  // `crawled: false` keeps a recompile from counting it as something the crawl found.
  assert.equal(screen!.crawled, false);
  assert.equal(screen!.recordedOnly, true);
  assert.deepEqual(screen!.headings.map(h => h.text), ['Apply Leave']);
  assert.equal(screen!.controls.length, 1);
  assert.equal(screen!.controls[0].name, 'From Date');
  assert.equal(screen!.controls[0].source, 'recording');
});

test('a crawl-proven control is never overwritten by a recorded one', () => {
  const crawled = control({ name: 'City', matches: 1, y: 42 });
  const a = analysis({
    screens: [{
      path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', title: 'Add',
      headings: [], tables: [], controls: [crawled], links: [],
    }],
  });
  a.recordings = [recording({
    routes: [{ path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', headings: [] }],
    steps: [{
      // The same control, recorded through a locator that proves nothing about uniqueness.
      action: 'fill', rawLocator: "getByLabel('City')", rung: 3,
      value: 'Sofia', screenPath: '/pim/addEmployee', resolvedControl: null,
    }],
  })];

  const merged = mergeRecordings(a);
  const screen = merged.screens.find(s => s.path === '/pim/addEmployee')!;

  assert.equal(screen.controls.length, 1, 'the recorded control must not be appended beside the crawled one');
  assert.deepEqual(screen.controls[0], crawled, 'the crawl-proven control is untouched, byte for byte');
  assert.equal(merged.stats.recordingConflicts, 1, 'the conflict is counted, not applied');
});

test('a control the crawl never saw is appended, and marked unproven', () => {
  const a = analysis({
    screens: [{
      path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', title: 'Add',
      headings: [], tables: [], controls: [control({ name: 'City' })], links: [],
    }],
  });
  a.recordings = [recording({
    routes: [{ path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', headings: [] }],
    steps: [{
      action: 'click', rawLocator: "getByRole('button', { name: 'Save' })", rung: 2,
      value: null, screenPath: '/pim/addEmployee', resolvedControl: null,
    }],
  })];

  const merged = mergeRecordings(a);
  const screen = merged.screens.find(s => s.path === '/pim/addEmployee')!;
  const saved = screen.controls.find(c => c.name === 'Save')!;

  assert.ok(saved, 'the recorded control should have been appended');
  assert.equal(saved.source, 'recording');
  assert.equal(saved.role, 'button');
  // A recording cannot prove uniqueness, but a step that ran is a step that resolved.
  assert.equal(saved.matches, 1);
});

test('an unstable recorded locator contributes no control', () => {
  const a = analysis({
    screens: [{
      path: '/admin/users', url: 'https://app.test/admin/users', title: 'Users',
      headings: [], tables: [], controls: [], links: [],
    }],
  });
  a.recordings = [recording({
    routes: [{ path: '/admin/users', url: 'https://app.test/admin/users', headings: [] }],
    steps: [{
      action: 'click', rawLocator: ".oxd-table tr:nth-child(3) button", rung: 8,
      value: null, screenPath: '/admin/users', resolvedControl: null,
    }],
  })];

  const merged = mergeRecordings(a);
  const screen = merged.screens.find(s => s.path === '/admin/users')!;

  assert.equal(screen.controls.length, 0, 'a locator that names a position names no control');
  assert.equal(merged.stats.recordingUnresolved, 1);
});

test('a navigation the crawl never proved becomes an action, marked recording-proven', () => {
  const a = analysis({
    screens: [
      { path: '/pim/viewEmployeeList', url: 'https://app.test/pim/viewEmployeeList', title: 'List',
        headings: [], tables: [], controls: [], links: [], actions: [] },
      { path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', title: 'Add',
        headings: [], tables: [], controls: [], links: [] },
    ],
  });
  a.recordings = [recording({
    routes: [
      { path: '/pim/viewEmployeeList', url: 'https://app.test/pim/viewEmployeeList', headings: [] },
      { path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', headings: [] },
    ],
    steps: [
      { action: 'goto', rawLocator: null, rung: 1, value: 'https://app.test/pim/viewEmployeeList',
        screenPath: '/pim/viewEmployeeList', resolvedControl: null },
      { action: 'click', rawLocator: "getByRole('button', { name: 'Add' })", rung: 2,
        value: null, screenPath: '/pim/viewEmployeeList', resolvedControl: null },
      { action: 'goto', rawLocator: null, rung: 1, value: 'https://app.test/pim/addEmployee',
        screenPath: '/pim/addEmployee', resolvedControl: null },
    ],
  })];

  const merged = mergeRecordings(a);
  const list = merged.screens.find(s => s.path === '/pim/viewEmployeeList')!;

  // `via` is the property the page object will carry, because a test calls
  // `await this.<via>.click()` — a label with a space in it is not a property name.
  // `leadsTo` is still a path here; the compiler resolves it to a class name later, when
  // page names exist.
  assert.deepEqual(list.actions, [
    { name: 'goToAdd', via: 'add', leadsTo: '/pim/addEmployee', provenBy: 'recording' },
  ]);
});

test('recording-derived facts are rebuilt, never accumulated', () => {
  // The failure this pins: a merge that added to what was already in the file left every
  // earlier answer behind. A re-recorded flow kept contributing controls it no longer
  // had, and a fix to how an action is named left the old name in place for ever.
  const a = analysis({
    screens: [{
      path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', title: 'Add',
      headings: [], tables: [], controls: [control({ name: 'Gone', source: 'recording' })],
      links: [], crawled: false, recordedOnly: true,
      actions: [{ name: 'stale', via: 'Stale', leadsTo: 'GonePage', provenBy: 'recording' }],
    }],
  });
  a.recordings = [recording({
    routes: [{ path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', headings: [] }],
    steps: [{ action: 'click', rawLocator: "getByRole('button', { name: 'Save' })", rung: 2,
      value: null, screenPath: '/pim/addEmployee', resolvedControl: null }],
  })];

  const screen = mergeRecordings(a).screens[0];
  assert.deepEqual(screen.controls.map(c => c.name), ['Save'], 'the superseded control is gone');
  assert.deepEqual(screen.actions, [], 'the superseded action is gone');
});

test('a recorded endpoint reaches the api section', () => {
  const a = analysis();
  a.recordings = [recording({
    requests: [
      { method: 'POST', path: '/api/v2/pim/employees', status: 200, kind: 'xhr',
        requestShape: ['firstName', 'lastName'], responseShape: ['data'] },
      // A document navigation is not an API call and must not become one.
      { method: 'GET', path: '/pim/addEmployee', status: 200, kind: 'document',
        requestShape: null, responseShape: null },
    ],
  })];

  const merged = mergeRecordings(a);
  const endpoints = merged.api.endpoints as { method: string; path: string; source?: string }[];

  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].path, '/api/v2/pim/employees');
  assert.equal(endpoints[0].method, 'POST');
  assert.equal(endpoints[0].source, 'recording');
});

test('an endpoint the api section already documents is not duplicated', () => {
  const a = analysis({
    api: { apiPrefix: null, tiers: {}, spec: {}, auth: null,
      endpoints: [{ method: 'POST', path: '/api/v2/pim/employees', source: 'source' }] },
  });
  a.recordings = [recording({
    requests: [{ method: 'POST', path: '/api/v2/pim/employees', status: 200, kind: 'xhr',
      requestShape: ['firstName'], responseShape: null }],
  })];

  const merged = mergeRecordings(a);
  assert.equal(merged.api.endpoints.length, 1);
  assert.equal((merged.api.endpoints[0] as { source?: string }).source, 'source',
    'the source-derived endpoint stays the one on record');
});

test('merging is idempotent — running it twice changes nothing further', () => {
  const a = analysis({
    screens: [{
      path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', title: 'Add',
      headings: [], tables: [], controls: [], links: [],
    }],
  });
  a.recordings = [recording({
    routes: [{ path: '/pim/addEmployee', url: 'https://app.test/pim/addEmployee', headings: ['Add Employee'] }],
    steps: [{ action: 'click', rawLocator: "getByRole('button', { name: 'Save' })", rung: 2,
      value: null, screenPath: '/pim/addEmployee', resolvedControl: null }],
  })];

  const once = mergeRecordings(a);
  const twice = mergeRecordings(once);
  assert.deepEqual(twice.screens, once.screens);
});

test('a recorded control on a declared-only screen makes it compilable', () => {
  // The bug this pins: a route the crawl never reached stays `crawled: false`, and the
  // compiler skips those. Adding controls to one without marking it would put them in
  // the file and never in a page object — evidence that reads as if it had been used.
  const a = analysis({
    screens: [{
      path: '/leave/applyLeave', url: 'https://app.test/leave/applyLeave', title: 'Apply',
      headings: [], tables: [], controls: [], links: [], crawled: false,
    }],
  });
  a.recordings = [recording({
    routes: [{ path: '/leave/applyLeave', url: 'https://app.test/leave/applyLeave', headings: [] }],
    steps: [{ action: 'click', rawLocator: "getByRole('button', { name: 'Apply' })", rung: 2,
      value: null, screenPath: '/leave/applyLeave', resolvedControl: null }],
  })];

  const screen = mergeRecordings(a).screens[0];
  assert.equal(screen.recordedOnly, true);
  // Still false: no crawl reached it, and the mark must not start claiming one did.
  assert.equal(screen.crawled, false);
});

test('a screen the recording only navigated through is not marked recorded-only', () => {
  // Passing through a screen proves its URL and nothing else. Marking it would let the
  // compiler treat an empty screen as one carrying observed controls.
  const a = analysis({
    screens: [{
      path: '/leave/list', url: 'https://app.test/leave/list', title: 'List',
      headings: [], tables: [], controls: [], links: [], crawled: false,
    }],
  });
  a.recordings = [recording({
    routes: [{ path: '/leave/list', url: 'https://app.test/leave/list', headings: [] }],
    steps: [{ action: 'goto', rawLocator: null, rung: 1, value: 'https://app.test/leave/list',
      screenPath: '/leave/list', resolvedControl: null }],
  })];

  const screen = mergeRecordings(a).screens[0];
  assert.equal(screen.recordedOnly, undefined);
});

test('a recording with no evidence leaves the analysis alone', () => {
  const a = analysis({
    screens: [{
      path: '/x', url: 'https://app.test/x', title: 'X',
      headings: [], tables: [], controls: [], links: [],
    }],
  });
  const merged = mergeRecordings(a);
  assert.deepEqual(merged.screens, a.screens);
  assert.equal(merged.stats.recordingConflicts, 0);
});
