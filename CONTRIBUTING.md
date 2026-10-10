# Contributing

Thanks for being here. Three things to know before you open a pull request.

### 1. Your contribution is Apache-2.0

There is nothing to sign. Apache-2.0 section 5 says any contribution you
deliberately submit is licensed under the same terms as the project, unless you
state otherwise. You keep the copyright on your own work.

If any part of what you send is *not* your original creation, say so in the pull
request and name its source and licence.

### 2. `master` is protected

You cannot push to it, and neither can the maintainer. Everything lands through a
pull request that is reviewed and green. Branch from `master`, name it after what
it does (`fix/ambiguous-locator-report`), open the PR.

### 3. The pipeline has a test suite, and it is the review

```bash
npm install
npm run pipeline:test     # the compiler and analysis suites
npm run pipeline:typecheck
```

All four run in CI on every PR. A change to `scripts/model-compiler/` without a
fixture is not finished.

---

## What a good change looks like

**The compiler is pure and snapshot-tested.** `compile-model.ts` takes
`analysis.json` and returns `analysis.json`. It reads no network, no clock, no
environment. Keep it that way — the snapshots are the only reason a generator
change can be trusted.

**A generator change validated against one application has not been validated.**
The corpus in `CLAUDE.md` lists four apps and the problem each one proved. Make
worktrees (`npm run app:worktree -- <slug>`), regenerate in each, compare. Say in
the PR which apps you checked.

**Locators live in exactly one layer.** If your change puts a CSS selector
anywhere outside a component class, `assertNoSelectors` will fail and it is right.

## What not to send

- Hand-edits to `analysis.json`. It is produced. Fix the skill that wrote it.
- Hand-edits to `recordings/`. They are evidence of what happened.
- A real credential in `.env.example`, a recording, or a fixture. `.env` is
  gitignored; keep it that way.
- Playwright MCP tooling. `playwright-cli` is the only thing that drives a browser
  here, and `CLAUDE.md` explains why there is no exception.

## Reporting things

- A bug: the issue template asks for `npm run preflight` and `npm run check` output.
  Those two answer most questions.
- A vulnerability: privately. See [`SECURITY.md`](SECURITY.md).

## Licence

By contributing you agree your work is licensed under Apache-2.0. See
[`LICENSE`](LICENSE).
