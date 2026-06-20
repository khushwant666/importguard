import * as vscode from "vscode";
import { checkNodeFile } from "./checkers/node";
import { checkPythonFile } from "./checkers/python";

let diagnosticCollection: vscode.DiagnosticCollection;

const NODE_LANGUAGES = new Set<string>([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);

/**
 * Scan a single document and publish diagnostics. Wrapped so a parse error in
 * one file never crashes the extension. Returns the number of diagnostics found
 * (or 0 if the language is unsupported / an error occurred).
 */
async function scanDocument(document: vscode.TextDocument): Promise<number> {
  try {
    let diagnostics: vscode.Diagnostic[] = [];

    if (NODE_LANGUAGES.has(document.languageId)) {
      diagnostics = checkNodeFile(document);
    } else if (document.languageId === "python") {
      diagnostics = await checkPythonFile(document);
    } else {
      // Unsupported language — skip everything else.
      return 0;
    }

    diagnosticCollection.set(document.uri, diagnostics);
    return diagnostics.length;
  } catch (err) {
    console.error("ImportGuard: failed to scan document", document.uri.fsPath, err);
    return 0;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("importguard");
  context.subscriptions.push(diagnosticCollection);

  // Auto-scan on save (respecting the enableOnSave setting).
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const config = vscode.workspace.getConfiguration("importguard");
      if (config.get<boolean>("enableOnSave", true)) {
        await scanDocument(document);
      }
    })
  );

  // Always scan on open so existing AI-pasted code gets checked immediately
  // without requiring a save.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      await scanDocument(document);
    })
  );

  // Scan currently-open documents on activation.
  for (const document of vscode.workspace.textDocuments) {
    void scanDocument(document);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("importguard.scanFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage(
          "ImportGuard: no active editor to scan."
        );
        return;
      }

      const count = await scanDocument(editor.document);
      if (count > 0) {
        vscode.window.showWarningMessage(
          `ImportGuard: found ${count} possibly hallucinated import${
            count === 1 ? "" : "s"
          } in this file.`
        );
      } else {
        vscode.window.showInformationMessage(
          "ImportGuard: no suspicious imports found in this file."
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("importguard.scanWorkspace", async () => {
      let total = 0;
      for (const document of vscode.workspace.textDocuments) {
        total += await scanDocument(document);
      }

      if (total > 0) {
        vscode.window.showWarningMessage(
          `ImportGuard: found ${total} possibly hallucinated import${
            total === 1 ? "" : "s"
          } across open files.`
        );
      } else {
        vscode.window.showInformationMessage(
          "ImportGuard: no suspicious imports found across open files."
        );
      }
    })
  );
}

export function deactivate(): void {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
