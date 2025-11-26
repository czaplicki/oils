/**
 * Completion Provider for YSH
 *
 * Provides intelligent code completion for YSH files.
 */

import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolTable, SymbolInfo } from './symbols';

// YSH keywords
const YSH_KEYWORDS = [
  'var', 'const', 'setvar', 'setglobal',
  'proc', 'func', 'typed',
  'call', 'return', 'break', 'continue', 'exit',
  'if', 'then', 'else', 'elif', 'fi',
  'for', 'in', 'do', 'done',
  'while', 'until',
  'case', 'esac',
  'and', 'or', 'not',
  'true', 'false', 'null',
];

// YSH builtins
const YSH_BUILTINS = [
  // I/O
  'echo', 'printf', 'read', 'write',
  // File operations
  'cd', 'pwd', 'pushd', 'popd', 'dirs',
  'mkdir', 'rmdir', 'cp', 'mv', 'rm', 'touch',
  'ls', 'cat', 'head', 'tail',
  // String operations
  'split', 'join', 'strip', 'trim',
  // Type operations
  'type', 'typeof', 'len',
  // Control
  'source', 'eval', 'exec',
  'test', '[', '[[',
  // Jobs
  'jobs', 'fg', 'bg', 'wait',
  // YSH-specific
  'json', 'json8',
  'pp', 'hay', 'haynode',
  'use',
  'assert',
  'try', 'boolstatus',
  'fork', 'forkwait',
  'shopt', 'shvar',
  'ctx',
  'runproc', 'invoke',
  // Builtins for objects
  'append', 'extend', 'pop',
  'keys', 'values', 'items',
  'get', 'erase',
  // Math
  'abs', 'max', 'min',
  // I/O
  'write', 'fopen',
  // Misc
  'error', 'failed',
];

// Special variables
const SPECIAL_VARIABLES = [
  '$?', '$!', '$$', '$@', '$#', '$*', '$-',
  '$0', '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9',
  '$_status', '$_this', '$_reply',
  'ARGV', 'ENV', 'PATH', 'HOME', 'PWD', 'OLDPWD',
  'IFS', 'PS1', 'PS2', 'PS4',
];

export function getCompletions(
  document: TextDocument,
  position: Position,
  symbols?: SymbolTable,
): CompletionItem[] {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Get the word being typed
  const lineText = getLineText(text, position.line);
  const wordRange = getWordRangeAtPosition(lineText, position.character);
  const prefix = lineText.slice(wordRange.start, position.character);

  const items: CompletionItem[] = [];

  // Check context
  const context = getContext(text, offset);

  // Variable completions after $
  if (context === 'variable' || prefix.startsWith('$')) {
    items.push(...getVariableCompletions(symbols, prefix));
  }

  // Keyword completions
  if (context === 'command' || context === 'keyword') {
    items.push(...getKeywordCompletions(prefix));
    items.push(...getBuiltinCompletions(prefix));
  }

  // Symbol completions from the current file
  if (symbols) {
    items.push(...getSymbolCompletions(symbols, prefix));
  }

  // Snippet completions
  items.push(...getSnippetCompletions(prefix, context));

  return items;
}

function getContext(text: string, offset: number): string {
  // Look backwards to determine context
  let i = offset - 1;

  // Skip current word
  while (i >= 0 && /[a-zA-Z0-9_]/.test(text[i])) {
    i--;
  }

  // Check what's before
  if (i >= 0) {
    const char = text[i];
    if (char === '$') return 'variable';
    if (char === '@') return 'array';
    if (char === '.') return 'member';
    if (char === '-' && text[i - 1] === '>') return 'method';
  }

  // Check if at start of line or after certain tokens
  while (i >= 0 && /[\s]/.test(text[i])) {
    i--;
  }

  if (i < 0 || text[i] === '\n' || text[i] === ';' || text[i] === '{' || text[i] === '(') {
    return 'command';
  }

  return 'expression';
}

function getLineText(text: string, line: number): string {
  const lines = text.split('\n');
  return lines[line] || '';
}

function getWordRangeAtPosition(lineText: string, character: number): { start: number; end: number } {
  let start = character;
  let end = character;

  // Move start backwards
  while (start > 0 && /[a-zA-Z0-9_$@]/.test(lineText[start - 1])) {
    start--;
  }

  // Move end forwards
  while (end < lineText.length && /[a-zA-Z0-9_]/.test(lineText[end])) {
    end++;
  }

  return { start, end };
}

