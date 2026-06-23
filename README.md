# ImportGuard

AI assistants love to invent packages. You ask Copilot, Claude, or Cursor for
some functionality, it confidently writes `import { magic } from
"super-cool-utils"`, and that package simply doesn't exist. You don't find out
until `npm install` fails — or worse, until you install a typosquatted package
with a similar name that someone planted on purpose.

ImportGuard checks every import in your file against what's actually declared in
your `package.json` (and, for Python, what's installed in your environment) and
warns you about anything that doesn't line up. It runs the moment you open or
save a file, so made-up imports get caught before they cost you.

## What it catches

**JavaScript / TypeScript / Angular / JSX / TSX** — any `import`, `export … from`,
side-effect `import "pkg"`, or `require()` that points to a package not listed in
your dependencies. It understands scoped packages (`@scope/pkg`) and subpaths,
skips Node built-ins and relative/alias imports, and walks up the folder tree to
find the nearest `package.json` (so it works in monorepos).

**Python** — `import` and `from … import` statements for modules that don't exist
in your active environment. Standard-library modules are skipped.

Anything suspicious gets a warning underline and an entry in the Problems panel.

## How to use it

There's nothing to configure. Open a JavaScript, TypeScript, or Python file and
ImportGuard scans it automatically — on open and on every save. Anything it can't
verify gets a yellow underline and shows up in the Problems panel
(`Ctrl+Shift+M` / `Cmd+Shift+M`).

To scan on demand, open the Command Palette (`Ctrl+Shift+P`) and run:

- **ImportGuard: Scan Current File**
- **ImportGuard: Scan Entire Workspace**

For Python, point ImportGuard at the interpreter your project actually uses (your
virtualenv) via the `importguard.pythonPath` setting, so the checks match your
real environment.

## Settings

- `importguard.enableOnSave` — scan automatically on save (on by default).
- `importguard.pythonPath` — the Python interpreter used to verify imports
  (default `python3`; on Windows you'll usually want `python` or the full path to
  your venv).

## Good to know

- For JS/TS, ImportGuard checks against the dependencies **declared** in
  `package.json` (dependencies, devDependencies, peerDependencies, and
  optionalDependencies). If there's no `package.json` up the tree, it stays quiet
  to avoid false alarms.
- Path-alias imports (`@/…`, `~/…`, `src/…`) are skipped for now.

## Support

If ImportGuard caught a bad import before it bit you, consider giving it a ⭐ on
[GitHub](https://github.com/khushwant666/importguard) and a review on the VS Code
Marketplace!

## License

Proprietary — all rights reserved. See [LICENSE](./LICENSE).
