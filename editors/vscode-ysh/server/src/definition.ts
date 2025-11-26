/**
 * Go-to-Definition Provider for YSH
 *
 * Handles navigation to symbol definitions, including:
 * - Cross-file definitions (via source statements)
 * - Variables in strings ($var, $[expr])
 * - Dict property navigation (CONFIG.key)
 */

import {
  Definition,
  Location,
  Position,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolTable, WorkspaceSymbols, SymbolInfo } from './symbols';

/**
 * Get definition for the symbol at the given position.
 *
 * Supports both single-file (SymbolTable) and cross-file (WorkspaceSymbols) lookup.
 */
export function getDefinition(
  document: TextDocument,
  position: Position,
  symbols: SymbolTable | WorkspaceSymbols,
  currentUri?: string,
): Definition | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const uri = currentUri || document.uri;

  // Get the word at position, including context for property access
  const context = getWordContext(text, offset);
  if (!context) {
    return null;
  }

  // Handle property access (e.g., CONFIG.instance_name)
  if (context.property && symbols instanceof WorkspaceSymbols) {
    const dictKeyResult = symbols.lookupDictKey(context.base, context.property);
    if (dictKeyResult) {
      return Location.create(dictKeyResult.uri, dictKeyResult.range);
    }
  }

  // Regular symbol lookup
  const symbolName = context.base;

  if (symbols instanceof WorkspaceSymbols) {
    // Cross-file lookup with priority for current document
    const results = symbols.lookupWithPriority(symbolName, uri);
    if (results.length > 0) {
      return Location.create(results[0].uri, results[0].symbol.range);
    }
  } else {
    // Single-file lookup
    const found = symbols.lookup(symbolName);
    if (found.length > 0) {
      return Location.create(uri, found[0].range);
    }
  }

  return null;
}

interface WordContext {
  /** The main symbol name (e.g., "CONFIG" in CONFIG.foo or $CONFIG) */
  base: string;
  /** The property name if this is a property access (e.g., "foo" in CONFIG.foo) */
  property?: string;
  /** Full text including any prefix like $ */
  fullText: string;
}

/**
 * Extract word and context at position.
 *
 * Handles:
 * - Simple words: foo
 * - Variables: $foo, ${foo}
 * - Expression substitution: $[foo], $[CONFIG.bar]
 * - Property access: CONFIG.foo
 */
function getWordContext(text: string, offset: number): WordContext | null {
  // First, find the basic word at position
  let start = offset;
  let end = offset;

  // Move start backwards through word characters
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }

  // Move end forwards through word characters
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }

  if (start === end) {
    return null;
  }

  const word = text.slice(start, end);

  // Check for property access context
  // Look backwards to see if there's a base.property pattern
  let base = word;
  let property: string | undefined;

  // Check if cursor is on property part of base.property
  if (start > 0 && text[start - 1] === '.') {
    // We're on the property, find the base
    let baseEnd = start - 1;
    let baseStart = baseEnd;
    while (baseStart > 0 && isWordChar(text[baseStart - 1])) {
      baseStart--;
    }
    if (baseStart < baseEnd) {
      base = text.slice(baseStart, baseEnd);
      property = word;
    }
  }

  // Check if there's a property after the word
  if (!property && end < text.length && text[end] === '.') {
    let propStart = end + 1;
    let propEnd = propStart;
    while (propEnd < text.length && isWordChar(text[propEnd])) {
      propEnd++;
    }
    // Don't set property here - user is on base, not property
    // But if we're exactly at the dot, property might be targeted
  }

  // Check for $ prefix (variable reference)
  let fullText = word;
  if (start > 0) {
    // Check for $word, ${word}, $[word]
    const prevChar = text[start - 1];
    if (prevChar === '$') {
      fullText = '$' + word;
      // Remove $ from base if present
      if (base.startsWith('$')) {
        base = base.slice(1);
      }
    } else if (prevChar === '[' && start > 1 && text[start - 2] === '$') {
      // Inside $[...] expression substitution
      fullText = word;
    } else if (prevChar === '{' && start > 1 && text[start - 2] === '$') {
      // Inside ${...} variable expansion
      fullText = word;
    }
  }

  return { base, property, fullText };
}

/**
 * Check if character is a word character (identifier)
 */
function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

/**
 * Get word at position (simple version for external use)
 */
export function getWordAtPosition(text: string, offset: number): string | null {
  const context = getWordContext(text, offset);
  return context ? context.fullText : null;
}
