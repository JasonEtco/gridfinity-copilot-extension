# Contributing

Thanks for helping make Gridfinity Builder better! Bug reports, small fixes,
documentation improvements, and tested geometry changes are welcome.

## Before you start

- Search existing issues before opening a new one. Use the bug or feature form
  to describe what happened or what you want to make.
- For larger changes, open an issue first so we can agree on the scope.
- Keep discussion kind and constructive. Critique the work, not the person;
  harassment and sharing someone else's private information are not welcome.
- Report vulnerabilities privately where possible; see [SECURITY.md](SECURITY.md).
  Do not put sensitive reports in public issues.

## Local setup

Fork and clone the repository, create a branch, and use Node.js **22 or 24**.
From the repository root:

```sh
npm ci
npm test
npm run build:vendor
```

Tests use Node's built-in test runner. For a focused change, run the relevant
file with `node --test tests/<name>.test.mjs`, then run `npm test` before opening
a pull request. There is no separate lint command.

Three.js and esbuild are development-only dependencies. `build:vendor` generates
the local browser bundle in `.github/extensions/gridfinity-builder/vendor/`.
Include regenerated files and their license notices when updating dependencies
or bundle inputs. Do not hand-edit generated code. A clean checkout should
remain unchanged after the build:

```sh
git diff --exit-code -- .github/extensions/gridfinity-builder/vendor/
git ls-files --others --exclude-standard -- .github/extensions/gridfinity-builder/vendor/
```

The second command should print nothing. CI enforces this on both Node versions.
Installed users copy the self-contained extension folder and do not run npm.
Do not add `@github/copilot-sdk` to the package manifest; the host resolves it.

## Try it in Copilot

You need a Copilot app/CLI release with extension canvases, not just a terminal
client. Open this checkout in Copilot so its project extension can load.

1. After extension changes, call `extensions_reload`.
2. Use `extensions_manage` with `list` and `inspect` to check load status and logs.
3. Use `list_canvas_capabilities`, then open `gridfinity-builder` with a fresh
   test `designId`. Read `get_state` before applying edits with `expectedRevision`.
4. Check grid editing, rotation, collisions, persistence after reopening,
   JSON round-tripping, 3D orbit/zoom, and affected export paths.
5. For inlay changes, try a non-sensitive photo, adjust its outline, real width,
   depth, and clearance, and check both the preview and exported OpenSCAD.
6. Check the Layout, New bin, and New grid tabs. Try an exact drawer fit and a
   non-multiple of 42 mm, inspect the edge spacers, and verify rejected resizing
   preserves bins and drawer settings.
7. For STL changes, use a local OpenSCAD installation. Verify actual geometry,
   not just file creation. Test the Bambu handoff without starting a print.

Designs live under `$COPILOT_HOME/extensions/gridfinity-builder/artifacts/`
even for project installs (`COPILOT_HOME` defaults to `~/.copilot`). Use distinct
test IDs; never delete or overwrite someone's saved designs to reset a test.
Do not commit personal layouts, photos, tokens, logs, or live panel URLs.
Exported JSON may embed a photo. Use synthetic fixtures in tests and reports.

## Making changes

- Keep pull requests focused and explain the user-visible reason for a change.
- Add regression tests for model, schema, storage, HTTP, or geometry behavior.
  Preserve the version-1 format and loading of older layouts without optional
  `bin.inlay`. Inlay edits without `photo` retain the existing photo;
  `inlay: null` removes both. State reads intentionally omit photo bytes.
- Keep edits transactional and revision-checked; never silently overwrite a
  newer design. Keep path validation, loopback binding, and token/origin checks.
- Bundle browser dependencies locally. Do not add runtime CDN loads, remote
  image uploads, or new external services without discussing the privacy impact.
- Preserve the distinction between prototype geometry and verified print fit.
  Cite dimensional sources when changing Gridfinity interfaces. Describe any
  OpenSCAD checks or physical fit tests, including printer/material/tolerance;
  do not imply that a passing unit test proves printability.
- Follow the surrounding code style. Extension stdout is reserved for JSON-RPC;
  use the existing logging facilities, not `console.log`.

The [README](README.md) describes installation, storage, and fabrication limits.
Update it when user-facing behavior changes.

## Pull requests

Explain **why** and **how**, link relevant issues, and list the checks you ran.
For visual changes, include screenshots or a short recording using a synthetic
design. Note anything you could not verify in a live Copilot runtime.

CI runs `npm ci`, `npm test`, and `npm run build:vendor` on Node 22 and 24, then
checks the vendor output for drift. Dependency update PRs may need a local
rebuild and committed vendor changes before CI passes.

Contributions are covered by the project's [MIT license](LICENSE). Only include
code, photos, and other assets you have permission to share.
