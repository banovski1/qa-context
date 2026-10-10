#!/usr/bin/env -S npx tsx
/**
 * Pour a recording back into the analysis.
 *
 * This closes the loop the confidence score opens. A screen scoring below 0.7 asks for
 * a recording; before this existed the recording was made, saved, and counted for
 * nothing beyond a score bump — so the second recording of an app cost what the first
 * one did, and the analysis never got better at the app it was pointed at.
 *
 *   npx tsx scripts/analysis/ingest-recording.ts \
 *     recordings/apply-leave-20260913-100000.json
 *
 * It writes two sections and no others:
 *
 *   - `recordings`          the evidence: steps, routes, requests, exactly as observed
 *   - `testability`         the flow registered by name, and every screen rescored
 *
 * Everything derived from the evidence — new screens, new controls, new endpoints — is
 * the compiler's job, via `merge-recordings.ts`. This tool records what happened; it
 * concludes nothing. Run `npm run compile` afterwards and the loop is closed.
 *
 * This replaces `register-recording.ts`, which did the second half only. Two tools, one
 * registering a flow by name and one ingesting its content, would be two ways for the
 * file to be half up to date.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT, readAnalysis, writeSection } from './analysis-file.ts';
import { scoreScreens, verdictFor } from './testability.ts';
import { classify } from './locator-rung.ts';
import type { AnalysisRecording, RecordedStep, RecordedRequest } from './analysis-types.ts';
import { pathToFileURL } from 'node:url';

/** The session document the app-recorder skill writes beside its Markdown record. */
interface SessionDoc {
  flow: string;
  recordedAt: string;
  file: string;
  baseUrl?: string;
  steps: Partial<RecordedStep>[];
  routes?: { path: string; url: string; headings?: string[] }[];
  requests?: Partial<RecordedRequest>[];
}

const ACTIONS = new Set(['goto', 'click', 'fill', 'select', 'check', 'uncheck', 'press']);

/**
 * Normalise the session document into the `recordings` section's shape.
 *
 * The recorder writes what `playwright-cli` gave it; this decides what the analysis is
 * willing to hold. Two things happen here and nowhere else: every step's locator is put
 * on the shared ladder, and the screen each step ran against is resolved from the most
 * recent navigation — a step does not carry its own route, because the recorder does not
 * know one until the page has settled.
 */
export function normalise(doc: SessionDoc): AnalysisRecording {
  let current: string | null = null;

  const steps: RecordedStep[] = (doc.steps ?? []).map(raw => {
    const action = ACTIONS.has(String(raw.action)) ? raw.action! : 'other';
    if (action === 'goto') current = raw.screenPath ?? pathOf(raw.value) ?? current;
    const rawLocator = raw.rawLocator ?? null;
    return {
      action,
      rawLocator,
      // The rung is stamped at ingest, not read at merge time, so a later change to the
      // ladder cannot silently re-interpret a recording already on record.
      rung: classify(rawLocator).rung,
      value: raw.value ?? null,
      screenPath: raw.screenPath ?? current,
      resolvedControl: raw.resolvedControl ?? null,
    };
  });

  const routes = (doc.routes ?? []).map(r => ({
    path: r.path,
    url: r.url,
    headings: r.headings ?? [],
  }));

  const requests: RecordedRequest[] = (doc.requests ?? []).map((r): RecordedRequest => ({
    method: String(r.method ?? 'GET').toUpperCase(),
    path: r.path ?? '',
    status: Number(r.status ?? 0),
    kind: r.kind === 'document' || r.kind === 'fetch' ? r.kind : 'xhr',
    // Keys, not values: a precondition needs to know the endpoint takes a `jobTitleId`,
    // and the particular one this human picked helps nobody and belongs to them.
    requestShape: r.requestShape ?? null,
    responseShape: r.responseShape ?? null,
  })).filter(r => r.path);

  return { flow: doc.flow, recordedAt: doc.recordedAt, file: doc.file, steps, routes, requests };
}

/** The path half of a URL, for resolving which screen a `goto` landed on. */
function pathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url.startsWith('/') ? url : null; }
}

