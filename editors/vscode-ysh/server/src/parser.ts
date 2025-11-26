/**
 * YSH Parser
 *
 * A simple recursive descent parser for YSH that extracts symbols
 * and reports parse errors. This is a lightweight parser for IDE features,
 * not a full YSH implementation.
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

// YSH keywords
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
]);

export class YSHParser {
  private text: string = '';
  private pos: number = 0;
  private tokens: Token[] = [];
  private tokenIndex: number = 0;
  private errors: ParseError[] = [];
  private warnings: ParseWarning[] = [];

  parse(text: string): ParseResult {
    this.text = text;
    this.pos = 0;
    this.tokens = [];
    this.tokenIndex = 0;
    this.errors = [];
    this.warnings = [];

    // Tokenize
    this.tokenize();

    // Parse
    const tree = this.parseProgram();

    return {
      tree,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  // =========================================================================
  // Tokenizer
  // =========================================================================

  private tokenize(): void {
    while (this.pos < this.text.length) {
      this.skipWhitespace();
      if (this.pos >= this.text.length) break;

      const startPos = this.pos;
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

      // String literals
      if (char === '"' || char === "'") {
        this.tokenizeString();
        continue;
      }

      // Multi-character string prefixes
      if ((char === '$' || char === 'r' || char === 'u' || char === 'b' || char === 'j') &&
          this.pos + 1 < this.text.length &&
          (this.text[this.pos + 1] === '"' || this.text[this.pos + 1] === "'")) {
        this.pos++;
        this.tokenizeString();
        continue;
      }

      // Triple-quoted strings
      if (this.text.slice(this.pos, this.pos + 3) === "'''" ||
          this.text.slice(this.pos, this.pos + 3) === '"""') {
        this.tokenizeMultilineString();
        continue;
      }

      // Numbers
      if (this.isDigit(char) || (char === '-' && this.isDigit(this.text[this.pos + 1]))) {
        this.tokenizeNumber();
        continue;
      }

      // Operators and punctuation
      if (this.isOperator(char)) {
        this.tokenizeOperator();
        continue;
      }

      // Special single characters
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
        case '$':
          this.tokenizeDollar();
          continue;
        case '@':
          this.addToken(TokenType.AT, '@');
          continue;
      }

      // Words/identifiers
      if (this.isWordChar(char)) {
        this.tokenizeWord();
        continue;
      }

      // Unknown character - skip
      this.pos++;
    }

    // Add EOF token
    this.tokens.push({
      type: TokenType.EOF,
      value: '',
      startIndex: this.text.length,
      endIndex: this.text.length,
    });
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const char = this.text[this.pos];
      if (char === ' ' || char === '\t' || char === '\r') {
        this.pos++;
      } else if (char === '\\' && this.text[this.pos + 1] === '\n') {
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

  private tokenizeString(): void {
    const start = this.pos;
    const quote = this.text[this.pos];
    this.pos++;

    while (this.pos < this.text.length) {
      const char = this.text[this.pos];
      if (char === quote) {
        this.pos++;
        break;
      } else if (char === '\\') {
        this.pos += 2;
      } else if (char === '\n') {
        // Unterminated string
        this.errors.push({
          message: 'Unterminated string literal',
          startIndex: start,
          endIndex: this.pos,
        });
        break;
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

  private tokenizeMultilineString(): void {
    const start = this.pos;
    const quote = this.text.slice(this.pos, this.pos + 3);
    this.pos += 3;

    while (this.pos < this.text.length) {
      if (this.text.slice(this.pos, this.pos + 3) === quote) {
        this.pos += 3;
        break;
      } else if (this.text[this.pos] === '\\') {
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

    // Handle negative sign
    if (this.text[this.pos] === '-') {
      this.pos++;
    }

    // Handle different number formats
    if (this.text[this.pos] === '0' && this.pos + 1 < this.text.length) {
      const next = this.text[this.pos + 1].toLowerCase();
      if (next === 'x') {
        // Hex
        this.pos += 2;
        while (this.pos < this.text.length && this.isHexDigit(this.text[this.pos])) {
          this.pos++;
        }
      } else if (next === 'o') {
        // Octal
        this.pos += 2;
        while (this.pos < this.text.length && this.isOctalDigit(this.text[this.pos])) {
          this.pos++;
        }
      } else if (next === 'b') {
        // Binary
        this.pos += 2;
        while (this.pos < this.text.length && (this.text[this.pos] === '0' || this.text[this.pos] === '1')) {
          this.pos++;
        }
      } else {
        this.tokenizeDecimal();
      }
    } else {
      this.tokenizeDecimal();
    }

    this.tokens.push({
      type: TokenType.NUMBER,
      value: this.text.slice(start, this.pos),
      startIndex: start,
      endIndex: this.pos,
    });
  }

  private tokenizeDecimal(): void {
    while (this.pos < this.text.length && (this.isDigit(this.text[this.pos]) || this.text[this.pos] === '_')) {
      this.pos++;
    }

    // Decimal point
    if (this.pos < this.text.length && this.text[this.pos] === '.') {
      this.pos++;
      while (this.pos < this.text.length && (this.isDigit(this.text[this.pos]) || this.text[this.pos] === '_')) {
        this.pos++;
      }
    }

    // Exponent
    if (this.pos < this.text.length && (this.text[this.pos] === 'e' || this.text[this.pos] === 'E')) {
      this.pos++;
      if (this.text[this.pos] === '+' || this.text[this.pos] === '-') {
        this.pos++;
      }
      while (this.pos < this.text.length && this.isDigit(this.text[this.pos])) {
        this.pos++;
      }
    }
  }

  private tokenizeOperator(): void {
    const start = this.pos;
    const char = this.text[this.pos];

    // Check for multi-character operators
    const twoChar = this.text.slice(this.pos, this.pos + 2);
    const threeChar = this.text.slice(this.pos, this.pos + 3);

    if (['===', '!==', '~==', '..=', '..<', '&&=', '||=', '>>=', '<<=', '**=', '//='].includes(threeChar)) {
      this.addToken(TokenType.OPERATOR, threeChar);
    } else if (['==', '!=', '<=', '>=', '&&', '||', '|&', '>>', '<<', '**', '//', '++',
                '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '->', '..'].includes(twoChar)) {
      this.addToken(TokenType.OPERATOR, twoChar);
    } else if (char === '=') {
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
      this.tokens.push({
        type: TokenType.DOLLAR,
        value: '$',
        startIndex: start,
        endIndex: this.pos,
      });
      return;
    }

    const char = this.text[this.pos];

    // ${ for brace expansion
    if (char === '{') {
      this.pos++;
      let depth = 1;
      while (this.pos < this.text.length && depth > 0) {
        if (this.text[this.pos] === '{') depth++;
        else if (this.text[this.pos] === '}') depth--;
        this.pos++;
      }
      this.tokens.push({
        type: TokenType.WORD,
        value: this.text.slice(start, this.pos),
        startIndex: start,
        endIndex: this.pos,
      });
      return;
    }

    // $( for command substitution
    if (char === '(') {
      this.pos++;
      let depth = 1;
      while (this.pos < this.text.length && depth > 0) {
        if (this.text[this.pos] === '(') depth++;
        else if (this.text[this.pos] === ')') depth--;
        this.pos++;
      }
      this.tokens.push({
        type: TokenType.WORD,
        value: this.text.slice(start, this.pos),
        startIndex: start,
        endIndex: this.pos,
      });
      return;
    }

    // $[ for expression substitution
    if (char === '[') {
      this.pos++;
      let depth = 1;
      while (this.pos < this.text.length && depth > 0) {
        if (this.text[this.pos] === '[') depth++;
        else if (this.text[this.pos] === ']') depth--;
        this.pos++;
      }
      this.tokens.push({
        type: TokenType.WORD,
        value: this.text.slice(start, this.pos),
        startIndex: start,
        endIndex: this.pos,
      });
      return;
    }

    // Special variables: $?, $!, $$, $@, $#, $*, $-
    if ('?!$@#*-'.includes(char)) {
      this.pos++;
      this.tokens.push({
        type: TokenType.WORD,
        value: this.text.slice(start, this.pos),
        startIndex: start,
        endIndex: this.pos,
      });
      return;
    }

    // Numeric variable: $0-$9
    if (this.isDigit(char)) {
      this.pos++;
      this.tokens.push({
        type: TokenType.WORD,
        value: this.text.slice(start, this.pos),
        startIndex: start,
        endIndex: this.pos,
      });
      return;
    }

    // Named variable: $name
    if (this.isWordStart(char)) {
      while (this.pos < this.text.length && this.isWordChar(this.text[this.pos])) {
        this.pos++;
      }
      this.tokens.push({
        type: TokenType.WORD,
        value: this.text.slice(start, this.pos),
        startIndex: start,
        endIndex: this.pos,
      });
      return;
    }

    // Just a dollar sign
    this.tokens.push({
      type: TokenType.DOLLAR,
      value: '$',
      startIndex: start,
      endIndex: start + 1,
    });
  }

  private tokenizeWord(): void {
    const start = this.pos;
    while (this.pos < this.text.length && this.isWordChar(this.text[this.pos])) {
      this.pos++;
    }

    const value = this.text.slice(start, this.pos);
    const type = KEYWORDS.has(value) ? TokenType.KEYWORD : TokenType.IDENTIFIER;

    this.tokens.push({
      type,
      value,
      startIndex: start,
      endIndex: this.pos,
    });
  }

  // Character classification
  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isHexDigit(char: string): boolean {
    return this.isDigit(char) ||
           (char >= 'a' && char <= 'f') ||
           (char >= 'A' && char <= 'F');
  }

  private isOctalDigit(char: string): boolean {
    return char >= '0' && char <= '7';
  }

  private isWordStart(char: string): boolean {
    return (char >= 'a' && char <= 'z') ||
           (char >= 'A' && char <= 'Z') ||
           char === '_';
  }

  private isWordChar(char: string): boolean {
    return this.isWordStart(char) ||
           this.isDigit(char) ||
           char === '-';
  }

  private isOperator(char: string): boolean {
    return '+-*/%<>=!&|^~.'.includes(char);
  }

  // =========================================================================
  // Parser
  // =========================================================================

  private currentToken(): Token {
    return this.tokens[this.tokenIndex] || this.tokens[this.tokens.length - 1];
  }

  private nextToken(): Token {
    if (this.tokenIndex < this.tokens.length - 1) {
      this.tokenIndex++;
    }
    return this.currentToken();
  }

  private peekToken(offset: number = 1): Token {
    const index = this.tokenIndex + offset;
    return this.tokens[Math.min(index, this.tokens.length - 1)];
  }

  private expect(type: TokenType): Token {
    const token = this.currentToken();
    if (token.type !== type) {
      this.errors.push({
        message: `Expected ${type}, got ${token.type}`,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      });
    }
    this.nextToken();
    return token;
  }

  private skipNewlines(): void {
    while (this.currentToken().type === TokenType.NEWLINE ||
           this.currentToken().type === TokenType.COMMENT) {
      this.nextToken();
    }
  }

  private parseProgram(): ASTNode {
    const startIndex = 0;
    const children: ASTNode[] = [];

    this.skipNewlines();

    while (this.currentToken().type !== TokenType.EOF) {
      const statement = this.parseStatement();
      if (statement) {
        children.push(statement);
      }
      this.skipNewlines();
    }

    return {
      type: 'program',
      startIndex,
      endIndex: this.text.length,
      children,
    };
  }

  private parseStatement(): ASTNode | null {
    const token = this.currentToken();

    // Skip comments
    if (token.type === TokenType.COMMENT) {
      const node: ASTNode = {
        type: 'comment',
        startIndex: token.startIndex,
        endIndex: token.endIndex,
        value: token.value,
      };
      this.nextToken();
      return node;
    }

    // Handle keywords
    if (token.type === TokenType.KEYWORD) {
      switch (token.value) {
        case 'proc':
          return this.parseProcDefinition();
        case 'func':
          return this.parseFuncDefinition();
        case 'var':
          return this.parseVarDeclaration();
        case 'const':
          return this.parseConstDeclaration();
        case 'setvar':
        case 'setglobal':
          return this.parseSetStatement();
        case 'if':
          return this.parseIfStatement();
        case 'for':
          return this.parseForStatement();
        case 'while':
        case 'until':
          return this.parseWhileStatement();
        case 'case':
          return this.parseCaseStatement();
        case 'function':
          return this.parseShellFunction();
        case 'call':
          return this.parseCallStatement();
        case 'return':
        case 'break':
        case 'continue':
        case 'exit':
          return this.parseControlFlow();
      }
    }

    // Shell function definition: name() { }
    if (token.type === TokenType.IDENTIFIER &&
        this.peekToken().type === TokenType.LPAREN &&
        this.peekToken(2).type === TokenType.RPAREN) {
      return this.parseShellFunction();
    }

    // Expression statement: = expr
    if (token.type === TokenType.EQUALS) {
      return this.parseExpressionStatement();
    }

    // Variable assignment: name=value
    if (token.type === TokenType.IDENTIFIER) {
      const next = this.peekToken();
      if (next.type === TokenType.EQUALS ||
          (next.type === TokenType.OPERATOR && next.value === '+=')) {
        return this.parseAssignment();
      }
    }

    // Simple command
    return this.parseSimpleCommand();
  }

  private parseProcDefinition(): ASTNode {
    const start = this.currentToken();
    this.expect(TokenType.KEYWORD); // proc

    const nameToken = this.expect(TokenType.IDENTIFIER);
    const name = nameToken.value;

    const params: string[] = [];

    // Optional parameter list
    if (this.currentToken().type === TokenType.LPAREN) {
      this.nextToken();
      while (this.currentToken().type !== TokenType.RPAREN &&
             this.currentToken().type !== TokenType.EOF) {
        if (this.currentToken().type === TokenType.IDENTIFIER) {
          params.push(this.currentToken().value);
        }
        this.nextToken();
        if (this.currentToken().type === TokenType.COMMA) {
          this.nextToken();
        }
      }
      this.expect(TokenType.RPAREN);
    }

    // Body
    this.skipNewlines();
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

  private parseFuncDefinition(): ASTNode {
    const start = this.currentToken();
    this.expect(TokenType.KEYWORD); // func

    const nameToken = this.expect(TokenType.IDENTIFIER);
    const name = nameToken.value;

    const params: string[] = [];

    // Parameter list
    this.expect(TokenType.LPAREN);
    while (this.currentToken().type !== TokenType.RPAREN &&
           this.currentToken().type !== TokenType.EOF) {
      if (this.currentToken().type === TokenType.IDENTIFIER) {
        params.push(this.currentToken().value);
      }
      this.nextToken();
      if (this.currentToken().type === TokenType.COMMA) {
        this.nextToken();
      }
    }
    this.expect(TokenType.RPAREN);

    // Optional return type
    if (this.currentToken().type === TokenType.COLON) {
      this.nextToken();
      // Skip type expression
      while (this.currentToken().type !== TokenType.LBRACE &&
             this.currentToken().type !== TokenType.NEWLINE &&
             this.currentToken().type !== TokenType.EOF) {
        this.nextToken();
      }
    }

    // Body
    this.skipNewlines();
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
    this.expect(TokenType.KEYWORD); // var

    const nameToken = this.expect(TokenType.IDENTIFIER);

    // Optional type annotation
    if (this.currentToken().type === TokenType.COLON) {
      this.nextToken();
      // Skip type
      while (this.currentToken().type === TokenType.IDENTIFIER ||
             this.currentToken().type === TokenType.LBRACKET ||
             this.currentToken().type === TokenType.RBRACKET ||
             this.currentToken().type === TokenType.COMMA) {
        this.nextToken();
      }
    }

    // Optional initializer
    if (this.currentToken().type === TokenType.EQUALS) {
      this.nextToken();
      // Skip expression until newline or semicolon
      this.skipExpression();
    }

    return {
      type: 'var_declaration',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name: nameToken.value,
    };
  }

  private parseConstDeclaration(): ASTNode {
    const start = this.currentToken();
    this.expect(TokenType.KEYWORD); // const

    const nameToken = this.expect(TokenType.IDENTIFIER);

    // Optional type annotation
    if (this.currentToken().type === TokenType.COLON) {
      this.nextToken();
      while (this.currentToken().type === TokenType.IDENTIFIER ||
             this.currentToken().type === TokenType.LBRACKET ||
             this.currentToken().type === TokenType.RBRACKET ||
             this.currentToken().type === TokenType.COMMA) {
        this.nextToken();
      }
    }

    // Required initializer
    this.expect(TokenType.EQUALS);
    this.skipExpression();

    return {
      type: 'const_declaration',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name: nameToken.value,
    };
  }

  private parseSetStatement(): ASTNode {
    const start = this.currentToken();
    const keyword = this.currentToken().value;
    this.nextToken(); // setvar or setglobal

    const nameToken = this.expect(TokenType.IDENTIFIER);

    // Assignment operator
    if (this.currentToken().type === TokenType.EQUALS ||
        this.currentToken().type === TokenType.OPERATOR) {
      this.nextToken();
    }

    // Expression
    this.skipExpression();

    return {
      type: keyword === 'setvar' ? 'setvar' : 'setglobal',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name: nameToken.value,
    };
  }

  private parseIfStatement(): ASTNode {
    const start = this.currentToken();
    this.expect(TokenType.KEYWORD); // if

    // Condition
    this.skipCondition();

    this.skipNewlines();

    // Body
    const children: ASTNode[] = [];
    if (this.currentToken().type === TokenType.LBRACE) {
      const body = this.parseBraceGroup();
      if (body) children.push(body);
    } else if (this.currentToken().type === TokenType.KEYWORD &&
               this.currentToken().value === 'then') {
      this.nextToken();
      // Parse until else/elif/fi
      while (this.currentToken().type !== TokenType.EOF) {
        if (this.currentToken().type === TokenType.KEYWORD) {
          const kw = this.currentToken().value;
          if (kw === 'else' || kw === 'elif' || kw === 'fi') break;
        }
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
        this.skipNewlines();
      }
    }

    // else/elif clauses
    while (this.currentToken().type === TokenType.KEYWORD) {
      const kw = this.currentToken().value;
      if (kw === 'elif') {
        this.nextToken();
        this.skipCondition();
        this.skipNewlines();
        if (this.currentToken().type === TokenType.LBRACE) {
          const body = this.parseBraceGroup();
          if (body) children.push(body);
        } else if (this.currentToken().type === TokenType.KEYWORD &&
                   this.currentToken().value === 'then') {
          this.nextToken();
        }
      } else if (kw === 'else') {
        this.nextToken();
        this.skipNewlines();
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

    return {
      type: 'if_statement',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      children,
    };
  }

  private parseForStatement(): ASTNode {
    const start = this.currentToken();
    this.expect(TokenType.KEYWORD); // for

    const varName = this.expect(TokenType.IDENTIFIER).value;

    // in
    if (this.currentToken().type === TokenType.KEYWORD &&
        this.currentToken().value === 'in') {
      this.nextToken();
      this.skipExpression();
    }

    // Optional semicolon
    if (this.currentToken().type === TokenType.SEMICOLON) {
      this.nextToken();
    }

    this.skipNewlines();

    // Body
    const children: ASTNode[] = [];
    if (this.currentToken().type === TokenType.LBRACE) {
      const body = this.parseBraceGroup();
      if (body) children.push(body);
    } else if (this.currentToken().type === TokenType.KEYWORD &&
               this.currentToken().value === 'do') {
      this.nextToken();
      while (this.currentToken().type !== TokenType.EOF) {
        if (this.currentToken().type === TokenType.KEYWORD &&
            this.currentToken().value === 'done') {
          this.nextToken();
          break;
        }
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
        this.skipNewlines();
      }
    }

    return {
      type: 'for_statement',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name: varName,
      children,
    };
  }

  private parseWhileStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // while or until

    this.skipCondition();
    this.skipNewlines();

    const children: ASTNode[] = [];
    if (this.currentToken().type === TokenType.LBRACE) {
      const body = this.parseBraceGroup();
      if (body) children.push(body);
    } else if (this.currentToken().type === TokenType.KEYWORD &&
               this.currentToken().value === 'do') {
      this.nextToken();
      while (this.currentToken().type !== TokenType.EOF) {
        if (this.currentToken().type === TokenType.KEYWORD &&
            this.currentToken().value === 'done') {
          this.nextToken();
          break;
        }
        const stmt = this.parseStatement();
        if (stmt) children.push(stmt);
        this.skipNewlines();
      }
    }

    return {
      type: 'while_statement',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      children,
    };
  }

  private parseCaseStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // case

    // Subject
    this.skipExpression();
    this.skipNewlines();

    // in or {
    if (this.currentToken().type === TokenType.KEYWORD &&
        this.currentToken().value === 'in') {
      this.nextToken();
    } else if (this.currentToken().type === TokenType.LBRACE) {
      this.nextToken();
    }

    // Skip until esac or }
    let depth = 1;
    while (this.currentToken().type !== TokenType.EOF && depth > 0) {
      if (this.currentToken().type === TokenType.KEYWORD &&
          this.currentToken().value === 'esac') {
        this.nextToken();
        depth--;
      } else if (this.currentToken().type === TokenType.RBRACE) {
        this.nextToken();
        depth--;
      } else {
        this.nextToken();
      }
    }

    return {
      type: 'case_statement',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
    };
  }

  private parseShellFunction(): ASTNode {
    const start = this.currentToken();

    // Optional function keyword
    if (this.currentToken().type === TokenType.KEYWORD &&
        this.currentToken().value === 'function') {
      this.nextToken();
    }

    const name = this.expect(TokenType.IDENTIFIER).value;

    // Optional ()
    if (this.currentToken().type === TokenType.LPAREN) {
      this.nextToken();
      this.expect(TokenType.RPAREN);
    }

    this.skipNewlines();

    const children: ASTNode[] = [];
    const body = this.parseBraceGroup();
    if (body) children.push(body);

    return {
      type: 'function_definition',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name,
      children,
    };
  }

  private parseCallStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // call

    this.skipExpression();

    return {
      type: 'call_statement',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
    };
  }

  private parseControlFlow(): ASTNode {
    const start = this.currentToken();
    const keyword = start.value;
    this.nextToken();

    // Optional argument
    if (this.currentToken().type !== TokenType.NEWLINE &&
        this.currentToken().type !== TokenType.SEMICOLON &&
        this.currentToken().type !== TokenType.EOF) {
      this.skipExpression();
    }

    return {
      type: 'control_flow',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      value: keyword,
    };
  }

  private parseExpressionStatement(): ASTNode {
    const start = this.currentToken();
    this.nextToken(); // =

    this.skipExpression();

    return {
      type: 'expression_statement',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
    };
  }

  private parseAssignment(): ASTNode {
    const start = this.currentToken();
    const name = start.value;
    this.nextToken(); // identifier

    this.nextToken(); // = or +=

    // Value
    if (this.currentToken().type !== TokenType.NEWLINE &&
        this.currentToken().type !== TokenType.SEMICOLON &&
        this.currentToken().type !== TokenType.EOF) {
      this.skipExpression();
    }

    return {
      type: 'assignment',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      name,
    };
  }

  private parseSimpleCommand(): ASTNode | null {
    const start = this.currentToken();

    // Check if we have anything to parse
    if (start.type === TokenType.NEWLINE ||
        start.type === TokenType.EOF ||
        start.type === TokenType.SEMICOLON) {
      this.nextToken();
      return null;
    }

    const words: string[] = [];

    while (this.currentToken().type !== TokenType.EOF &&
           this.currentToken().type !== TokenType.NEWLINE &&
           this.currentToken().type !== TokenType.SEMICOLON &&
           this.currentToken().type !== TokenType.PIPE &&
           this.currentToken().type !== TokenType.LBRACE &&
           this.currentToken().type !== TokenType.RBRACE) {

      // Skip control operators
      if (this.currentToken().type === TokenType.OPERATOR) {
        const op = this.currentToken().value;
        if (op === '&&' || op === '||') {
          break;
        }
      }

      words.push(this.currentToken().value);
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
      children: words.slice(1).map((w, i) => ({
        type: 'word',
        startIndex: 0,
        endIndex: 0,
        value: w,
      })),
    };
  }

  private parseBraceGroup(): ASTNode | null {
    if (this.currentToken().type !== TokenType.LBRACE) {
      return null;
    }

    const start = this.currentToken();
    this.nextToken(); // {
    this.skipNewlines();

    const children: ASTNode[] = [];
    while (this.currentToken().type !== TokenType.RBRACE &&
           this.currentToken().type !== TokenType.EOF) {
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);
      this.skipNewlines();
    }

    this.expect(TokenType.RBRACE);

    return {
      type: 'brace_group',
      startIndex: start.startIndex,
      endIndex: this.currentToken().startIndex,
      children,
    };
  }

  private skipCondition(): void {
    // Skip parenthesized expression or command list
    if (this.currentToken().type === TokenType.LPAREN) {
      let depth = 1;
      this.nextToken();
      while (this.currentToken().type !== TokenType.EOF && depth > 0) {
        if (this.currentToken().type === TokenType.LPAREN) depth++;
        else if (this.currentToken().type === TokenType.RPAREN) depth--;
        this.nextToken();
      }
    } else {
      // Command list until ; or { or newline
      while (this.currentToken().type !== TokenType.EOF &&
             this.currentToken().type !== TokenType.SEMICOLON &&
             this.currentToken().type !== TokenType.LBRACE &&
             this.currentToken().type !== TokenType.NEWLINE) {
        if (this.currentToken().type === TokenType.KEYWORD &&
            (this.currentToken().value === 'then' ||
             this.currentToken().value === 'do')) {
          break;
        }
        this.nextToken();
      }
    }
  }

  private skipExpression(): void {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    while (this.currentToken().type !== TokenType.EOF) {
      const token = this.currentToken();

      if (token.type === TokenType.LPAREN) parenDepth++;
      else if (token.type === TokenType.RPAREN) parenDepth--;
      else if (token.type === TokenType.LBRACKET) bracketDepth++;
      else if (token.type === TokenType.RBRACKET) bracketDepth--;
      else if (token.type === TokenType.LBRACE) braceDepth++;
      else if (token.type === TokenType.RBRACE) braceDepth--;

      if (parenDepth < 0 || bracketDepth < 0 || braceDepth < 0) {
        break;
      }

      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (token.type === TokenType.NEWLINE ||
            token.type === TokenType.SEMICOLON) {
          break;
        }
      }

      this.nextToken();
    }
  }
}

