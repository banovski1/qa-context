// Everything /setup needs to be true before it starts doing work.
//
// The point is to fail here, with a sentence naming the file and the thing to change,
// rather than three minutes later inside a crawl that cannot log in. Each check reports
// one of: ok (verified), warn (works, but degraded), FIX (the user must do something).
//
//   node scripts/setup/preflight.mjs [--json]

import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, loadEnv } from '../config/profile.mjs';

const ENV_PATH = join(ROOT, '.env');

/** Keys without which nothing downstream can run at all. */
const REQUIRED = {
  APP_BASE_URL: 'where the running app lives, e.g. https://staging.example.com/',
  APP_REPO_PATH: "where the app's source is checked out on this machine",
};

/** Keys the pipeline degrades without, but can still produce something useful. */
const RECOMMENDED = {
  APP_USERNAME: 'without it the crawl only sees what a logged-out visitor sees',
  APP_PASSWORD: 'without it the crawl only sees what a logged-out visitor sees',
  CRAWL_SEED_ROUTES: 'without it the deep crawl has no doors to start from',
};

/** Values copied from .env.example and never actually filled in. */
const PLACEHOLDERS = [
  /^https:\/\/staging\.example\.com/i,
  /^~\/Projects\/my-app$/,
  /^My App \(staging\)$/,
  /^your\.test\.user$/,
];

const results = [];
const ok = (name, detail) => results.push({ level: 'ok', name, detail });
const fix = (name, detail, how) => results.push({ level: 'fix', name, detail, how });
const warn = (name, detail, how) => results.push({ level: 'warn', name, detail, how });

function report() {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    const mark = { ok: 'ok  ', warn: 'warn', fix: 'FIX ' };
    for (const r of results) {
      console.log(`${mark[r.level]} ${r.name.padEnd(22)} ${r.detail}`);
      if (r.how) console.log(`${' '.repeat(27)}-> ${r.how}`);
    }
    const fixes = results.filter(r => r.level === 'fix').length;
    const warns = results.filter(r => r.level === 'warn').length;
    console.log(`\n${fixes} must fix, ${warns} warning(s), ${results.length - fixes - warns} ok`);
  }
}

// -- 1. The .env exists at all -------------------------------------------------
if (!existsSync(ENV_PATH)) {
  fix('.env', 'there is no .env at the repository root',
      'cp .env.example .env   then fill it in. It is the only file you write by hand.');
  report();
  process.exit(1);
}
ok('.env', 'found at the repository root');

const env = loadEnv();

// -- 2. Required and recommended keys ------------------------------------------
for (const [key, why] of Object.entries(REQUIRED)) {
  const value = env[key];
  if (!value) {
    fix(key, `not set - ${why}`, `Set ${key}= in .env`);
  } else if (PLACEHOLDERS.some(p => p.test(value))) {
    fix(key, `still the .env.example placeholder (${value})`,
        `Set ${key} to your own app's value in .env`);
  } else {
    ok(key, value);
  }
}
for (const [key, why] of Object.entries(RECOMMENDED)) {
  if (!env[key]) warn(key, `not set - ${why}`, `Set ${key}= in .env`);
  else ok(key, key.includes('PASSWORD') ? '(set)' : env[key].slice(0, 58));
}

// -- 3. A password in the committed template is a leak -------------------------
const examplePath = join(ROOT, '.env.example');
if (existsSync(examplePath)) {
  const leaked = /^APP_PASSWORD=(.+)$/m.exec(readFileSync(examplePath, 'utf8'));
  if (leaked && leaked[1].trim()) {
    fix('.env.example', 'it contains a password, and it is committed',
        'Empty APP_PASSWORD= in .env.example. Real credentials belong only in .env, which is gitignored.');
  } else {
    ok('.env.example', 'committed template carries no credential');
  }
}

// -- 4. The source clone -------------------------------------------------------
const repo = (env.APP_REPO_PATH ?? '').replace(/^~/, process.env.HOME ?? '~');
if (repo) {
  if (!existsSync(repo)) {
    fix('source clone', `${repo} does not exist`,
        "Clone the application's source there, or point APP_REPO_PATH at where it already is. "
        + 'The analysis skills read it for declared routes, entities and endpoints.');
  } else if (!statSync(repo).isDirectory()) {
    fix('source clone', `${repo} is not a directory`, "Point APP_REPO_PATH at the clone's root.");
  } else if (!existsSync(join(repo, '.git'))) {
    warn('source clone', `${repo} is not a git clone`,
         "Staleness checks compare the analysis against the clone's commit; without git they are skipped.");
  } else {
    ok('source clone', `${repo} (git)`);
  }
}

