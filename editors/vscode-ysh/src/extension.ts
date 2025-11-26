/**
 * YSH Language Extension for VS Code
 *
 * Provides language support for YSH (Oils Shell) including:
 * - Syntax highlighting (via TextMate grammar)
 * - Language Server Protocol features (diagnostics, go-to-definition, etc.)
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('YSH Language Extension is now active');

  // Check if YSH features are enabled
  const config = vscode.workspace.getConfiguration('ysh');
  if (!config.get<boolean>('enable', true)) {
    console.log('YSH features are disabled');
    return;
  }

  // Start the language server
  startLanguageServer(context);

  // Register commands
  registerCommands(context);
}

function startLanguageServer(context: vscode.ExtensionContext): void {
  // Path to the server module
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  // Debug options for the server
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  // Server options - run the server as a Node.js module
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for YSH and OSH documents
    documentSelector: [
      { scheme: 'file', language: 'ysh' },
      { scheme: 'file', language: 'osh' },
      { scheme: 'untitled', language: 'ysh' },
      { scheme: 'untitled', language: 'osh' },
    ],
    synchronize: {
      // Notify the server about file changes to relevant files in the workspace
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.ysh'),
        vscode.workspace.createFileSystemWatcher('**/*.osh'),
      ],
    },
    outputChannelName: 'YSH Language Server',
    traceOutputChannel: vscode.window.createOutputChannel('YSH Language Server Trace'),
  };

  // Create the language client and start it
  client = new LanguageClient(
    'yshLanguageServer',
    'YSH Language Server',
    serverOptions,
    clientOptions
  );

  // Start the client (this also starts the server)
  client.start();

  console.log('YSH Language Server started');
}

function registerCommands(context: vscode.ExtensionContext): void {
  // Command to restart the language server
  const restartServerCommand = vscode.commands.registerCommand(
    'ysh.restartServer',
    async () => {
      if (client) {
        await client.stop();
      }
      startLanguageServer(context);
      vscode.window.showInformationMessage('YSH Language Server restarted');
    }
  );
  context.subscriptions.push(restartServerCommand);

  // Command to show the parse tree (for debugging)
  const showParseTreeCommand = vscode.commands.registerCommand(
    'ysh.showParseTree',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      if (editor.document.languageId !== 'ysh' && editor.document.languageId !== 'osh') {
        vscode.window.showErrorMessage('Not a YSH/OSH file');
        return;
      }

      if (client) {
        try {
          const result = await client.sendRequest('ysh/parseTree', {
            textDocument: { uri: editor.document.uri.toString() },
          });

          // Show the parse tree in a new document
          const doc = await vscode.workspace.openTextDocument({
            content: JSON.stringify(result, null, 2),
            language: 'json',
          });
          await vscode.window.showTextDocument(doc, { preview: true });
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to get parse tree: ${error}`);
        }
      }
    }
  );
  context.subscriptions.push(showParseTreeCommand);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