function main(): void {
  const arg = process.argv[2];
  if (!arg || arg.startsWith('-')) {
    console.error('usage: ingest-recording.ts <recordings/<flow>-<timestamp>.json>');
    console.error('  the session document the app-recorder skill wrote beside its .md record');
    process.exit(2);
  }

  const docPath = resolve(ROOT, arg);
  if (!existsSync(docPath)) {
    console.error(`${arg} does not exist. Ingest a recording only after it has been saved.`);
    process.exit(1);
  }

  let doc: SessionDoc;
  try {
    doc = JSON.parse(readFileSync(docPath, 'utf8'));
  } catch (e) {
    console.error(`${arg} is not readable JSON: ${(e as Error).message}`);
    process.exit(1);
  }

  if (!doc.flow || !doc.recordedAt) {
    console.error(`${arg} carries no flow name or no timestamp. Nothing was written.`);
    process.exit(1);
  }

  const recording = normalise(doc);
  if (!recording.steps.length) {
    console.error(`${arg} records no steps. A recording of nothing raises nothing; nothing was written.`);
    process.exit(1);
  }

  // The committed Markdown record is what a human reads when they want to know what the
  // recording actually showed. A recordings entry pointing at a file that is not there
  // is a citation to nothing.
  const record = doc.file ?? relative(ROOT, docPath).replace(/\.json$/, '.md');
  if (!existsSync(join(ROOT, record))) {
    console.error(`the recording's own record, ${record}, does not exist.`);
    console.error('The .md and the .json are written together; ingest needs both.');
    process.exit(1);
  }
  recording.file = record;

  const analysis = readAnalysis();
  const known = new Set(analysis.screens.map(s => s.path));

  // A route the analysis has never heard of is the interesting case, not an error: it is
  // precisely the declared-but-unreached screen a recording exists to fill in. Say which
  // ones are new, so a typo in a path is visible rather than silently becoming a screen.
  const fresh = recording.routes.map(r => r.path).filter(p => !known.has(p));

  // Re-recording a flow supersedes the recording it corrects rather than stacking beside
  // it — otherwise the evidence for one flow would be spread across every attempt at it.
  const recordings = [
    ...(analysis.recordings ?? []).filter(r => r.flow !== recording.flow),
    recording,
  ].sort((a, b) => a.flow.localeCompare(b.flow));

  // The scorer's list is a flat register of flow names by screen. It stays separate from
  // the evidence above: one says a flow was recorded, the other says what it saw.
  const registered = [
    ...(analysis.testability?.recordings ?? []).filter(r => r.flow !== recording.flow),
    {
      flow: recording.flow,
      path: recording.file,
      recordedAt: recording.recordedAt,
      screens: recording.routes.map(r => r.path),
    },
  ].sort((a, b) => a.flow.localeCompare(b.flow));

  const covered = new Set(recording.routes.map(r => r.path));
  const before = analysis.screens
    .filter(s => covered.has(s.path))
    .map(s => [s.path, s.testability?.confidence ?? 0] as const);

  const testability = scoreScreens(analysis.screens, registered);

  writeSection('recordings', recordings);
  writeSection('screens', analysis.screens);
  writeSection('testability', testability);

  const unstable = recording.steps.filter(s => s.rawLocator && classify(s.rawLocator).stable === false).length;

  console.log(`ingested ${recording.flow} ← ${relative(ROOT, docPath)}`);
  console.log(`  ${recording.steps.length} step(s), ${unstable} through a locator that names no control`);
  console.log(`  ${recording.routes.length} route(s), ${recording.requests.length} request(s)`);
  for (const path of fresh) console.log(`  new route, not in screens yet: ${path}`);
  for (const [path, was] of before) {
    const now = analysis.screens.find(s => s.path === path)!.testability!.confidence;
    console.log(`  ${path}  ${was} → ${now}  (${verdictFor(now)})`);
  }
  // The evidence is on record; nothing is derived from it until the compiler runs. Saying
  // so is the difference between a closed loop and a file that looks updated.
  console.log('\nnow run `npm run compile` — the routes, controls and endpoints above');
  console.log('reach screens, components and api.resources through merge-recordings.ts.');
}

// `file://${process.argv[1]}` is not this module's URL on Windows: argv carries a
// drive-letter path with backslashes and import.meta.url is a percent-encoded file
// URL with forward slashes. The two never matched, so running this file directly did
// nothing at all and said so with exit code 0. pathToFileURL is the comparison that
// holds on every platform.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
