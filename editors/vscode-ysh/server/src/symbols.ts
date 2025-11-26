/**
 * Symbol Table for YSH
 *
 * Tracks definitions of procedures, functions, variables, and constants
 * at ALL nesting levels for go-to-definition and completion features.
 *
 * Handles:
 * - proc/func definitions
 * - var/const declarations
 * - setvar/setglobal statements (treated as variable definitions)
 * - Shell function definitions
 * - Nested scopes (variables inside while/if/for/try blocks)
 */

import {
  DocumentSymbol,
  SymbolKind,
  Range,
  Position,
} from 'vscode-languageserver/node';

import { ASTNode, ParseResult } from './parser';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  detail?: string;
  children?: SymbolInfo[];
  params?: string[];
  type?: string;
  // For dict/object constants, track key locations
  dictKeys?: Map<string, Range>;
}

/**
 * Result of a cross-file symbol lookup
 */
export interface SymbolLookupResult {
  symbol: SymbolInfo;
  uri: string;
}

/**
 * Workspace-wide symbol table that aggregates symbols from multiple files.
 * Used for cross-file go-to-definition.
 */
export class WorkspaceSymbols {
  private perFileSymbols: Map<string, SymbolTable> = new Map();

  /**
   * Add or update symbols for a file.
   */
  addFileSymbols(uri: string, symbols: SymbolTable): void {
    this.perFileSymbols.set(uri, symbols);
  }

  /**
   * Remove symbols for a file.
   */
  removeFileSymbols(uri: string): void {
    this.perFileSymbols.delete(uri);
  }

  /**
   * Get symbols for a specific file.
   */
  getFileSymbols(uri: string): SymbolTable | undefined {
    return this.perFileSymbols.get(uri);
  }

  /**
   * Lookup a symbol across all files.
   * Returns the symbol and the URI of the file it was found in.
   */
  lookupWithUri(name: string): SymbolLookupResult[] {
    const results: SymbolLookupResult[] = [];

    for (const [uri, symbols] of this.perFileSymbols) {
      const found = symbols.lookup(name);
      for (const symbol of found) {
        results.push({ symbol, uri });
      }
    }

    return results;
  }

  /**
   * Lookup a symbol, prioritizing the current document.
   * Falls back to other files if not found in current.
   */
  lookupWithPriority(name: string, currentUri: string): SymbolLookupResult[] {
    const results: SymbolLookupResult[] = [];

    // First check current document
    const currentSymbols = this.perFileSymbols.get(currentUri);
    if (currentSymbols) {
      const found = currentSymbols.lookup(name);
      for (const symbol of found) {
        results.push({ symbol, uri: currentUri });
      }
    }

    // If not found, check other files
    if (results.length === 0) {
      for (const [uri, symbols] of this.perFileSymbols) {
        if (uri === currentUri) continue;
        const found = symbols.lookup(name);
        for (const symbol of found) {
          results.push({ symbol, uri });
        }
      }
    }

    return results;
  }

  /**
   * Get all files tracked by this workspace.
   */
  getTrackedFiles(): string[] {
    return Array.from(this.perFileSymbols.keys());
  }

  /**
   * Lookup a dict key across all files.
   * For expressions like CONFIG.instance_name, finds where 'instance_name' is defined.
   *
   * @param symbolName - The base symbol name (e.g., "CONFIG")
   * @param keyName - The dict key name (e.g., "instance_name")
   * @returns The range and URI if found
   */
  lookupDictKey(symbolName: string, keyName: string): { range: Range; uri: string } | undefined {
    for (const [uri, symbols] of this.perFileSymbols) {
      const range = symbols.lookupDictKey(symbolName, keyName);
      if (range) {
        return { range, uri };
      }
    }
    return undefined;
  }

  /**
   * Clear all symbols.
   */
  clear(): void {
    this.perFileSymbols.clear();
  }
}

export class SymbolTable {
  private symbols: Map<string, SymbolInfo[]> = new Map();
  private documentSymbols: DocumentSymbol[] = [];
  private text: string = '';

  buildFromParseResult(result: ParseResult): void {
    this.symbols.clear();
    this.documentSymbols = [];
    this.visitNode(result.tree, true);
  }

  setText(text: string): void {
    this.text = text;
  }

  private visitNode(node: ASTNode, isTopLevel: boolean = false): void {
    switch (node.type) {
      case 'proc_definition':
        this.addProcSymbol(node);
        break;
      case 'func_definition':
        this.addFuncSymbol(node);
        break;
      case 'function_definition':
        this.addShellFunctionSymbol(node);
        break;
      case 'var_declaration':
        this.addVariableSymbol(node, 'var', isTopLevel);
        break;
      case 'const_declaration':
        this.addVariableSymbol(node, 'const', isTopLevel);
        break;
      case 'setvar':
        this.addVariableSymbol(node, 'setvar', false);
        break;
      case 'setglobal':
        this.addVariableSymbol(node, 'setglobal', isTopLevel);
        break;
      case 'assignment':
        this.addVariableSymbol(node, 'assignment', false);
        break;
      case 'for_statement':
        // For loop variable
        if (node.name) {
          this.addForLoopVariable(node);
        }
        break;
    }

    // Recurse into children - nested blocks are not top-level
    if (node.children) {
      const childIsTopLevel = node.type === 'program';
      for (const child of node.children) {
        this.visitNode(child, childIsTopLevel);
      }
    }
  }

