/**
 * YSH Parser
 *
 * A recursive descent parser for YSH that extracts symbols and reports parse errors.
 * Handles both command mode (shell syntax) and expression mode (Python-like syntax).
 *
 * Key YSH constructs handled:
 * - proc/func definitions with positional and named params (separated by ;)
 * - var/const/setvar/setglobal declarations
 * - try { } blocks
 * - Dict literals: { key: value, ... }
 * - Expression conditions: while (expr) { }, if (expr) { }
 * - Expression substitution: $[expr]
 */

export interface ParseError {
  message: string;
  startIndex: number;
  endIndex: number;
}

export interface ParseWarning {
  message: string;
  startIndex: number;
  endIndex: number;
}

export interface ASTNode {
  type: string;
  startIndex: number;
  endIndex: number;
  children?: ASTNode[];
  name?: string;
  value?: string;
  params?: string[];
}

export interface ParseResult {
  tree: ASTNode;
  errors: ParseError[];
  warnings: ParseWarning[];
}

// Token types
enum TokenType {
  EOF = 'EOF',
  NEWLINE = 'NEWLINE',
  WORD = 'WORD',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  COMMENT = 'COMMENT',
  OPERATOR = 'OPERATOR',
  KEYWORD = 'KEYWORD',
  IDENTIFIER = 'IDENTIFIER',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  PIPE = 'PIPE',
  SEMICOLON = 'SEMICOLON',
  EQUALS = 'EQUALS',
  DOLLAR = 'DOLLAR',
  AT = 'AT',
  COMMA = 'COMMA',
  COLON = 'COLON',
}

interface Token {
  type: TokenType;
  value: string;
  startIndex: number;
  endIndex: number;
}

// YSH keywords - includes try
const KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi',
  'for', 'in', 'do', 'done',
  'while', 'until',
  'case', 'esac',
  'function',
  'var', 'const', 'setvar', 'setglobal',
  'proc', 'func', 'typed',
  'call', 'return', 'break', 'continue', 'exit',
  'and', 'or', 'not',
  'true', 'false', 'null',
  'try',  // YSH try block
  'source-guard', // YSH source guard
]);

// Safety limits
const MAX_TOKENS = 100000;
const MAX_ITERATIONS = 50000;

export class YSHParser {
  private text: string = '';
  private pos: number = 0;
  private tokens: Token[] = [];
  private tokenIndex: number = 0;
  private errors: ParseError[] = [];
  private warnings: ParseWarning[] = [];
  private iterations: number = 0;

  parse(text: string): ParseResult {
    this.text = text;
    this.pos = 0;
    this.tokens = [];
    this.tokenIndex = 0;
    this.errors = [];
    this.warnings = [];
    this.iterations = 0;

    try {
      this.tokenize();
      const tree = this.parseProgram();
      return { tree, errors: this.errors, warnings: this.warnings };
    } catch (e) {
      return {
        tree: { type: 'program', startIndex: 0, endIndex: text.length, children: [] },
        errors: [{ message: `Parser error: ${e}`, startIndex: 0, endIndex: 1 }],
        warnings: [],
      };
    }
  }

  private checkIterations(context: string): void {
    this.iterations++;
    if (this.iterations > MAX_ITERATIONS) {
      throw new Error(`Parser stuck in ${context} at token ${this.tokenIndex}`);
    }
  }

  // =========================================================================
  // Tokenizer
  // =========================================================================

