import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Node.js built-in modules. These are always valid and never need to be checked
 * against package.json. The "node:" prefix is stripped before lookup so that
 * "node:fs" matches "fs".
 */
const NODE_BUILTINS = new Set<string>([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

/**
 * Matches the following import forms in a single pass:
 *   import X from 'pkg'
 *   import { X } from 'pkg'
 *   import * as X from 'pkg'
 *   import 'pkg'                (side-effect)
 *   export { X } from 'pkg'
 *   require('pkg')
 */
// Note: the middle clause uses [^'"]*? rather than [\s\S]*? so it cannot cross a
// string literal. With [\s\S]*?, a side-effect import (import 'pkg') immediately
// followed by any "... from '...'" statement gets swallowed: the lazy match runs
// past the side-effect specifier to the next line's "from", capturing the wrong
// module and dropping the side-effect import entirely. [^'"]*? still allows
// multi-line named imports (no quotes inside the import clause).
const IMPORT_REGEX =
  /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

interface CachedPackageJson {
  mtimeMs: number;
  deps: Set<string>;
}

const packageJsonCache = new Map<string, CachedPackageJson>();

/**
 * Walk UP the directory tree from the given file looking for the nearest
 * package.json. Works in monorepos with nested package.json files. Returns the
 * absolute path to the nearest package.json, or undefined if none is found
 * within the level limit.
 */
function findNearestPackageJson(filePath: string): string | undefined {
  let dir = path.dirname(filePath);
  const maxLevels = 15;

  for (let i = 0; i < maxLevels; i++) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

/**
 * Read all declared dependencies from a package.json, using an mtime-keyed cache
 * so repeated saves in the same project don't re-read/re-parse the file.
 */
function readDependencies(packageJsonPath: string): Set<string> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(packageJsonPath);
  } catch {
    return new Set<string>();
  }

  const cached = packageJsonCache.get(packageJsonPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.deps;
  }

  const deps = new Set<string>();
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sections = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ];
    for (const section of sections) {
      const obj = parsed[section];
      if (obj && typeof obj === "object") {
        for (const name of Object.keys(obj as Record<string, unknown>)) {
          deps.add(name);
        }
      }
    }
  } catch {
    // Malformed package.json — treat as having no declared deps rather than
    // crashing. Returning an empty set could cause false positives, but a
    // broken package.json is itself worth surfacing via the imports.
    return new Set<string>();
  }

  packageJsonCache.set(packageJsonPath, { mtimeMs: stat.mtimeMs, deps });
  return deps;
}

/**
 * Given a raw import specifier, extract the package "root" name used to look it
 * up in package.json.
 *   "@scope/pkg/subpath" -> "@scope/pkg"
 *   "pkg/subpath"        -> "pkg"
 */
function packageRootName(specifier: string): string {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts.slice(0, 2).join("/");
  }
  return parts[0];
}

/**
 * True for imports that are local files or path aliases we deliberately skip.
 */
function isLocalOrAlias(specifier: string): boolean {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("src/")
  ) {
    return true;
  }
  return false;
}

/**
 * Scan a JS/TS/Angular document for imports that aren't declared in the nearest
 * package.json and aren't Node builtins. Returns Warning diagnostics for each
 * unique missing package.
 */
export function checkNodeFile(document: vscode.TextDocument): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  const filePath = document.uri.fsPath;
  const packageJsonPath = findNearestPackageJson(filePath);

  // No package.json anywhere up the tree — don't guess, avoid false positives.
  if (!packageJsonPath) {
    return diagnostics;
  }

  const declaredDeps = readDependencies(packageJsonPath);
  const text = document.getText();
  const flagged = new Set<string>();

  IMPORT_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_REGEX.exec(text)) !== null) {
    const specifier = match[1] ?? match[2];
    if (!specifier) {
      continue;
    }

    if (isLocalOrAlias(specifier)) {
      continue;
    }

    // Strip "node:" prefix before checking builtins.
    const withoutNodePrefix = specifier.startsWith("node:")
      ? specifier.slice("node:".length)
      : specifier;

    const rootName = packageRootName(withoutNodePrefix);

    if (NODE_BUILTINS.has(rootName)) {
      continue;
    }

    if (declaredDeps.has(rootName)) {
      continue;
    }

    if (flagged.has(rootName)) {
      continue;
    }
    flagged.add(rootName);

    const startIndex = match.index;
    const startPos = document.positionAt(startIndex);
    const endPos = document.positionAt(startIndex + match[0].length);
    const range = new vscode.Range(startPos, endPos);

    const diagnostic = new vscode.Diagnostic(
      range,
      `ImportGuard: "${rootName}" is not listed in package.json. Possible AI-hallucinated package — verify it actually exists before running npm install.`,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = "ImportGuard";
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}
