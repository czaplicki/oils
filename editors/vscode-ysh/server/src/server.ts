/**
 * YSH Language Server
 *
 * Implements the Language Server Protocol for YSH (Oils Shell).
 * Provides diagnostics, completion, go-to-definition, and hover information.
 */

import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  Definition,
  Location,
  Hover,
  MarkupKind,
  Range,
  Position,
  DocumentSymbol,
  SymbolKind,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { YSHParser, ParseResult } from './parser';
import { SymbolTable, SymbolInfo } from './symbols';
import { getCompletions } from './completion';
import { getDefinition } from './definition';
import { getHoverInfo } from './hover';

// Create a connection for the server using Node's IPC transport
const connection = createConnection(ProposedFeatures.all);

// Create a text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Parser instance
const parser = new YSHParser();

// Symbol tables per document
const symbolTables: Map<string, SymbolTable> = new Map();

// Parse results per document
const parseResults: Map<string, ParseResult> = new Map();

// Server settings
interface YSHSettings {
  maxNumberOfProblems: number;
  oilsPath: string;
  lintEnable: boolean;
}

const defaultSettings: YSHSettings = {
  maxNumberOfProblems: 100,
  oilsPath: 'oils-for-unix',
  lintEnable: true,
};

let globalSettings: YSHSettings = defaultSettings;
const documentSettings: Map<string, Thenable<YSHSettings>> = new Map();

// Initialize the server
connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;

  const hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  const hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['$', '.', '-', '@', '{', '['],
      },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
});

// After initialization
connection.onInitialized(() => {
  connection.console.log('YSH Language Server initialized');
});

// Handle configuration changes
connection.onDidChangeConfiguration((change) => {
  documentSettings.clear();

  if (change.settings?.ysh) {
    globalSettings = {
      ...defaultSettings,
      ...change.settings.ysh,
    };
  }

  // Revalidate all open documents
  documents.all().forEach(validateTextDocument);
});

// Get document settings
function getDocumentSettings(resource: string): Thenable<YSHSettings> {
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'ysh',
    }).then((config) => ({
      ...defaultSettings,
      ...config,
    }));
    documentSettings.set(resource, result);
  }
  return result;
}

// Document lifecycle handlers
documents.onDidOpen((event) => {
  validateTextDocument(event.document);
});

documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

documents.onDidClose((event) => {
  documentSettings.delete(event.document.uri);
  symbolTables.delete(event.document.uri);
  parseResults.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Validate a text document and send diagnostics
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(textDocument.uri);

  if (!settings.lintEnable) {
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    return;
  }

  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  try {
    // Parse the document
    const result = parser.parse(text);
    parseResults.set(textDocument.uri, result);

    // Build symbol table
    const symbols = new SymbolTable();
    symbols.buildFromParseResult(result);
    symbolTables.set(textDocument.uri, symbols);

    // Collect parse errors as diagnostics
    for (const error of result.errors) {
      if (diagnostics.length >= settings.maxNumberOfProblems) {
        break;
      }

      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: {
          start: textDocument.positionAt(error.startIndex),
          end: textDocument.positionAt(error.endIndex),
        },
        message: error.message,
        source: 'ysh',
      };

      diagnostics.push(diagnostic);
    }

    // Add warnings
    for (const warning of result.warnings) {
      if (diagnostics.length >= settings.maxNumberOfProblems) {
        break;
      }

      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Warning,
        range: {
          start: textDocument.positionAt(warning.startIndex),
          end: textDocument.positionAt(warning.endIndex),
        },
        message: warning.message,
        source: 'ysh',
      };

      diagnostics.push(diagnostic);
    }
  } catch (e) {
    connection.console.error(`Parse error: ${e}`);

    // Add a generic error diagnostic
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      message: `Failed to parse document: ${e}`,
      source: 'ysh',
    });
  }

  // Send the computed diagnostics to VS Code
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// Completion handler
connection.onCompletion(
  (params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const symbols = symbolTables.get(params.textDocument.uri);
    return getCompletions(document, params.position, symbols);
  }
);

// Completion item resolve handler
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  // Add additional documentation for completion items if needed
  if (item.data?.type === 'keyword') {
    item.detail = 'YSH keyword';
  } else if (item.data?.type === 'builtin') {
    item.detail = 'YSH builtin';
  }
  return item;
});

// Hover handler
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const symbols = symbolTables.get(params.textDocument.uri);
  const parseResult = parseResults.get(params.textDocument.uri);
  return getHoverInfo(document, params.position, symbols, parseResult);
});

// Go-to-definition handler
connection.onDefinition(
  (params: TextDocumentPositionParams): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const symbols = symbolTables.get(params.textDocument.uri);
    if (!symbols) {
      return null;
    }

    return getDefinition(document, params.position, symbols);
  }
);

// Document symbols handler
connection.onDocumentSymbol(
  (params): DocumentSymbol[] => {
    const symbols = symbolTables.get(params.textDocument.uri);
    if (!symbols) {
      return [];
    }

    return symbols.getDocumentSymbols();
  }
);

// Workspace symbols handler
connection.onWorkspaceSymbol(
  (params) => {
    const query = params.query.toLowerCase();
    const results: Array<{
      name: string;
      kind: SymbolKind;
      location: Location;
    }> = [];

    for (const [uri, symbols] of symbolTables) {
      for (const symbol of symbols.getDocumentSymbols()) {
        if (symbol.name.toLowerCase().includes(query)) {
          results.push({
            name: symbol.name,
            kind: symbol.kind,
            location: Location.create(uri, symbol.range),
          });
        }
      }
    }

    return results;
  }
);

// Custom request handler for parse tree (debugging)
connection.onRequest('ysh/parseTree', (params: { textDocument: { uri: string } }) => {
  const parseResult = parseResults.get(params.textDocument.uri);
  if (!parseResult) {
    return { error: 'No parse result available' };
  }
  return parseResult.tree;
});

// Listen on the documents and connection
documents.listen(connection);
connection.listen();