  private tokenize(): void {
    while (this.pos < this.text.length && this.tokens.length < MAX_TOKENS) {
      this.skipWhitespaceNotNewline();
      if (this.pos >= this.text.length) break;

      const char = this.text[this.pos];

      // Comments
      if (char === '#') {
        this.tokenizeComment();
        continue;
      }

      // Newlines
      if (char === '\n') {
        this.tokens.push({
          type: TokenType.NEWLINE,
          value: '\n',
          startIndex: this.pos,
          endIndex: this.pos + 1,
        });
        this.pos++;
        continue;
      }

      // Triple-quoted strings
      if (this.pos + 2 < this.text.length) {
        const three = this.text.slice(this.pos, this.pos + 3);
        if (three === "'''" || three === '"""') {
          this.tokenizeMultilineString();
          continue;
        }
      }

      // String literals
      if (char === '"' || char === "'") {
        this.tokenizeString();
        continue;
      }

      // String prefixes: $"...", r"...", j"...", etc.
      if ((char === '$' || char === 'r' || char === 'u' || char === 'b' || char === 'j') &&
        this.pos + 1 < this.text.length &&
        (this.text[this.pos + 1] === '"' || this.text[this.pos + 1] === "'")) {
        const prefix = char;
        this.pos++;
        this.tokenizeString(prefix);
        continue;
      }

      // Numbers
      if (this.isDigit(char)) {
        this.tokenizeNumber();
        continue;
      }

      // Negative numbers (but not --option)
      if (char === '-' && this.pos + 1 < this.text.length) {
        const next = this.text[this.pos + 1];
        if (this.isDigit(next)) {
          this.tokenizeNumber();
          continue;
        }
      }

      // Operators
      if (this.isOperatorStart(char)) {
        this.tokenizeOperator();
        continue;
      }

      // Punctuation
      switch (char) {
        case '(':
          this.addToken(TokenType.LPAREN, '(');
          continue;
        case ')':
          this.addToken(TokenType.RPAREN, ')');
          continue;
        case '{':
          this.addToken(TokenType.LBRACE, '{');
          continue;
        case '}':
          this.addToken(TokenType.RBRACE, '}');
          continue;
        case '[':
          this.addToken(TokenType.LBRACKET, '[');
          continue;
        case ']':
          this.addToken(TokenType.RBRACKET, ']');
          continue;
        case ';':
          this.addToken(TokenType.SEMICOLON, ';');
          continue;
        case ',':
          this.addToken(TokenType.COMMA, ',');
          continue;
        case ':':
          this.addToken(TokenType.COLON, ':');
          continue;
        case '@':
          this.addToken(TokenType.AT, '@');
          continue;
        case '$':
          this.tokenizeDollar();
          continue;
      }

      // Words and identifiers
      if (this.isWordStart(char) || char === '-') {
        this.tokenizeWord();
        continue;
      }

      // Unknown - skip
      this.pos++;
    }

    this.tokens.push({
      type: TokenType.EOF,
      value: '',
      startIndex: this.text.length,
      endIndex: this.text.length,
    });
  }

  private skipWhitespaceNotNewline(): void {
    while (this.pos < this.text.length) {
      const char = this.text[this.pos];
      if (char === ' ' || char === '\t' || char === '\r') {
        this.pos++;
      } else if (char === '\\' && this.pos + 1 < this.text.length && this.text[this.pos + 1] === '\n') {
        // Line continuation
        this.pos += 2;
      } else {
        break;
      }
    }
  }

  private addToken(type: TokenType, value: string): void {
    this.tokens.push({
      type,
      value,
      startIndex: this.pos,
      endIndex: this.pos + value.length,
    });
    this.pos += value.length;
  }

  private tokenizeComment(): void {
    const start = this.pos;
    while (this.pos < this.text.length && this.text[this.pos] !== '\n') {
      this.pos++;
    }
    this.tokens.push({
      type: TokenType.COMMENT,
      value: this.text.slice(start, this.pos),
      startIndex: start,
      endIndex: this.pos,
    });
  }

  private tokenizeString(prefix: string = ''): void {
    const start = this.pos;
    const quote = this.text[this.pos];
    this.pos++;

    while (this.pos < this.text.length) {
      const char = this.text[this.pos];
      if (char === quote) {
        this.pos++;
        break;
      } else if (char === '\\' && this.pos + 1 < this.text.length) {
        this.pos += 2;
      } else if (char === '\n') {
        // Unterminated string
        break;
      } else {
        this.pos++;
      }
    }

    this.tokens.push({
      type: TokenType.STRING,
      value: prefix + this.text.slice(start, this.pos),
      startIndex: start - prefix.length,
      endIndex: this.pos,
    });
  }

  private tokenizeMultilineString(): void {
    const start = this.pos;
    const quote = this.text.slice(this.pos, this.pos + 3);
    this.pos += 3;

    while (this.pos < this.text.length) {
      if (this.pos + 2 < this.text.length && this.text.slice(this.pos, this.pos + 3) === quote) {
        this.pos += 3;
        break;
      } else if (this.text[this.pos] === '\\' && this.pos + 1 < this.text.length) {
        this.pos += 2;
      } else {
        this.pos++;
      }
    }

    this.tokens.push({
      type: TokenType.STRING,
      value: this.text.slice(start, this.pos),
      startIndex: start,
      endIndex: this.pos,
    });
  }

