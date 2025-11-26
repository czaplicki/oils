/**
 * Symbol Table for YSH
 *
 * Tracks definitions of procedures, functions, variables, and constants
 * for go-to-definition and completion features.
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
}

export class SymbolTable {
  private symbols: Map<string, SymbolInfo[]> = new Map();
  private documentSymbols: DocumentSymbol[] = [];
  private text: string = '';

  buildFromParseResult(result: ParseResult): void {
    this.symbols.clear();
    this.documentSymbols = [];
    this.visitNode(result.tree);
  }

  setText(text: string): void {
    this.text = text;
  }

  private visitNode(node: ASTNode): void {
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
        this.addVariableSymbol(node, 'var');
        break;
      case 'const_declaration':
        this.addVariableSymbol(node, 'const');
        break;
      case 'assignment':
        this.addVariableSymbol(node, 'assignment');
        break;
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        this.visitNode(child);
      }
    }
  }

  private addProcSymbol(node: ASTNode): void {
    if (!node.name) return;

    const range = this.indexToRange(node.startIndex, node.endIndex);
    const selectionRange = this.indexToRange(node.startIndex, node.startIndex + node.name.length + 5);

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
    const selectionRange = this.indexToRange(node.startIndex, node.startIndex + node.name.length + 5);

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
    const selectionRange = this.indexToRange(node.startIndex, node.startIndex + node.name.length);

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

  private addVariableSymbol(node: ASTNode, declarationType: string): void {
    if (!node.name) return;

    const range = this.indexToRange(node.startIndex, node.endIndex);
    const selectionRange = this.indexToRange(node.startIndex, node.startIndex + node.name.length);

    const kind = declarationType === 'const' ? SymbolKind.Constant : SymbolKind.Variable;

    const symbol: SymbolInfo = {
      name: node.name,
      kind,
      range,
      selectionRange,
      detail: declarationType === 'const' ? `const ${node.name}` : `var ${node.name}`,
    };

    this.addSymbol(node.name, symbol);

    // Only add top-level variables to document symbols
    if (declarationType !== 'assignment') {
      const docSymbol: DocumentSymbol = {
        name: node.name,
        kind,
        range,
        selectionRange,
        detail: symbol.detail,
      };
      this.documentSymbols.push(docSymbol);
    }
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
    // Simple conversion assuming text is available
    // In a real implementation, we'd track line/column during parsing
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

  // Find symbol at a given position
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

