/**
 * Hover Provider for YSH
 *
 * Provides hover information for symbols and keywords.
 */

import {
  Hover,
  MarkupKind,
  Position,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolTable, SymbolInfo } from './symbols';
import { ParseResult } from './parser';

// Documentation for YSH keywords
const KEYWORD_DOCS: Record<string, string> = {
  'proc': '**proc** - Define a procedure (shell-like command)\n\n```ysh\nproc name (params) {\n  # body\n}\n```\n\nProcedures are like shell functions but with proper parameter handling.',

  'func': '**func** - Define a function (expression-oriented)\n\n```ysh\nfunc name(params) {\n  return expr\n}\n```\n\nFunctions return values and can be used in expressions.',

  'var': '**var** - Declare a mutable variable\n\n```ysh\nvar x = 42\nvar name = "world"\nvar items = [1, 2, 3]\n```',

  'const': '**const** - Declare an immutable constant\n\n```ysh\nconst PI = 3.14159\nconst NAME = "YSH"\n```',

  'setvar': '**setvar** - Mutate a local variable\n\n```ysh\nvar x = 1\nsetvar x = 2\nsetvar x += 1\n```',

  'setglobal': '**setglobal** - Mutate a global variable\n\n```ysh\nsetglobal PATH = "$PATH:/new/path"\n```',

  'if': '**if** - Conditional statement\n\n```ysh\n# YSH style with expression\nif (x > 0) {\n  echo "positive"\n}\n\n# With else\nif (x > 0) {\n  echo "positive"\n} else {\n  echo "non-positive"\n}\n```',

  'for': '**for** - Loop over items\n\n```ysh\n# Over a list\nfor item in (mylist) {\n  echo $item\n}\n\n# Over a range\nfor i in (0 ..< 10) {\n  echo $i\n}\n```',

  'while': '**while** - Loop while condition is true\n\n```ysh\nwhile (x < 10) {\n  setvar x += 1\n}\n```',

  'case': '**case** - Pattern matching\n\n```ysh\ncase (x) {\n  1 { echo "one" }\n  2 { echo "two" }\n  * { echo "other" }\n}\n```',

  'call': '**call** - Call a function for its side effects\n\n```ysh\ncall myFunc()\ncall list->append(item)\n```',

  'and': '**and** - Logical AND operator\n\n```ysh\nif (x > 0 and y > 0) {\n  echo "both positive"\n}\n```',

  'or': '**or** - Logical OR operator\n\n```ysh\nif (x == 0 or y == 0) {\n  echo "at least one is zero"\n}\n```',

  'not': '**not** - Logical NOT operator\n\n```ysh\nif (not done) {\n  echo "still working"\n}\n```',

  'true': '**true** - Boolean true value',

  'false': '**false** - Boolean false value',

  'null': '**null** - Null value',
};

// Documentation for builtin functions
const BUILTIN_DOCS: Record<string, string> = {
  'echo': '**echo** - Print arguments to stdout\n\n```ysh\necho "Hello, World!"\necho -n "no newline"\n```',

  'printf': '**printf** - Formatted output\n\n```ysh\nprintf "%s is %d years old\\n" $name $age\n```',

  'read': '**read** - Read input\n\n```ysh\nread --line (&line)\nread --all (&content)\n```',

  'json': '**json** - JSON I/O\n\n```ysh\njson read (&obj) < file.json\njson write (obj)\n```',

  'append': '**append** - Append to a list\n\n```ysh\ncall mylist->append(item)\n```',

  'len': '**len** - Get length of a string or list\n\n```ysh\nvar n = len(mylist)\nvar s = len("hello")  # 5\n```',

  'type': '**type** - Get the type of a value\n\n```ysh\necho $[type(x)]  # "Int", "Str", "List", etc.\n```',

  'split': '**split** - Split a string\n\n```ysh\nvar parts = split(s, ":")\n```',

  'join': '**join** - Join a list into a string\n\n```ysh\nvar s = join(parts, ",")\n```',

  'keys': '**keys** - Get dictionary keys\n\n```ysh\nfor k in (keys(mydict)) {\n  echo $k\n}\n```',

  'values': '**values** - Get dictionary values\n\n```ysh\nfor v in (values(mydict)) {\n  echo $v\n}\n```',

  'try': '**try** - Error handling block\n\n```ysh\ntry {\n  risky-command\n}\necho "status: $_status"\n```',

  'assert': '**assert** - Assert a condition\n\n```ysh\nassert [x > 0]\nassert [len(items) !== 0]\n```',
};

export function getHoverInfo(
  document: TextDocument,
  position: Position,
  symbols: SymbolTable | undefined,
  parseResult: ParseResult | undefined,
): Hover | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Get the word at position
  const wordInfo = getWordAtPosition(text, offset);
  if (!wordInfo) {
    return null;
  }

  const { word, start, end } = wordInfo;

  // Check if it's a keyword
  const keywordDoc = KEYWORD_DOCS[word];
  if (keywordDoc) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: keywordDoc,
      },
    };
  }

  // Check if it's a builtin
  const builtinDoc = BUILTIN_DOCS[word];
  if (builtinDoc) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: builtinDoc,
      },
    };
  }

  // Look up symbol (remove $ prefix if present)
  const symbolName = word.startsWith('$') ? word.slice(1) : word;
  if (symbols) {
    const found = symbols.lookup(symbolName);
    if (found.length > 0) {
      const symbol = found[0];
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: formatSymbolHover(symbol),
        },
      };
    }
  }

  return null;
}

function getWordAtPosition(text: string, offset: number): { word: string; start: number; end: number } | null {
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

  return {
    word: text.slice(start, end),
    start,
    end,
  };
}

function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

function formatSymbolHover(symbol: SymbolInfo): string {
  let result = '';

  if (symbol.detail) {
    result += `**${symbol.detail}**\n\n`;
  } else {
    result += `**${symbol.name}**\n\n`;
  }

  if (symbol.params && symbol.params.length > 0) {
    result += '**Parameters:**\n';
    for (const param of symbol.params) {
      result += `- \`${param}\`\n`;
    }
    result += '\n';
  }

  if (symbol.type) {
    result += `**Type:** \`${symbol.type}\`\n`;
  }

  return result;
}