  private tokenizeNumber(): void {
    const start = this.pos;

    if (this.text[this.pos] === '-') {
      this.pos++;
    }

    // Hex, octal, binary
    if (this.pos < this.text.length && this.text[this.pos] === '0' && this.pos + 1 < this.text.length) {
      const next = this.text[this.pos + 1].toLowerCase();
      if (next === 'x') {
        this.pos += 2;
        while (this.pos < this.text.length && this.isHexDigit(this.text[this.pos])) this.pos++;
      } else if (next === 'o') {
        this.pos += 2;
        while (this.pos < this.text.length && this.isOctalDigit(this.text[this.pos])) this.pos++;
      } else if (next === 'b') {
        this.pos += 2;
        while (this.pos < this.text.length && (this.text[this.pos] === '0' || this.text[this.pos] === '1')) this.pos++;
      } else {
        this.tokenizeDecimalPart();
      }
    } else {
      this.tokenizeDecimalPart();
    }

    this.tokens.push({
      type: TokenType.NUMBER,
      value: this.text.slice(start, this.pos),
      startIndex: start,
      endIndex: this.pos,
    });
  }

  private tokenizeDecimalPart(): void {
    while (this.pos < this.text.length && (this.isDigit(this.text[this.pos]) || this.text[this.pos] === '_')) {
      this.pos++;
    }
    if (this.pos < this.text.length && this.text[this.pos] === '.') {
      this.pos++;
      while (this.pos < this.text.length && (this.isDigit(this.text[this.pos]) || this.text[this.pos] === '_')) {
        this.pos++;
      }
    }
    if (this.pos < this.text.length && (this.text[this.pos] === 'e' || this.text[this.pos] === 'E')) {
      this.pos++;
      if (this.pos < this.text.length && (this.text[this.pos] === '+' || this.text[this.pos] === '-')) {
        this.pos++;
      }
      while (this.pos < this.text.length && this.isDigit(this.text[this.pos])) {
        this.pos++;
      }
    }
  }

  private isOperatorStart(char: string): boolean {
    return '+-*/%<>=!&|^~.>'.includes(char);
  }

