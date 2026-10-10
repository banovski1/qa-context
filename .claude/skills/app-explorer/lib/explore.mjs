#!/usr/bin/env node
// The crawl driver. Owns the queue, the budget and the artifacts; the browser is
// only ever touched through `playwright-cli run-code`, one bounded batch at a
// time, so an interrupted run resumes instead of restarting.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { loadEnv, loadProfile, resolveEnvValue, ROOT } from '../../../../scripts/config/profile.mjs';
import { playwrightCliArgv } from '../../../../scripts/config/playwright-cli.mjs';
import { buildBundle } from './build-bundle.mjs';
import { writeScreensSection } from './write-screens.mjs';
import { routeId, sameApp, excluded, seedTargets } from './seeds.mjs';

const run = promisify(execFile);

const DEFAULTS = {
  testIdAttribute: 'data-testid',
  settleTimeout: 8000,
  navTimeout: 30000,
  sampleMs: 150,
  maxSamples: 40,
  quietSamples: 3,
  batchSize: 6,
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at === -1 ? fallback : args[at + 1];
};
const has = (name) => args.includes('--' + name);

const profile = loadProfile();
const env = loadEnv();
const outDir = ROOT;
// Raw crawl output is working material, not an artifact: it carries a candidate ladder
// and a bounding box per element, which was fifteen megabytes for one app and unreadable
// at any size. It stays out of analysis/ and is distilled into analysis.json at the end.
const scratchDir = join(outDir, '.crawl');
const screensDir = join(scratchDir, 'screens');
const statePath = join(scratchDir, 'crawl-state.json');
const networkPath = join(scratchDir, 'network.json');
const session = flag('session', profile.session || 'app-explorer');
const budget = profile.budget || {};
const maxScreens = Number(flag('max-screens', budget.maxScreens || 60));
const settings = { ...DEFAULTS, ...(profile.settings || {}) };
const batchSize = Number(flag('batch-size', settings.batchSize));

const log = (...parts) => console.log('[explore]', ...parts);

// The map is read, never written: it is map.mjs's output. A checkout that has not
// been mapped yet starts from the base URL and CRAWL_SEED_ROUTES alone.
async function readMap() {
  try {
    return JSON.parse(await readFile(join(outDir, 'analysis.json'), 'utf8')).map || null;
  } catch {
    return null;
  }
}

async function loadState() {
  if (has('resume') && existsSync(statePath)) {
    return JSON.parse(await readFile(statePath, 'utf8'));
  }
  const pending = seedTargets({
    baseUrl: profile.baseUrl,
    seedRoutes: profile.seedRoutes || [],
    exclude: profile.exclude || [],
    map: await readMap(),
  });
  // `queued` records every id the crawl has ever taken an interest in. Without
  // it, a screen that is in flight — spliced out of `pending` but not yet
  // visited — gets enqueued a second time by whatever links to it.
  const queued = Object.fromEntries(pending.map((target) => [target.id, true]));
  return {
    pending, queued, seeded: pending.length,
    visited: {}, failed: {}, authenticated: false, startedAt: new Date().toISOString(),
  };
}

