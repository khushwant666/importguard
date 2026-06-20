# ImportGuard — Catch AI Hallucinated Imports

ImportGuard is a VS Code extension that flags imports referencing packages or
modules that **don't actually exist**, so you catch AI assistant hallucinations
*before* they hit production.

## Why this exists

AI coding assistants like Claude Code, GitHub Copilot, and Cursor occasionally
invent plausible-sounding package names that don't exist. You usually don't
notice until `npm install` / `pip install` fails — or worse, until you
accidentally install a **malicious typosquat** package with a similar name.

The vendors' own tools won't reliably flag this: they're generating the output
from *inside* the model's context. ImportGuard checks **after** the AI's output,
**from outside** the AI's context — it compares the imports actually present in
your file against your real, declared dependencies (`package.json`) or your real,
installed Python environment. That's exactly the blind spot the generating tool
can't cover.

## What it checks

- **JavaScript / TypeScript / Angular / JSX / TSX**
  - Detects `import`, `export ... from`, side-effect `import 'pkg'`, and
    `require()` forms.
  - Skips Node.js built-ins (e.g. `fs`, `path`, `crypto`, including the `node:`
    prefix form).
  - Skips relative/absolute imports (`./`, `../`, `/`) and common path aliases
    (`@/`, `~/`, `src/`).
  - Resolves scoped packages (`@scope/pkg/subpath` → `@scope/pkg`) and regular
    subpaths (`pkg/subpath` → `pkg`) to their package root.
  - Finds the **nearest** `package.json` by walking up the directory tree (works
    in monorepos), reads `dependencies`, `devDependencies`, `peerDependencies`,
    and `optionalDependencies`, and flags anything not declared there.
  - If no `package.json` is found anywhere up the tree, it reports nothing (to
    avoid false positives).

- **Python**
  - Detects both `from X import Y` and `import X, Y as z` forms.
  - Skips common standard-library modules.
  - Verifies every other top-level module actually exists by shelling out to your
    configured interpreter (`importlib.util.find_spec`).
  - Flags modules that can't be found in the active environment.

Findings appear as **Warning** squiggles (source: `ImportGuard`) in the editor
and the Problems panel.

## Running locally (F5)

1. `npm install`
2. Press **F5** (or Run → Start Debugging). This compiles via the bundled build
   task and launches an **Extension Development Host** window with ImportGuard
   loaded.
3. In that window, open a JS/TS or Python file and start scanning.

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **ImportGuard: Scan Current File** (`importguard.scanFile`) — scans the active
  editor and shows a result-count message.
- **ImportGuard: Scan Entire Workspace** (`importguard.scanWorkspace`) — scans
  all open documents and shows a summary.

ImportGuard also scans automatically when a file is **opened** and (by default)
when it is **saved**.

## Settings

- `importguard.enableOnSave` (boolean, default `true`) — auto-scan a file on
  save.
- `importguard.pythonPath` (string, default `"python3"`) — interpreter used to
  verify Python imports. Point this at your project's venv interpreter for
  accurate results.

## Packaging for the Marketplace

Install the packaging tool and build a `.vsix`:

```bash
npm install -g @vscode/vsce
vsce package
```

This produces an `importguard-<version>.vsix` you can install locally
(`code --install-extension importguard-<version>.vsix`) or publish to the
Marketplace with `vsce publish`.

## Limitations (v1)

- Path-alias imports are skipped rather than resolved via `tsconfig.json`.
- Node checking validates against *declared* dependencies, not what's physically
  installed in `node_modules`.
- Python checking requires the configured interpreter to be the one your project
  actually uses.

## Author

Created and maintained by **Khushwant R.**

## Contributing

This is a source-available project, not open source. Issues and feature requests
are welcome via [GitHub Issues](https://github.com/khushwant666/importguard/issues),
but the code is **not** licensed for reuse, modification, or redistribution.
Pull requests are accepted at the author's discretion and only the author can
merge to `main` and publish releases.

## License

**Proprietary — All Rights Reserved.** The source is published for transparency
and evaluation only. You may view it and use the official extension from the
Marketplace, but you may **not** copy, modify, redistribute, or republish it.
See the [LICENSE](./LICENSE) file for full terms.