  private tokenizeOperator(): void {
    const char = this.text[this.pos];
    const twoChar = this.pos + 1 < this.text.length ? this.text.slice(this.pos, this.pos + 2) : '';
    const threeChar = this.pos + 2 < this.text.length ? this.text.slice(this.pos, this.pos + 3) : '';

    // Three-char operators
    if (['===', '!==', '~==', '..=', '..<', '&&=', '||=', '>>=', '<<=', '**=', '//=', '2>&'].includes(threeChar)) {
      this.addToken(TokenType.OPERATOR, threeChar);
      return;
    }

    // Two-char operators
    if (['==', '!=', '<=', '>=', '&&', '||', '|&', '>>', '<<', '**', '//',
      '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '->', '..', '2>', '>&'].includes(twoChar)) {
      this.addToken(TokenType.OPERATOR, twoChar);
      return;
    }

    if (char === '=') {
      this.addToken(TokenType.EQUALS, '=');
    } else if (char === '|') {
      this.addToken(TokenType.PIPE, '|');
    } else {
      this.addToken(TokenType.OPERATOR, char);
    }
  }

  private tokenizeDollar(): void {
    const start = this.pos;
    this.pos++;

    if (this.pos >= this.text.length) {
      this.tokens.push({ type: TokenType.DOLLAR, value: '$', startIndex: start, endIndex: this.pos });
      return;
    }

    const char = this.text[this.pos];

    // ${ ${name} or ${...}
    if (char === '{') {
      this.tokenizeDelimited(start, '{', '}');
      return;
    }

    // $( command substitution
    if (char === '(') {
      this.tokenizeDelimited(start, '(', ')');
      return;
    }

    // $[ expression substitution - YSH specific
    if (char === '[') {
      this.tokenizeDelimited(start, '[', ']');
      return;
    }

    // Special vars: $?, $!, $$, $@, $#, $*, $-
    if ('?!$@#*-'.includes(char)) {
      this.pos++;
      this.tokens.push({ type: TokenType.WORD, value: this.text.slice(start, this.pos), startIndex: start, endIndex: this.pos });
      return;
    }

    // $0-$9
    if (this.isDigit(char)) {
      this.pos++;
      this.tokens.push({ type: TokenType.WORD, value: this.text.slice(start, this.pos), startIndex: start, endIndex: this.pos });
      return;
    }

    // $name
    if (this.isWordStart(char)) {
      while (this.pos < this.text.length && (this.isWordChar(this.text[this.pos]) || this.text[this.pos] === '.')) {
        this.pos++;
      }
      this.tokens.push({ type: TokenType.WORD, value: this.text.slice(start, this.pos), startIndex: start, endIndex: this.pos });
      return;
    }

    this.tokens.push({ type: TokenType.DOLLAR, value: '$', startIndex: start, endIndex: start + 1 });
  }

  private tokenizeDelimited(start: number, open: string, close: string): void {
    this.pos++;
    let depth = 1;
    while (this.pos < this.text.length && depth > 0) {
      const c = this.text[this.pos];
      if (c === open) depth++;
      else if (c === close) depth--;
      this.pos++;
    }
    this.tokens.push({ type: TokenType.WORD, value: this.text.slice(start, this.pos), startIndex: start, endIndex: this.pos });
  }

  private tokenizeWord(): void {
    const start = this.pos;

    // Handle words that may contain - (like source-guard, --option)
    while (this.pos < this.text.length) {
      const char = this.text[this.pos];
      if (this.isWordChar(char) || char === '-') {
        this.pos++;
      } else {
        break;
      }
    }

    const value = this.text.slice(start, this.pos);
    const type = KEYWORDS.has(value) ? TokenType.KEYWORD : TokenType.IDENTIFIER;
    this.tokens.push({ type, value, startIndex: start, endIndex: this.pos });
  }

  private isDigit(char: string): boolean { return char >= '0' && char <= '9'; }
  private isHexDigit(char: string): boolean { return this.isDigit(char) || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F'); }
  private isOctalDigit(char: string): boolean { return char >= '0' && char <= '7'; }
  private isWordStart(char: string): boolean { return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_'; }
  private isWordChar(char: string): boolean { return this.isWordStart(char) || this.isDigit(char); }

  // =========================================================================
  // Parser
  // =========================================================================

  private currentToken(): Token {
    return this.tokens[this.tokenIndex] || this.tokens[this.tokens.length - 1];
  }

  private nextToken(): void {
    if (this.tokenIndex < this.tokens.length - 1) {
      this.tokenIndex++;
    }
  }

  private peekToken(offset: number = 1): Token {
    const index = this.tokenIndex + offset;
    return this.tokens[Math.min(index, this.tokens.length - 1)];
  }

  private skipNewlinesAndComments(): void {
    while (this.currentToken().type === TokenType.NEWLINE || this.currentToken().type === TokenType.COMMENT) {
      this.nextToken();
    }
  }

  private parseProgram(): ASTNode {
    const children: ASTNode[] = [];
    this.skipNewlinesAndComments();

    let lastIndex = -1;
    while (this.currentToken().type !== TokenType.EOF) {
      this.checkIterations('parseProgram');

      // Detect stuck parser
      if (this.tokenIndex === lastIndex) {
        this.nextToken(); // Force progress
        continue;
      }
      lastIndex = this.tokenIndex;

      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlinesAndComments();
    }

    return { type: 'program', startIndex: 0, endIndex: this.text.length, children };
  }

  private parseStatement(): ASTNode | null {
    const token = this.currentToken();

    if (token.type === TokenType.COMMENT) {
      const node: ASTNode = { type: 'comment', startIndex: token.startIndex, endIndex: token.endIndex, value: token.value };
      this.nextToken();
      return node;
    }

    if (token.type === TokenType.KEYWORD) {
      switch (token.value) {
        case 'proc': return this.parseProcDefinition();
        case 'func': return this.parseFuncDefinition();
        case 'var': return this.parseVarDeclaration();
        case 'const': return this.parseConstDeclaration();
        case 'setvar':
        case 'setglobal': return this.parseSetStatement();
        case 'if': return this.parseIfStatement();
        case 'for': return this.parseForStatement();
        case 'while':
        case 'until': return this.parseWhileStatement();
        case 'case': return this.parseCaseStatement();
        case 'function': return this.parseShellFunction();
        case 'call': return this.parseCallStatement();
        case 'return':
        case 'break':
        case 'continue':
        case 'exit': return this.parseControlFlow();
        case 'try': return this.parseTryStatement();
        default: return this.parseSimpleCommand();
      }
    }

    // Shell function: name() { }
    if (token.type === TokenType.IDENTIFIER &&
      this.peekToken().type === TokenType.LPAREN &&
      this.peekToken(2).type === TokenType.RPAREN) {
      return this.parseShellFunction();
    }

    // Expression statement: = expr
    if (token.type === TokenType.EQUALS) {
      return this.parseExpressionStatement();
    }

    // Assignment: name = value
    if (token.type === TokenType.IDENTIFIER) {
      const next = this.peekToken();
      if (next.type === TokenType.EQUALS || (next.type === TokenType.OPERATOR && next.value === '+=')) {
        return this.parseAssignment();
      }
    }

    return this.parseSimpleCommand();
  }

  private parseTryStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // try

    this.skipNewlinesAndComments();
    const children: ASTNode[] = [];

    // Parse try body
    if (this.currentToken().type === TokenType.LBRACE) {
      const body = this.parseBraceGroup();
      if (body) children.push(body);
    }

    return { type: 'try_statement', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, children };
  }

  private parseProcDefinition(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // proc

    let name = 'unknown';
    if (this.currentToken().type === TokenType.IDENTIFIER) {
      name = this.currentToken().value;
      this.nextToken();
    }

    const params: string[] = [];

    // Parameter list with ; separator for named params
    if (this.currentToken().type === TokenType.LPAREN) {
      this.nextToken();
      this.parseProcParamList(params);
      if (this.currentToken().type === TokenType.RPAREN) {
        this.nextToken();
      }
    }

    this.skipNewlinesAndComments();
    const body = this.parseBraceGroup();

    return {
      type: 'proc_definition',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name,
      params,
      children: body ? [body] : [],
    };
  }

  private parseProcParamList(params: string[]): void {
    // Handle: (x, y, z; named=default, other=val)
    while (this.currentToken().type !== TokenType.RPAREN && this.currentToken().type !== TokenType.EOF) {
      if (this.currentToken().type === TokenType.IDENTIFIER) {
        params.push(this.currentToken().value);
      }
      this.nextToken();

      // Skip type annotation
      if (this.currentToken().type === TokenType.COLON) {
        this.nextToken();
        if (this.currentToken().type === TokenType.IDENTIFIER) {
          this.nextToken();
        }
      }

      // Skip default value
      if (this.currentToken().type === TokenType.EQUALS) {
        this.nextToken();
        this.skipExpressionUntil([TokenType.COMMA, TokenType.SEMICOLON, TokenType.RPAREN]);
      }

      // Comma or semicolon separator
      if (this.currentToken().type === TokenType.COMMA || this.currentToken().type === TokenType.SEMICOLON) {
        this.nextToken();
      }
    }
  }

  private parseFuncDefinition(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // func

    let name = 'unknown';
    if (this.currentToken().type === TokenType.IDENTIFIER) {
      name = this.currentToken().value;
      this.nextToken();
    }

    const params: string[] = [];

    if (this.currentToken().type === TokenType.LPAREN) {
      this.nextToken();
      this.parseProcParamList(params);
      if (this.currentToken().type === TokenType.RPAREN) {
        this.nextToken();
      }
    }

    // Optional return type
    if (this.currentToken().type === TokenType.COLON) {
      this.nextToken();
      // Skip type until { or newline
      while (this.currentToken().type !== TokenType.LBRACE &&
        this.currentToken().type !== TokenType.NEWLINE &&
        this.currentToken().type !== TokenType.EOF) {
        this.nextToken();
      }
    }

    this.skipNewlinesAndComments();
    const body = this.parseBraceGroup();

    return {
      type: 'func_definition',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name,
      params,
      children: body ? [body] : [],
    };
  }

  private parseVarDeclaration(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // var

    let name = 'unknown';
    if (this.currentToken().type === TokenType.IDENTIFIER) {
      name = this.currentToken().value;
      this.nextToken();
    }

    // Optional type
    if (this.currentToken().type === TokenType.COLON) {
      this.nextToken();
      if (this.currentToken().type === TokenType.IDENTIFIER) {
        this.nextToken();
      }
    }

    // Optional initializer
    if (this.currentToken().type === TokenType.EQUALS) {
      this.nextToken();
      this.skipYshExpression();
    }

    return { type: 'var_declaration', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, name };
  }

  private parseConstDeclaration(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // const

    let name = 'unknown';
    if (this.currentToken().type === TokenType.IDENTIFIER) {
      name = this.currentToken().value;
      this.nextToken();
    }

    // Optional type
    if (this.currentToken().type === TokenType.COLON) {
      this.nextToken();
      if (this.currentToken().type === TokenType.IDENTIFIER) {
        this.nextToken();
      }
    }

    // Required initializer
    if (this.currentToken().type === TokenType.EQUALS) {
      this.nextToken();
      this.skipYshExpression();
    }

    return { type: 'const_declaration', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, name };
  }

  private parseSetStatement(): ASTNode {
    const start = this.currentToken();
    const keyword = this.currentToken().value;
    this.nextToken();

    let name = 'unknown';
    if (this.currentToken().type === TokenType.IDENTIFIER) {
      name = this.currentToken().value;
      this.nextToken();
    }

    if (this.currentToken().type === TokenType.EQUALS || this.currentToken().type === TokenType.OPERATOR) {
      this.nextToken();
    }

    this.skipYshExpression();

    return {
      type: keyword === 'setvar' ? 'setvar' : 'setglobal',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name,
    };
  }

  private parseIfStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // if

    // Condition can be (expr) or command
    if (this.currentToken().type === TokenType.LPAREN) {
      this.skipBalanced(TokenType.LPAREN, TokenType.RPAREN);
    } else {
      this.skipCommandCondition();
    }

    this.skipNewlinesAndComments();
    const children: ASTNode[] = [];

    if (this.currentToken().type === TokenType.LBRACE) {
      const body = this.parseBraceGroup();
      if (body) children.push(body);
    } else if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'then') {
      this.nextToken();
      this.parseStatementsUntilKeywords(children, ['else', 'elif', 'fi']);
    }

    // else/elif
    while (this.currentToken().type === TokenType.KEYWORD) {
      const kw = this.currentToken().value;
      if (kw === 'elif') {
        this.nextToken();
        if (this.currentToken().type === TokenType.LPAREN) {
          this.skipBalanced(TokenType.LPAREN, TokenType.RPAREN);
        } else {
          this.skipCommandCondition();
        }
        this.skipNewlinesAndComments();
        if (this.currentToken().type === TokenType.LBRACE) {
          const body = this.parseBraceGroup();
          if (body) children.push(body);
        } else if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'then') {
          this.nextToken();
        }
      } else if (kw === 'else') {
        this.nextToken();
        this.skipNewlinesAndComments();
        if (this.currentToken().type === TokenType.LBRACE) {
          const body = this.parseBraceGroup();
          if (body) children.push(body);
        }
      } else if (kw === 'fi') {
        this.nextToken();
        break;
      } else {
        break;
      }
    }