async function saveState(state) {
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

async function runBatch(config) {
  const bundleFile = join(outDir, '.batch.js');
  await buildBundle({ config, outFile: bundleFile });
  let stdout;
  try {
    ({ stdout } = await run(...playwrightCliArgv(['-s=' + session, '--raw', 'run-code', '--filename=' + bundleFile]), {
      maxBuffer: 256 * 1024 * 1024,
    }));
  } catch (error) {
    throw new Error(`${error.message}\n${(error.stdout || '').slice(0, 800)}\n${(error.stderr || '').slice(0, 800)}`);
  }
  await rm(bundleFile, { force: true });
  const start = stdout.indexOf('{');
  if (start === -1) throw new Error('run-code returned no JSON:\n' + stdout.slice(0, 500));
  return JSON.parse(stdout.slice(start, stdout.lastIndexOf('}') + 1));
}

await mkdir(screensDir, { recursive: true });

if (has('reports-only')) {
  await writeScreensSection({ outDir, screensDir });
  log('screens section rewritten from the existing crawl');
  process.exit(0);
}

const state = await loadState();
// The budget bounds discovery, never the screens already known to exist: every seed is
// visited, and CRAWL_MAX_SCREENS only limits what links add beyond a smaller seed set.
const screenBudget = Math.max(maxScreens, state.seeded || 0);
log(`${state.seeded ?? '?'} seeds (base URL, CRAWL_SEED_ROUTES, map) — budget ${screenBudget} screens`);
const network = existsSync(networkPath) && has('resume')
  ? JSON.parse(await readFile(networkPath, 'utf8'))
  : [];

// Credentials are read from the environment at the last moment, so neither the
// profile nor any artifact ever carries one.
const authConfig = profile.auth
  ? {
    loginUrl: profile.auth.loginUrl || profile.baseUrl,
    steps: (profile.auth.steps || []).map((step) => ({
      ...step,
      value: resolveEnvValue(step.value, env),
    })),
    readyWhen: profile.auth.readyWhen || null,
  }
  : null;

let batches = 0;
let consecutiveFailures = 0;
while (state.pending.length && Object.keys(state.visited).length < screenBudget) {
  // A crawl that cannot reach the browser at all should stop and say so rather
  // than burn the whole queue producing identical failures.
  if (consecutiveFailures >= 3) {
    log('three batches failed in a row — stopping. See crawl-state.json for the reason.');
    break;
  }
  const targets = state.pending.splice(0, batchSize);
  const config = {
    targets: targets.map((t) => ({ id: t.id, url: t.url })),
    auth: state.authenticated ? null : authConfig,
    testIdAttribute: settings.testIdAttribute,
    contentSelector: settings.contentSelector || null,
    settleTimeout: settings.settleTimeout,
    navTimeout: settings.navTimeout,
    sampleMs: settings.sampleMs,
    maxSamples: settings.maxSamples,
    quietSamples: settings.quietSamples,
  };
  log(`batch ${++batches}: ${targets.map((t) => t.id).join(', ')}`);
  let batch;
  try {
    batch = await runBatch(config);
  } catch (error) {
    for (const target of targets) {
      state.failed[target.id] = { url: target.url, error: String(error.message).slice(0, 400) };
    }
    await saveState(state);
    consecutiveFailures++;
    log('batch failed:', error.message);
    continue;
  }
  consecutiveFailures = 0;
  if (batch.authenticated === false) {
    await saveState(state);
    throw new Error('authentication failed: ' + (batch.error || JSON.stringify(batch.results).slice(0, 300)));
  }
  state.authenticated = true;

  for (const entry of batch.network || []) network.push(entry);

  for (const result of batch.results) {
    if (!result.ok) {
      state.failed[result.target] = { url: result.url, error: result.error, settled: result.settled };
      continue;
    }
    const depth = (targets.find((t) => t.id === result.target) || {}).depth || 0;
    state.visited[result.target] = {
      url: result.url,
      title: result.screen.title,
      settled: result.settled,
      stats: result.screen.stats,
      depth,
    };
    await writeFile(join(screensDir, result.target + '.json'), JSON.stringify(result.screen, null, 2));

    if (depth >= Number(budget.maxDepth ?? 3)) continue;
    for (const link of result.screen.links) {
      const absolute = link.resolved;
      if (!absolute || !sameApp(absolute, profile.baseUrl)) continue;
      if (excluded(absolute, profile.exclude)) continue;
      const id = routeId(absolute, profile.baseUrl);
      if (state.queued[id]) continue;
      if (Object.keys(state.queued).length >= screenBudget) break;
      state.queued[id] = true;
      state.pending.push({ id, url: absolute, depth: depth + 1 });
    }
  }
  await saveState(state);
  await writeFile(networkPath, JSON.stringify(network, null, 2));
}

state.finishedAt = new Date().toISOString();
await saveState(state);
await writeFile(networkPath, JSON.stringify(network, null, 2));
log(`crawled ${Object.keys(state.visited).length} screens, ${Object.keys(state.failed).length} failed`);

await writeScreensSection({ outDir, screensDir });
log('screens written to', join(outDir, 'analysis.json'));