  private addProcSymbol(node: ASTNode): void {
    if (!node.name) return;

    const range = this.indexToRange(node.startIndex, node.endIndex);
    const nameStart = this.findNameStart(node.startIndex, node.name);
    const selectionRange = this.indexToRange(nameStart, nameStart + node.name.length);

    const symbol: SymbolInfo = {
      name: node.name,
      kind: SymbolKind.Function,
      range,
      selectionRange,
      detail: `proc ${node.name}(${node.params?.join(', ') || ''})`,
      params: node.params,
    };

    this.addSymbol(node.name, symbol);

    const docSymbol: DocumentSymbol = {
      name: node.name,
      kind: SymbolKind.Function,
      range,
      selectionRange,
      detail: symbol.detail,
    };
    this.documentSymbols.push(docSymbol);
  }

  private addFuncSymbol(node: ASTNode): void {
    if (!node.name) return;

    const range = this.indexToRange(node.startIndex, node.endIndex);
    const nameStart = this.findNameStart(node.startIndex, node.name);
    const selectionRange = this.indexToRange(nameStart, nameStart + node.name.length);

    const symbol: SymbolInfo = {
      name: node.name,
      kind: SymbolKind.Function,
      range,
      selectionRange,
      detail: `func ${node.name}(${node.params?.join(', ') || ''})`,
      params: node.params,
    };

    this.addSymbol(node.name, symbol);

    const docSymbol: DocumentSymbol = {
      name: node.name,
      kind: SymbolKind.Function,
      range,
      selectionRange,
      detail: symbol.detail,
    };
    this.documentSymbols.push(docSymbol);
  }

  private addShellFunctionSymbol(node: ASTNode): void {
    if (!node.name) return;

    const range = this.indexToRange(node.startIndex, node.endIndex);
    const nameStart = this.findNameStart(node.startIndex, node.name);
    const selectionRange = this.indexToRange(nameStart, nameStart + node.name.length);

    const symbol: SymbolInfo = {
      name: node.name,
      kind: SymbolKind.Function,
      range,
      selectionRange,
      detail: `function ${node.name}`,
    };

    this.addSymbol(node.name, symbol);

    const docSymbol: DocumentSymbol = {
      name: node.name,
      kind: SymbolKind.Function,
      range,
      selectionRange,
      detail: symbol.detail,
    };
    this.documentSymbols.push(docSymbol);
  }

  private addVariableSymbol(node: ASTNode, declarationType: string, addToDocSymbols: boolean): void {
    if (!node.name) return;

    const range = this.indexToRange(node.startIndex, node.endIndex);
    const nameStart = this.findNameStart(node.startIndex, node.name);
    const selectionRange = this.indexToRange(nameStart, nameStart + node.name.length);

    const kind = declarationType === 'const' ? SymbolKind.Constant : SymbolKind.Variable;

    let detail: string;
    switch (declarationType) {
      case 'const': detail = `const ${node.name}`; break;
      case 'var': detail = `var ${node.name}`; break;
      case 'setvar': detail = `setvar ${node.name}`; break;
      case 'setglobal': detail = `setglobal ${node.name}`; break;
      default: detail = node.name;
    }

    const symbol: SymbolInfo = {
      name: node.name,
      kind,
      range,
      selectionRange,
      detail,
    };

    // For const declarations, try to extract dict keys
    if (declarationType === 'const') {
      const dictKeys = this.extractDictKeys(node);
      if (dictKeys.size > 0) {
        symbol.dictKeys = dictKeys;
      }
    }

    this.addSymbol(node.name, symbol);

    // Add to document symbols if it's a significant declaration
    if (addToDocSymbols && (declarationType === 'var' || declarationType === 'const' || declarationType === 'setglobal')) {
      const docSymbol: DocumentSymbol = {
        name: node.name,
        kind,
        range,
        selectionRange,
        detail,
      };
      this.documentSymbols.push(docSymbol);
    }
  }

  /**
   * Extract dict key locations from a const declaration.
   * Parses the source text to find key: value patterns.
   */
  private extractDictKeys(node: ASTNode): Map<string, Range> {
    const keys = new Map<string, Range>();

    // Get the text for this node
    const nodeText = this.text.slice(node.startIndex, node.endIndex);

    // Find dict literal pattern: { key: value, ... }
    // Look for key: patterns (not inside strings)
    const keyPattern = /^\s*(\w+)\s*:/gm;
    let match;

    while ((match = keyPattern.exec(nodeText)) !== null) {
      const keyName = match[1];
      const keyStartInNode = match.index + match[0].indexOf(keyName);
      const keyStart = node.startIndex + keyStartInNode;
      const keyEnd = keyStart + keyName.length;

      keys.set(keyName, this.indexToRange(keyStart, keyEnd));
    }

    return keys;
  }

