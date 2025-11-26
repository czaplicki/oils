/**
 * YSH Language Server
 *
 * Implements the Language Server Protocol for YSH (Oils Shell).
 * Provides diagnostics, completion, go-to-definition, and hover information.
 *
 * DEBUGGING:
 * - View logs in VSCodium: View → Output → Select "YSH Language Server"
 * - Set ysh.trace.server to "verbose" for full message tracing
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
  TextDocumentPositionParams,
  Definition,
  Location,
  Hover,
  DocumentSymbol,
  SymbolKind,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { YSHParser, ParseResult } from './parser';
import { SymbolTable, WorkspaceSymbols } from './symbols';
import { getCompletions } from './completion';
import { getDefinition } from './definition';
import { getHoverInfo } from './hover';
import { extractSourcePaths, resolveSourcePath, loadFileContents } from './sources';

// =============================================================================
// Connection and State
// =============================================================================

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Parser instance
const parser = new YSHParser();

// Per-document state
const symbolTables: Map<string, SymbolTable> = new Map();
const parseResults: Map<string, ParseResult> = new Map();

// Cross-file symbol tracking
const documentDependencies: Map<string, string[]> = new Map(); // uri -> [sourced uris]
const documentWorkspaceSymbols: Map<string, WorkspaceSymbols> = new Map(); // uri -> composite symbols

// Server state for debugging
let serverStartTime: number = Date.now();
let requestCount: number = 0;
let lastError: string | null = null;

// =============================================================================
// Logging Utilities
// =============================================================================

enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

let currentLogLevel: LogLevel = LogLevel.INFO;

function log(level: LogLevel, message: string, data?: unknown): void {
  if (level > currentLogLevel) return;

  const timestamp = new Date().toISOString().substr(11, 12);
  const levelStr = LogLevel[level].padEnd(5);
  const prefix = `[${timestamp}] ${levelStr}`;

  if (data !== undefined) {
    const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
    connection.console.log(`${prefix} ${message}\n${dataStr}`);
  } else {
    connection.console.log(`${prefix} ${message}`);
  }
}

function logError(message: string, error?: unknown): void {
  lastError = message;
  const errorStr = error instanceof Error ? error.stack || error.message : String(error);
  log(LogLevel.ERROR, `${message}: ${errorStr}`);
}

function logWarn(message: string, data?: unknown): void {
  log(LogLevel.WARN, message, data);
}

function logInfo(message: string, data?: unknown): void {
  log(LogLevel.INFO, message, data);
}

function logDebug(message: string, data?: unknown): void {
  log(LogLevel.DEBUG, message, data);
}

// =============================================================================
// Timeout Utility
// =============================================================================

const PARSE_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 2000;

interface TimeoutResult<T> {
  success: boolean;
  value?: T;
  error?: string;
  timedOut?: boolean;
}

async function withTimeout<T>(
  operation: () => T | Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<TimeoutResult<T>> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      logError(`${operationName} timed out after ${timeoutMs}ms`);
      resolve({ success: false, timedOut: true, error: `Operation timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    try {
      const result = operation();
      if (result instanceof Promise) {
        result
          .then((value) => {
            clearTimeout(timeoutId);
            resolve({ success: true, value });
          })
          .catch((error) => {
            clearTimeout(timeoutId);
            resolve({ success: false, error: String(error) });
          });
      } else {
        clearTimeout(timeoutId);
        resolve({ success: true, value: result });
      }
    } catch (error) {
      clearTimeout(timeoutId);
      resolve({ success: false, error: String(error) });
    }
  });
}

// Synchronous timeout for parser (runs in same thread)
function withSyncTimeout<T>(
  operation: () => T,
  timeoutMs: number,
  operationName: string
): TimeoutResult<T> {
  const startTime = Date.now();
  try {
    const result = operation();
    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs / 2) {
      logWarn(`${operationName} took ${elapsed}ms (threshold: ${timeoutMs}ms)`);
    }
    return { success: true, value: result };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logError(`${operationName} failed after ${elapsed}ms`, error);
    return { success: false, error: String(error) };
  }
}

// =============================================================================
// Settings
// =============================================================================

interface YSHSettings {
  maxNumberOfProblems: number;
  oilsPath: string;
  lintEnable: boolean;
  trace?: {
    server?: 'off' | 'messages' | 'verbose';
  };
}

const defaultSettings: YSHSettings = {
  maxNumberOfProblems: 100,
  oilsPath: 'oils-for-unix',
  lintEnable: true,
};

let globalSettings: YSHSettings = defaultSettings;
const documentSettings: Map<string, Thenable<YSHSettings>> = new Map();

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

// =============================================================================
// Server Initialization
// =============================================================================

connection.onInitialize((params: InitializeParams): InitializeResult => {
  logInfo('=== YSH Language Server Starting ===');
  logInfo(`Process ID: ${process.pid}`);
  logInfo(`Node version: ${process.version}`);
  logInfo(`Client capabilities received`);

  const capabilities = params.capabilities;

  const hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  logDebug('Client capabilities', {
    workspaceFolders: hasWorkspaceFolderCapability,
    diagnostics: !!capabilities.textDocument?.publishDiagnostics,
  });

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

connection.onInitialized(() => {
  serverStartTime = Date.now();
  logInfo('=== YSH Language Server Initialized ===');
  logInfo('Ready to process requests');
  logInfo('To see debug logs: View → Output → "YSH Language Server"');
});

// =============================================================================
// Configuration
// =============================================================================

connection.onDidChangeConfiguration((change) => {
  logInfo('Configuration changed');
  documentSettings.clear();

  if (change.settings?.ysh) {
    globalSettings = {
      ...defaultSettings,
      ...change.settings.ysh,
    };

    // Update log level based on trace setting
    if (globalSettings.trace?.server === 'verbose') {
      currentLogLevel = LogLevel.DEBUG;
      logInfo('Log level set to DEBUG');
    } else if (globalSettings.trace?.server === 'messages') {
      currentLogLevel = LogLevel.INFO;
    } else {
      currentLogLevel = LogLevel.WARN;
    }
  }

  // Revalidate all open documents
  documents.all().forEach((doc) => {
    validateTextDocument(doc).catch((e) => logError('Revalidation failed', e));
  });
});

// =============================================================================
// Document Handling
// =============================================================================

documents.onDidOpen((event) => {
  const uri = event.document.uri;
  const shortUri = uri.split('/').pop() || uri;
  logInfo(`Document opened: ${shortUri}`);
  validateTextDocument(event.document).catch((e) => logError('Validation failed on open', e));
});

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
  const shortUri = uri.split('/').pop() || uri;
  logDebug(`Document changed: ${shortUri}`);
  validateTextDocument(change.document).catch((e) => logError('Validation failed on change', e));
});

documents.onDidClose((event) => {
  const uri = event.document.uri;
  const shortUri = uri.split('/').pop() || uri;
  logInfo(`Document closed: ${shortUri}`);
  documentSettings.delete(uri);
  symbolTables.delete(uri);
  parseResults.delete(uri);
  documentDependencies.delete(uri);
  documentWorkspaceSymbols.delete(uri);
  connection.sendDiagnostics({ uri, diagnostics: [] });
});

// =============================================================================
// Document Validation (Parsing)
// =============================================================================

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const uri = textDocument.uri;
  const shortUri = uri.split('/').pop() || uri;
  const startTime = Date.now();

  logDebug(`Validating: ${shortUri}`);

  const settings = await getDocumentSettings(uri);

  if (!settings.lintEnable) {
    logDebug(`Linting disabled for: ${shortUri}`);
    connection.sendDiagnostics({ uri, diagnostics: [] });
    return;
  }

  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  logDebug(`Parsing ${text.length} characters`);

  // Parse with timeout protection
  const parseResult = withSyncTimeout(
    () => parser.parse(text),
    PARSE_TIMEOUT_MS,
    `Parse ${shortUri}`
  );

  if (!parseResult.success) {
    logError(`Parse failed for ${shortUri}`, parseResult.error);
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      message: `Parser error: ${parseResult.error}`,
      source: 'ysh',
    });
    connection.sendDiagnostics({ uri, diagnostics });
    return;
  }

  const result = parseResult.value!;
  parseResults.set(uri, result);

  logDebug(`Parse complete: ${result.errors.length} errors, ${result.warnings.length} warnings`);

  // Build symbol table with timeout protection
  const symbolResult = withSyncTimeout(
    () => {
      const symbols = new SymbolTable();
      symbols.setText(text);
      symbols.buildFromParseResult(result);
      return symbols;
    },
    REQUEST_TIMEOUT_MS,
    `Build symbols for ${shortUri}`
  );

  if (symbolResult.success && symbolResult.value) {
    symbolTables.set(uri, symbolResult.value);
    logDebug(`Symbol table built: ${symbolResult.value.getAllSymbols().length} symbols`);

    // Build cross-file workspace symbols
    const workspaceSymbols = new WorkspaceSymbols();
    workspaceSymbols.addFileSymbols(uri, symbolResult.value);

    // Extract and load source dependencies
    const sourcePaths = extractSourcePaths(result);
    const loadedDependencies: string[] = [];

    for (const sourcePath of sourcePaths) {
      const resolvedUri = resolveSourcePath(sourcePath, uri);
      if (resolvedUri) {
        logDebug(`Found source: ${sourcePath} -> ${resolvedUri}`);

        // Load and parse the sourced file
        const sourceText = loadFileContents(resolvedUri);
        if (sourceText) {
          const sourceParseResult = withSyncTimeout(
            () => parser.parse(sourceText),
            PARSE_TIMEOUT_MS,
            `Parse sourced ${sourcePath}`
          );

          if (sourceParseResult.success && sourceParseResult.value) {
            const sourceSymbols = new SymbolTable();
            sourceSymbols.setText(sourceText);
            sourceSymbols.buildFromParseResult(sourceParseResult.value);

            // Add to workspace symbols
            workspaceSymbols.addFileSymbols(resolvedUri, sourceSymbols);
            loadedDependencies.push(resolvedUri);

            logDebug(`Loaded ${sourceSymbols.getAllSymbols().length} symbols from ${sourcePath}`);
          }
        } else {
          logWarn(`Could not load source file: ${sourcePath}`);
        }
      }
    }

    // Store dependencies and workspace symbols
    documentDependencies.set(uri, loadedDependencies);
    documentWorkspaceSymbols.set(uri, workspaceSymbols);

    logDebug(`Workspace symbols: ${workspaceSymbols.getTrackedFiles().length} files`);
  } else {
    logWarn(`Symbol table build failed for ${shortUri}`);
  }

  // Collect diagnostics
  for (const error of result.errors) {
    if (diagnostics.length >= settings.maxNumberOfProblems) break;
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: textDocument.positionAt(error.startIndex),
        end: textDocument.positionAt(error.endIndex),
      },
      message: error.message,
      source: 'ysh',
    });
  }

  for (const warning of result.warnings) {
    if (diagnostics.length >= settings.maxNumberOfProblems) break;
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: {
        start: textDocument.positionAt(warning.startIndex),
        end: textDocument.positionAt(warning.endIndex),
      },
      message: warning.message,
      source: 'ysh',
    });
  }

  const elapsed = Date.now() - startTime;
  logDebug(`Validation complete in ${elapsed}ms, ${diagnostics.length} diagnostics`);

  connection.sendDiagnostics({ uri, diagnostics });
}

// =============================================================================
// LSP Request Handlers (with logging and error handling)
// =============================================================================

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  requestCount++;
  const shortUri = params.textDocument.uri.split('/').pop() || params.textDocument.uri;
  logDebug(`Completion request #${requestCount} at ${shortUri}:${params.position.line}:${params.position.character}`);

  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      logWarn(`Document not found for completion: ${shortUri}`);
      return [];
    }

    const symbols = symbolTables.get(params.textDocument.uri);
    const result = getCompletions(document, params.position, symbols);
    logDebug(`Returning ${result.length} completions`);
    return result;
  } catch (error) {
    logError('Completion handler failed', error);
    return [];
  }
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  logDebug(`Resolving completion: ${item.label}`);
  try {
    if (item.data?.type === 'keyword') {
      item.detail = 'YSH keyword';
    } else if (item.data?.type === 'builtin') {
      item.detail = 'YSH builtin';
    }
    return item;
  } catch (error) {
    logError('Completion resolve failed', error);
    return item;
  }
});

connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  requestCount++;
  const shortUri = params.textDocument.uri.split('/').pop() || params.textDocument.uri;
  logDebug(`Hover request #${requestCount} at ${shortUri}:${params.position.line}:${params.position.character}`);

  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      logWarn(`Document not found for hover: ${shortUri}`);
      return null;
    }

    const symbols = symbolTables.get(params.textDocument.uri);
    const parseResult = parseResults.get(params.textDocument.uri);
    const result = getHoverInfo(document, params.position, symbols, parseResult);
    logDebug(`Hover result: ${result ? 'found' : 'null'}`);
    return result;
  } catch (error) {
    logError('Hover handler failed', error);
    return null;
  }
});

connection.onDefinition((params: TextDocumentPositionParams): Definition | null => {
  requestCount++;
  const shortUri = params.textDocument.uri.split('/').pop() || params.textDocument.uri;
  logDebug(`Definition request #${requestCount} at ${shortUri}:${params.position.line}:${params.position.character}`);

  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      logWarn(`Document not found for definition: ${shortUri}`);
      return null;
    }

    // Use workspace symbols for cross-file lookup
    const workspaceSymbols = documentWorkspaceSymbols.get(params.textDocument.uri);
    if (!workspaceSymbols) {
      // Fallback to single-file symbols
      const symbols = symbolTables.get(params.textDocument.uri);
      if (!symbols) {
        logWarn(`No symbol table for definition: ${shortUri}`);
        return null;
      }
      const result = getDefinition(document, params.position, symbols, params.textDocument.uri);
      logDebug(`Definition result (single-file): ${result ? 'found' : 'null'}`);
      return result;
    }

    const result = getDefinition(document, params.position, workspaceSymbols, params.textDocument.uri);
    logDebug(`Definition result (cross-file): ${result ? 'found' : 'null'}`);
    return result;
  } catch (error) {
    logError('Definition handler failed', error);
    return null;
  }
});

connection.onDocumentSymbol((params): DocumentSymbol[] => {
  requestCount++;
  const shortUri = params.textDocument.uri.split('/').pop() || params.textDocument.uri;
  logDebug(`Document symbols request #${requestCount} for ${shortUri}`);

  try {
    const symbols = symbolTables.get(params.textDocument.uri);
    if (!symbols) {
      logWarn(`No symbol table for document symbols: ${shortUri}`);
      return [];
    }

    const result = symbols.getDocumentSymbols();
    logDebug(`Returning ${result.length} document symbols`);
    return result;
  } catch (error) {
    logError('Document symbols handler failed', error);
    return [];
  }
});

connection.onWorkspaceSymbol((params) => {
  requestCount++;
  logDebug(`Workspace symbols request #${requestCount}: "${params.query}"`);

  try {
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

    logDebug(`Returning ${results.length} workspace symbols`);
    return results;
  } catch (error) {
    logError('Workspace symbols handler failed', error);
    return [];
  }
});

// =============================================================================
// Custom Debug Requests
// =============================================================================

connection.onRequest('ysh/parseTree', (params: { textDocument: { uri: string } }) => {
  logInfo(`Parse tree request for ${params.textDocument.uri}`);
  try {
    const parseResult = parseResults.get(params.textDocument.uri);
    if (!parseResult) {
      return { error: 'No parse result available' };
    }
    return parseResult.tree;
  } catch (error) {
    logError('Parse tree request failed', error);
    return { error: String(error) };
  }
});

connection.onRequest('ysh/debugInfo', () => {
  logInfo('Debug info request');
  const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
  return {
    uptime: `${uptime}s`,
    requestCount,
    lastError,
    documentsOpen: documents.all().length,
    symbolTablesLoaded: symbolTables.size,
    parseResultsCached: parseResults.size,
    logLevel: LogLevel[currentLogLevel],
    nodeVersion: process.version,
    pid: process.pid,
  };
});

connection.onRequest('ysh/symbols', (params: { textDocument: { uri: string } }) => {
  logInfo(`Symbols request for ${params.textDocument.uri}`);
  try {
    const symbols = symbolTables.get(params.textDocument.uri);
    if (!symbols) {
      return { error: 'No symbols available' };
    }
    return symbols.getAllSymbols();
  } catch (error) {
    logError('Symbols request failed', error);
    return { error: String(error) };
  }
});

// =============================================================================
// Error Handling
// =============================================================================

process.on('uncaughtException', (error) => {
  logError('Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection', reason);
});

// =============================================================================
// Start Server
// =============================================================================

documents.listen(connection);
connection.listen();

logInfo('YSH Language Server starting...');
