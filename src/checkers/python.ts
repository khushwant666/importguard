import { exec } from "child_process";
import * as vscode from "vscode";

/**
 * Common Python standard library modules. Always valid, never checked against
 * the interpreter.
 */
const PYTHON_STDLIB = new Set<string>([
  "abc",
  "argparse",
  "ast",
  "asyncio",
  "base64",
  "binascii",
  "bisect",
  "builtins",
  "calendar",
  "collections",
  "concurrent",
  "configparser",
  "contextlib",
  "copy",
  "csv",
  "ctypes",
  "dataclasses",
  "datetime",
  "decimal",
  "difflib",
  "dis",
  "enum",
  "errno",
  "functools",
  "gc",
  "getpass",
  "glob",
  "gzip",
  "hashlib",
  "heapq",
  "hmac",
  "html",
  "http",
  "importlib",
  "inspect",
  "io",
  "itertools",
  "json",
  "logging",
  "math",
  "multiprocessing",
  "operator",
  "os",
  "pathlib",
  "pickle",
  "platform",
  "pprint",
  "queue",
  "random",
  "re",
  "secrets",
  "select",
  "shutil",
  "signal",
  "socket",
  "sqlite3",
  "ssl",
  "stat",
  "string",
  "struct",
  "subprocess",
  "sys",
  "tempfile",
  "textwrap",
  "threading",
  "time",
  "timeit",
  "traceback",
  "types",
  "typing",
  "unittest",
  "urllib",
  "uuid",
  "warnings",
  "weakref",
  "xml",
  "zipfile",
  "zlib",
]);

/**
 * "from X import Y" — capture the module path X.
 */
const FROM_IMPORT_REGEX = /^\s*from\s+([a-zA-Z0-9_\.]+)\s+import\s+.+$/gm;

/**
 * "import X, Y, Z" — capture the whole comma-separated list.
 *
 * NOTE: These are intentionally TWO separate regexes run as two separate exec
 * loops. A single combined regex with alternation and a greedy multi-name
 * capture group swallows multiple lines together because the import-list
 * character class does not stop at line boundaries.
 */
const PLAIN_IMPORT_REGEX = /^\s*import\s+([a-zA-Z0-9_\.,\s]+?)\s*(?:#.*)?$/gm;

/**
 * In-memory cache of interpreter checks keyed by "pythonPath::moduleName".
 * Shelling out is slow and the same imports get re-checked across saves.
 */
const moduleExistsCache = new Map<string, boolean>();

function topLevelModule(name: string): string {
  return name.split(".")[0].trim();
}

/**
 * Verify a module exists in the configured environment by shelling out to the
 * interpreter. Result is cached per (pythonPath, moduleName).
 */
function moduleExists(pythonPath: string, moduleName: string): Promise<boolean> {
  const cacheKey = `${pythonPath}::${moduleName}`;
  const cached = moduleExistsCache.get(cacheKey);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  return new Promise<boolean>((resolve) => {
    const script = `import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('${moduleName}') else 1)`;
    exec(
      `${pythonPath} -c "${script}"`,
      { timeout: 4000 },
      (error) => {
        // exit code 0 (no error) => module exists. Any error (non-zero exit,
        // timeout, interpreter missing) => treat as not found.
        const exists = !error;
        moduleExistsCache.set(cacheKey, exists);
        resolve(exists);
      }
    );
  });
}

interface DetectedImport {
  name: string;
  matchStart: number;
  matchLength: number;
}

/**
 * Pull every imported top-level module name from the document, along with the
 * location of the matching statement for diagnostic ranges.
 */
function detectImports(text: string): DetectedImport[] {
  const results: DetectedImport[] = [];

  FROM_IMPORT_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FROM_IMPORT_REGEX.exec(text)) !== null) {
    const moduleName = topLevelModule(match[1]);
    if (moduleName) {
      results.push({
        name: moduleName,
        matchStart: match.index,
        matchLength: match[0].length,
      });
    }
  }

  PLAIN_IMPORT_REGEX.lastIndex = 0;
  while ((match = PLAIN_IMPORT_REGEX.exec(text)) !== null) {
    const list = match[1];
    for (const rawName of list.split(",")) {
      // Strip "as alias" suffix, then take the top-level module name.
      const withoutAlias = rawName.split(/\s+as\s+/)[0];
      const moduleName = topLevelModule(withoutAlias);
      if (moduleName) {
        results.push({
          name: moduleName,
          matchStart: match.index,
          matchLength: match[0].length,
        });
      }
    }
  }

  return results;
}

/**
 * Scan a Python document for imports that aren't stdlib and can't be found by
 * the configured interpreter. Returns Warning diagnostics for each.
 */
export async function checkPythonFile(
  document: vscode.TextDocument
): Promise<vscode.Diagnostic[]> {
  const diagnostics: vscode.Diagnostic[] = [];

  const config = vscode.workspace.getConfiguration("importguard");
  const pythonPath = config.get<string>("pythonPath", "python3");

  const text = document.getText();
  const imports = detectImports(text);

  for (const imp of imports) {
    if (PYTHON_STDLIB.has(imp.name)) {
      continue;
    }

    const exists = await moduleExists(pythonPath, imp.name);
    if (exists) {
      continue;
    }

    const startPos = document.positionAt(imp.matchStart);
    const endPos = document.positionAt(imp.matchStart + imp.matchLength);
    const range = new vscode.Range(startPos, endPos);

    const diagnostic = new vscode.Diagnostic(
      range,
      `ImportGuard: module "${imp.name}" not found in the active Python environment (${pythonPath}). Possible AI-hallucinated package — verify it's a real PyPI package before pip installing.`,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = "ImportGuard";
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}
