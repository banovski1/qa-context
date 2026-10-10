import assert from 'node:assert/strict';
import test from 'node:test';
import {mapScreenUrls, routeId, seedTargets} from './seeds.mjs';

const baseUrl = 'https://hr.example.test/web/index.php';
const map = {
  modules: [
    {name: 'Admin', screens: [
      {name: 'Users', url: baseUrl + '/admin/viewSystemUsers'},
      {name: 'User', url: baseUrl + '/admin/saveSystemUser/1234'},
      {name: 'User again', url: baseUrl + '/admin/saveSystemUser/5678'},
    ]},
    {name: 'Maintenance', screens: [{name: 'Purge', url: baseUrl + '/maintenance/purgeEmployee'}]},
    {name: 'Help', screens: [{name: 'Docs', url: 'https://help.example.org/hc'}]},
    {name: 'Session', screens: [{name: 'Logout', url: baseUrl + '/auth/logout'}, {name: 'No url'}]},
  ],
};

test('the map seeds the crawl alongside the base URL and CRAWL_SEED_ROUTES', () => {
  const targets = seedTargets({
    baseUrl,
    seedRoutes: ['/dashboard/index', '/admin/viewSystemUsers'],
    exclude: ['logout', 'maintenance'],
    map,
  });
  assert.deepEqual(targets.map(t => t.url), [
    baseUrl,
    baseUrl + '/dashboard/index',
    baseUrl + '/admin/viewSystemUsers',
    baseUrl + '/admin/saveSystemUser/1234',
  ]);
  assert.ok(targets.every(t => t.depth === 0));
  assert.equal(new Set(targets.map(t => t.id)).size, targets.length);
});

test('map screens dedupe through routeId, so two records of one route are one target', () => {
  const ids = seedTargets({baseUrl, map}).map(t => t.id);
  const record = routeId(baseUrl + '/admin/saveSystemUser/5678', baseUrl);
  assert.equal(record, 'admin-saveSystemUser-id');
  assert.equal(ids.filter(id => id === record).length, 1);
});

test('other origins and CRAWL_EXCLUDE never seed', () => {
  const urls = seedTargets({baseUrl, exclude: ['logout', 'maintenance'], map}).map(t => t.url);
  assert.ok(!urls.some(url => url.includes('help.example.org')));
  assert.ok(!urls.some(url => url.includes('logout') || url.includes('maintenance')));
});

test('a missing or empty map leaves the base URL and the configured seeds', () => {
  for (const missing of [null, undefined, {}, {modules: []}, {modules: [{name: 'Empty'}]}]) {
    assert.deepEqual(
      seedTargets({baseUrl, seedRoutes: ['/dashboard/index'], map: missing}).map(t => t.url),
      [baseUrl, baseUrl + '/dashboard/index'],
    );
  }
  assert.deepEqual(mapScreenUrls(undefined), []);
});