    return { type: 'if_statement', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, children };
  }

  private parseForStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // for

    let varName = 'unknown';
    if (this.currentToken().type === TokenType.IDENTIFIER) {
      varName = this.currentToken().value;
      this.nextToken();
    }

    if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'in') {
      this.nextToken();
      this.skipYshExpression();
    }

    if (this.currentToken().type === TokenType.SEMICOLON) {
      this.nextToken();
    }

    this.skipNewlinesAndComments();
    const children: ASTNode[] = [];

    if (this.currentToken().type === TokenType.LBRACE) {
      const body = this.parseBraceGroup();
      if (body) children.push(body);
    } else if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'do') {
      this.nextToken();
      this.parseStatementsUntilKeywords(children, ['done']);
      if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'done') {
        this.nextToken();
      }
    }

    return { type: 'for_statement', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, name: varName, children };
  }

  private parseWhileStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // while or until

    // Condition: (expr) or command
    if (this.currentToken().type === TokenType.LPAREN) {
      this.skipBalanced(TokenType.LPAREN, TokenType.RPAREN);
    } else {
      this.skipCommandCondition();
    }

    this.skipNewlinesAndComments();
    const children: ASTNode[] = [];

    if (this.currentToken().type === TokenType.LBRACE) {
      const body = this.parseBraceGroup();
      if (body) children.push(body);
    } else if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'do') {
      this.nextToken();
      this.parseStatementsUntilKeywords(children, ['done']);
      if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'done') {
        this.nextToken();
      }
    }

    return { type: 'while_statement', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, children };
  }

  private parseCaseStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // case

    this.skipYshExpression();
    this.skipNewlinesAndComments();

    // Skip until esac or }
    if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'in') {
      this.nextToken();
    } else if (this.currentToken().type === TokenType.LBRACE) {
      this.nextToken();
    }

    let depth = 1;
    while (this.currentToken().type !== TokenType.EOF && depth > 0) {
      if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'esac') {
        this.nextToken();
        depth--;
      } else if (this.currentToken().type === TokenType.RBRACE) {
        this.nextToken();
        depth--;
      } else {
        this.nextToken();
      }
    }

    return { type: 'case_statement', startIndex: start.startIndex, endIndex: this.currentToken().startIndex };
  }

  private parseShellFunction(): ASTNode {
    const start = this.currentToken();

    if (this.currentToken().type === TokenType.KEYWORD && this.currentToken().value === 'function') {
      this.nextToken();
    }

    let name = 'unknown';
    if (this.currentToken().type === TokenType.IDENTIFIER) {
      name = this.currentToken().value;
      this.nextToken();
    }

    if (this.currentToken().type === TokenType.LPAREN) {
      this.nextToken();
      if (this.currentToken().type === TokenType.RPAREN) {
        this.nextToken();
      }
    }

    this.skipNewlinesAndComments();
    const children: ASTNode[] = [];
    const body = this.parseBraceGroup();
    if (body) children.push(body);

    return { type: 'function_definition', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, name, children };
  }

  private parseCallStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // call
    this.skipYshExpression();
    return { type: 'call_statement', startIndex: start.startIndex, endIndex: this.currentToken().startIndex };
  }

  private parseControlFlow(): ASTNode {
    const start = this.currentToken();
    const keyword = start.value;
    this.nextToken();

    if (this.currentToken().type !== TokenType.NEWLINE &&
      this.currentToken().type !== TokenType.SEMICOLON &&
      this.currentToken().type !== TokenType.EOF &&
      this.currentToken().type !== TokenType.RBRACE) {
      this.skipYshExpression();
    }

    return { type: 'control_flow', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, value: keyword };
  }

  private parseExpressionStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // =
    this.skipYshExpression();
    return { type: 'expression_statement', startIndex: start.startIndex, endIndex: this.currentToken().startIndex };
  }

  private parseAssignment(): ASTNode {
    const start = this.currentToken();
    const name = start.value;
    this.nextToken(); // identifier
    this.nextToken(); // = or +=

    if (this.currentToken().type !== TokenType.NEWLINE &&
      this.currentToken().type !== TokenType.SEMICOLON &&
      this.currentToken().type !== TokenType.EOF) {
      this.skipYshExpression();
    }

    return { type: 'assignment', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, name };
  }

  private parseSimpleCommand(): ASTNode | null {
    const start = this.currentToken();

    if (start.type === TokenType.NEWLINE || start.type === TokenType.EOF || start.type === TokenType.SEMICOLON) {
      this.nextToken();
      return null;
    }

    const words: string[] = [];

    while (this.currentToken().type !== TokenType.EOF &&
      this.currentToken().type !== TokenType.NEWLINE &&
      this.currentToken().type !== TokenType.SEMICOLON &&
      this.currentToken().type !== TokenType.PIPE &&
      this.currentToken().type !== TokenType.RBRACE) {

      const tok = this.currentToken();

      // Stop at && or ||
      if (tok.type === TokenType.OPERATOR && (tok.value === '&&' || tok.value === '||')) {
        break;
      }

      // Stop at { unless it's the first word (brace group)
      if (tok.type === TokenType.LBRACE && words.length > 0) {
        break;
      }

      words.push(tok.value);
      this.nextToken();
    }

    if (words.length === 0) {
      return null;
    }

    return {
      type: 'simple_command',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name: words[0],
      children: words.slice(1).map(w => ({ type: 'word', startIndex: 0, endIndex: 0, value: w })),
    };
  }

  private parseBraceGroup(): ASTNode | null {
    if (this.currentToken().type !== TokenType.LBRACE) {
      return null;
    }

    const start = this.currentToken();
    this.nextToken(); // {
    this.skipNewlinesAndComments();

    const children: ASTNode[] = [];
    let lastIndex = -1;

    while (this.currentToken().type !== TokenType.RBRACE && this.currentToken().type !== TokenType.EOF) {
      this.checkIterations('parseBraceGroup');

      // Detect stuck parser
      if (this.tokenIndex === lastIndex) {
        this.nextToken(); // Force progress
        continue;
      }
      lastIndex = this.tokenIndex;

      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlinesAndComments();
    }

    if (this.currentToken().type === TokenType.RBRACE) {
      this.nextToken();
    }

    return { type: 'brace_group', startIndex: start.startIndex, endIndex: this.currentToken().startIndex, children };
  }

  // Skip a YSH expression - handles { } as dict literals, not brace groups
  private skipYshExpression(): void {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    const maxIter = 10000;
    let iter = 0;

    while (this.currentToken().type !== TokenType.EOF && iter < maxIter) {
      iter++;
      const tok = this.currentToken();

      if (tok.type === TokenType.LPAREN) parenDepth++;
      else if (tok.type === TokenType.RPAREN) {
        parenDepth--;
        if (parenDepth < 0) break;
      }
      else if (tok.type === TokenType.LBRACKET) bracketDepth++;
      else if (tok.type === TokenType.RBRACKET) {
        bracketDepth--;
        if (bracketDepth < 0) break;
      }
      else if (tok.type === TokenType.LBRACE) braceDepth++;
      else if (tok.type === TokenType.RBRACE) {
        braceDepth--;
        if (braceDepth < 0) break;
      }

      // At depth 0, newline/semicolon ends expression
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (tok.type === TokenType.NEWLINE || tok.type === TokenType.SEMICOLON) {
          break;
        }
      }

      this.nextToken();
    }
  }

  private skipExpressionUntil(stopTokens: TokenType[]): void {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    const maxIter = 10000;
    let iter = 0;

    while (this.currentToken().type !== TokenType.EOF && iter < maxIter) {
      iter++;
      const tok = this.currentToken();

      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (stopTokens.includes(tok.type)) break;
      }

      if (tok.type === TokenType.LPAREN) parenDepth++;
      else if (tok.type === TokenType.RPAREN) parenDepth--;
      else if (tok.type === TokenType.LBRACKET) bracketDepth++;
      else if (tok.type === TokenType.RBRACKET) bracketDepth--;
      else if (tok.type === TokenType.LBRACE) braceDepth++;
      else if (tok.type === TokenType.RBRACE) braceDepth--;

      this.nextToken();
    }
  }

  private skipBalanced(open: TokenType, close: TokenType): void {
    let depth = 1;
    this.nextToken();
    const maxIter = 10000;
    let iter = 0;
    while (this.currentToken().type !== TokenType.EOF && depth > 0 && iter < maxIter) {
      iter++;
      if (this.currentToken().type === open) depth++;
      else if (this.currentToken().type === close) depth--;
      this.nextToken();
    }
  }

  private skipCommandCondition(): void {
    const maxIter = 10000;
    let iter = 0;
    while (iter < maxIter &&
      this.currentToken().type !== TokenType.EOF &&
      this.currentToken().type !== TokenType.SEMICOLON &&
      this.currentToken().type !== TokenType.LBRACE &&
      this.currentToken().type !== TokenType.NEWLINE) {
      iter++;
      if (this.currentToken().type === TokenType.KEYWORD &&
        (this.currentToken().value === 'then' || this.currentToken().value === 'do')) {
        break;
      }
      this.nextToken();
    }
  }

  private parseStatementsUntilKeywords(children: ASTNode[], keywords: string[]): void {
    let lastIndex = -1;
    while (this.currentToken().type !== TokenType.EOF) {
      this.checkIterations('parseStatementsUntilKeywords');

      // Detect stuck parser
      if (this.tokenIndex === lastIndex) {
        this.nextToken(); // Force progress
        continue;
      }
      lastIndex = this.tokenIndex;

      if (this.currentToken().type === TokenType.KEYWORD && keywords.includes(this.currentToken().value)) {
        break;
      }
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlinesAndComments();
    }
  }
}