function getVariableCompletions(symbols: SymbolTable | undefined, prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  // Special variables
  for (const v of SPECIAL_VARIABLES) {
    if (v.toLowerCase().includes(prefix.toLowerCase().replace('$', ''))) {
      items.push({
        label: v,
        kind: CompletionItemKind.Variable,
        detail: 'Special variable',
        data: { type: 'special_variable' },
      });
    }
  }

  // Variables from symbol table
  if (symbols) {
    for (const symbol of symbols.getVariables()) {
      items.push({
        label: '$' + symbol.name,
        kind: CompletionItemKind.Variable,
        detail: symbol.detail,
        data: { type: 'variable' },
      });
    }
  }

  return items;
}

function getKeywordCompletions(prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const keyword of YSH_KEYWORDS) {
    if (keyword.startsWith(prefix.toLowerCase())) {
      items.push({
        label: keyword,
        kind: CompletionItemKind.Keyword,
        detail: 'YSH keyword',
        data: { type: 'keyword' },
      });
    }
  }

  return items;
}

function getBuiltinCompletions(prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const builtin of YSH_BUILTINS) {
    if (builtin.toLowerCase().startsWith(prefix.toLowerCase())) {
      items.push({
        label: builtin,
        kind: CompletionItemKind.Function,
        detail: 'YSH builtin',
        data: { type: 'builtin' },
      });
    }
  }

  return items;
}

function getSymbolCompletions(symbols: SymbolTable, prefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const symbol of symbols.getAllSymbols()) {
    if (symbol.name.toLowerCase().startsWith(prefix.toLowerCase())) {
      items.push({
        label: symbol.name,
        kind: symbolKindToCompletionKind(symbol.kind),
        detail: symbol.detail,
        data: { type: 'symbol' },
      });
    }
  }

  return items;
}

// Convert SymbolKind to CompletionItemKind
import { SymbolKind } from 'vscode-languageserver/node';

function symbolKindToCompletionKind(symbolKind: SymbolKind): CompletionItemKind {
  switch (symbolKind) {
    case SymbolKind.Function:
      return CompletionItemKind.Function;
    case SymbolKind.Variable:
      return CompletionItemKind.Variable;
    case SymbolKind.Constant:
      return CompletionItemKind.Constant;
    case SymbolKind.Class:
      return CompletionItemKind.Class;
    case SymbolKind.Module:
      return CompletionItemKind.Module;
    default:
      return CompletionItemKind.Text;
  }
}

function getSnippetCompletions(prefix: string, context: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  if (context !== 'command') {
    return items;
  }

  const snippets: Array<{
    label: string;
    insertText: string;
    detail: string;
  }> = [
    {
      label: 'proc',
      insertText: 'proc ${1:name} (${2:params}) {\n\t$0\n}',
      detail: 'Define a procedure',
    },
    {
      label: 'func',
      insertText: 'func ${1:name}(${2:params}) {\n\treturn $0\n}',
      detail: 'Define a function',
    },
    {
      label: 'if',
      insertText: 'if (${1:condition}) {\n\t$0\n}',
      detail: 'If statement',
    },
    {
      label: 'for',
      insertText: 'for ${1:item} in (${2:list}) {\n\t$0\n}',
      detail: 'For loop',
    },
    {
      label: 'while',
      insertText: 'while (${1:condition}) {\n\t$0\n}',
      detail: 'While loop',
    },
    {
      label: 'var',
      insertText: 'var ${1:name} = ${2:value}',
      detail: 'Variable declaration',
    },
    {
      label: 'const',
      insertText: 'const ${1:NAME} = ${2:value}',
      detail: 'Constant declaration',
    },
  ];

  for (const snippet of snippets) {
    if (snippet.label.startsWith(prefix)) {
      items.push({
        label: snippet.label,
        kind: CompletionItemKind.Snippet,
        detail: snippet.detail,
        insertText: snippet.insertText,
        insertTextFormat: InsertTextFormat.Snippet,
        data: { type: 'snippet' },
      });
    }
  }

  return items;
}