  private addForLoopVariable(node: ASTNode): void {
    if (!node.name) return;

    const range = this.indexToRange(node.startIndex, node.endIndex);
    const nameStart = this.findNameStart(node.startIndex, node.name);
    const selectionRange = this.indexToRange(nameStart, nameStart + node.name.length);

    const symbol: SymbolInfo = {
      name: node.name,
      kind: SymbolKind.Variable,
      range,
      selectionRange,
      detail: `for ${node.name}`,
    };

    this.addSymbol(node.name, symbol);
  }

  private findNameStart(startIndex: number, name: string): number {
    // Try to find the actual position of the name in the text
    const searchStart = startIndex;
    const searchEnd = Math.min(startIndex + 100, this.text.length);
    const searchText = this.text.slice(searchStart, searchEnd);

    // Look for the name after keywords
    const patterns = [
      new RegExp(`\\b(proc|func|function|var|const|setvar|setglobal|for)\\s+${this.escapeRegExp(name)}\\b`),
      new RegExp(`\\b${this.escapeRegExp(name)}\\s*=`),
    ];

    for (const pattern of patterns) {
      const match = searchText.match(pattern);
      if (match && match.index !== undefined) {
        // Find the actual start of the name within the match
        const matchStart = searchStart + match.index;
        const nameInMatch = this.text.indexOf(name, matchStart);
        if (nameInMatch !== -1 && nameInMatch < matchStart + match[0].length) {
          return nameInMatch;
        }
      }
    }

    return startIndex;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private addSymbol(name: string, symbol: SymbolInfo): void {
    const existing = this.symbols.get(name);
    if (existing) {
      existing.push(symbol);
    } else {
      this.symbols.set(name, [symbol]);
    }
  }

  private indexToRange(startIndex: number, endIndex: number): Range {
    const startLine = this.getLineFromIndex(startIndex);
    const endLine = this.getLineFromIndex(endIndex);
    const startChar = this.getColumnFromIndex(startIndex);
    const endChar = this.getColumnFromIndex(endIndex);

    return {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    };
  }

  private getLineFromIndex(index: number): number {
    let line = 0;
    for (let i = 0; i < index && i < this.text.length; i++) {
      if (this.text[i] === '\n') {
        line++;
      }
    }
    return line;
  }

  private getColumnFromIndex(index: number): number {
    let column = 0;
    for (let i = index - 1; i >= 0; i--) {
      if (this.text[i] === '\n') {
        break;
      }
      column++;
    }
    return column;
  }

  // Public API

  lookup(name: string): SymbolInfo[] {
    return this.symbols.get(name) || [];
  }

  getDocumentSymbols(): DocumentSymbol[] {
    return this.documentSymbols;
  }

  getAllSymbols(): SymbolInfo[] {
    const all: SymbolInfo[] = [];
    for (const symbols of this.symbols.values()) {
      all.push(...symbols);
    }
    return all;
  }

  getSymbolsOfKind(kind: SymbolKind): SymbolInfo[] {
    const result: SymbolInfo[] = [];
    for (const symbols of this.symbols.values()) {
      for (const symbol of symbols) {
        if (symbol.kind === kind) {
          result.push(symbol);
        }
      }
    }
    return result;
  }

  getFunctions(): SymbolInfo[] {
    return this.getSymbolsOfKind(SymbolKind.Function);
  }

  getVariables(): SymbolInfo[] {
    return [
      ...this.getSymbolsOfKind(SymbolKind.Variable),
      ...this.getSymbolsOfKind(SymbolKind.Constant),
    ];
  }

  getSymbolAtPosition(line: number, character: number): SymbolInfo | undefined {
    for (const symbols of this.symbols.values()) {
      for (const symbol of symbols) {
        if (this.positionInRange({ line, character }, symbol.range)) {
          return symbol;
        }
      }
    }
    return undefined;
  }

  /**
   * Lookup a dict key within a symbol.
   * For expressions like CONFIG.instance_name, looks up 'instance_name' in CONFIG's dict keys.
   *
   * @param symbolName - The base symbol name (e.g., "CONFIG")
   * @param keyName - The dict key name (e.g., "instance_name")
   * @returns The range of the key definition, or undefined if not found
   */
  lookupDictKey(symbolName: string, keyName: string): Range | undefined {
    const symbols = this.symbols.get(symbolName);
    if (!symbols) return undefined;

    for (const symbol of symbols) {
      if (symbol.dictKeys) {
        const keyRange = symbol.dictKeys.get(keyName);
        if (keyRange) return keyRange;
      }
    }

    return undefined;
  }

  private positionInRange(position: Position, range: Range): boolean {
    const { line, character } = position;
    const { start, end } = range;

    if (line < start.line || line > end.line) {
      return false;
    }

    if (line === start.line && character < start.character) {
      return false;
    }

    if (line === end.line && character > end.character) {
      return false;
    }

    return true;
  }
}