// -- 5. The login block --------------------------------------------------------
if (!env.AUTH_LOGIN_URL) {
  warn('AUTH_LOGIN_URL', 'not set - the crawl will run logged out',
       'Set AUTH_LOGIN_URL and the AUTH_*_SELECTOR values if the app needs a login.');
} else {
  const missing = ['AUTH_USERNAME_SELECTOR', 'AUTH_SUBMIT_SELECTOR'].filter(k => !env[k]);
  if (missing.length) {
    fix('AUTH_*', `AUTH_LOGIN_URL is set but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not`,
        'A login needs the field selectors as well as the URL, or the crawl cannot perform it.');
  } else {
    ok('AUTH_*', 'login URL and field selectors present');
  }
  if (!env.AUTH_READY_WHEN) {
    fix('AUTH_READY_WHEN', 'not set',
        'Without it the crawl cannot tell a successful login from a re-rendered login page, and will '
        + 'report screens it never reached. Pick something you can SEE once logged in.');
  } else {
    ok('AUTH_READY_WHEN', env.AUTH_READY_WHEN);
  }
}

// -- 6. The toolchain ----------------------------------------------------------
function version(cmd, args) {
  // On Windows a global npm install lands as a .cmd shim, which execFileSync cannot
  // execute directly: the bare name is ENOENT and the .cmd is EINVAL. Route through
  // cmd.exe there so an installed tool is not reported missing.
  const [exe, argv] = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', cmd, ...args]]
    : [cmd, args];
  try {
    const out = execFileSync(exe, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // A tool may print a banner before its version; the version is the last line.
    return out.split(/\r?\n/).filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

const node = process.versions.node;
if (Number(node.split('.')[0]) < 20) {
  fix('node', `v${node} is too old`, 'Install Node 20 or newer; the pipeline uses the native test runner and tsx.');
} else {
  ok('node', `v${node}`);
}

if (existsSync(join(ROOT, 'node_modules/tsx'))) {
  ok('toolchain', 'installed');
} else {
  warn('toolchain', 'node_modules is missing', 'npm install');
}

const pwCli = version('playwright-cli', ['--version']) ?? version('npx', ['--no-install', 'playwright', '--version']);
if (pwCli) {
  ok('playwright-cli', pwCli);
} else {
  fix('playwright-cli', 'not on PATH, and no local playwright either',
      'npm install -g @playwright/cli@latest   - it is the only thing that drives a browser here.');
}


// -- 7. What already exists ----------------------------------------------------
const analysisPath = join(ROOT, 'analysis.json');
if (!existsSync(analysisPath)) {
  ok('analysis.json', 'not yet produced - /setup will build it');
} else {
  let analysis;
  try {
    analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
  } catch {
    fix('analysis.json', 'exists but is not valid JSON', 'Delete it and re-run the analysis.');
  }
  if (analysis) {
    const trim = (u) => String(u ?? '').replace(/\/$/, '');
    // An artifact describing a different app is the one failure that looks like success:
    // the compiler would run happily against the wrong model.
    if (analysis.app?.baseUrl && env.APP_BASE_URL && trim(analysis.app.baseUrl) !== trim(env.APP_BASE_URL)) {
      fix('analysis.json', `it describes ${analysis.app.baseUrl}, but .env says ${env.APP_BASE_URL}`,
          'This artifact belongs to a different application. Delete it and re-run the analysis, or give '
          + 'the new app its own checkout: npm run app:worktree -- <slug>');
    } else {
      const empty = ['source', 'conventions', 'api', 'map', 'screens'].filter((k) => {
        const section = analysis[k];
        if (!section) return true;
        return Array.isArray(section) ? section.length === 0 : Object.keys(section).length === 0;
      });
      ok('analysis.json', empty.length
        ? `present; sections still empty: ${empty.join(', ')}`
        : `complete - ${analysis.screens?.length ?? 0} screens`);
    }
  }
}

report();
process.exit(results.some(r => r.level === 'fix') ? 1 : 0);
