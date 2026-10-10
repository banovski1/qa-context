// Give a second application its own checkout.
//
// The pipeline is deliberately single-app: one `.env` and one `analysis.json`, both at
// the root, with no `--app` anywhere. That is the whole
// point — nothing in a path or a command line has to say which application is meant.
//
// The cost is that two applications cannot share a working tree, so this creates a git
// worktree per app: a full checkout on its own branch, with its own .env and its own
// artifact, sharing one git history and one set of scripts.
//
//   node scripts/worktree/new-app.mjs <slug> [--base <branch>]
//
// Then: cd .worktrees/<slug>, edit .env, and run the pipeline exactly as you would here.

import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config/profile.mjs';

const args = process.argv.slice(2);
const slug = args.find(a => !a.startsWith('--'));
const at = args.indexOf('--base');
const base = at === -1 ? 'HEAD' : args[at + 1];

if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('usage: new-app.mjs <slug> [--base <branch>]');
  console.error('  <slug> is a directory and branch name: lowercase, digits and dashes.');
  process.exit(2);
}

const dir = join(ROOT, '.worktrees', slug);
const branch = `app/${slug}`;

if (existsSync(dir)) {
  console.error(`${dir} already exists. Remove it first:\n  git worktree remove .worktrees/${slug}`);
  process.exit(1);
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

// A branch left over from a removed worktree would make `add -b` fail with a message
// about refs rather than about what the user is actually doing.
const branchExists = git('branch', '--list', branch) !== '';

console.log(`creating worktree .worktrees/${slug} on ${branch}…`);
git('worktree', 'add', ...(branchExists ? [] : ['-b', branch]), dir, ...(branchExists ? [branch] : [base]));

// The artifact belongs to the app, and a fresh app has not been analysed yet. Leaving the
// previous app's analysis.json in place would let a compile or a generate appear to
// succeed against a model describing something else entirely.
for (const stale of ['analysis.json']) {
  const path = join(dir, stale);
  if (existsSync(path)) rmSync(path);
}

const envExample = join(dir, '.env.example');
const env = join(dir, '.env');
if (existsSync(envExample) && !existsSync(env)) copyFileSync(envExample, env);

console.log(`
done.

  cd .worktrees/${slug}
  $EDITOR .env          # every value: it still describes the app you copied from
  npm install
  /setup                # in Claude Code

The .env starts as a copy of .env.example, which is filled in for whatever app this
branch was cut from. Change APP_NAME, APP_BASE_URL, APP_REPO_PATH, APP_SESSION and the
AUTH_* selectors before crawling, or you will analyse the wrong application.

analysis.json has been removed from the new worktree: run the analysis skills there to
produce this app's own.

To remove it later:  git worktree remove .worktrees/${slug}
`);
