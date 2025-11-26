/**
 * Go-to-Definition Provider for YSH
 *
 * Handles navigation to symbol definitions.
 */

import {
  Definition,
  Location,
  Position,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolTable, SymbolInfo } from './symbols';

export function getDefinition(
  document: TextDocument,
  position: Position,
  symbols: SymbolTable,
): Definition | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Get the word at position
  const word = getWordAtPosition(text, offset);
  if (!word) {
    return null;
  }

  // Remove $ prefix if present (for variable lookups)
  const symbolName = word.startsWith('$') ? word.slice(1) : word;

  // Look up the symbol
  const found = symbols.lookup(symbolName);
  if (found.length === 0) {
    return null;
  }

  // Return the first definition
  const symbol = found[0];
  return Location.create(document.uri, symbol.range);
}

function getWordAtPosition(text: string, offset: number): string | null {
  // Find word boundaries
  let start = offset;
  let end = offset;

  // Move start backwards
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }

  // Include $ prefix for variables
  if (start > 0 && text[start - 1] === '$') {
    start--;
  }

  // Move end forwards
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }

  if (start === end) {
    return null;
  }

  return text.slice(start, end);
}

function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

