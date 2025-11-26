/**
 * External scanner for YSH tree-sitter grammar.
 *
 * This handles context-sensitive tokens that can't be expressed in the
 * regular grammar, such as:
 * - Here-documents
 * - Multiline strings with specific delimiters
 * - Command substitution nesting
 */

#include <tree_sitter/parser.h>
#include <wctype.h>
#include <string.h>
#include <stdio.h>

enum TokenType {
  HEREDOC_START,
  HEREDOC_BODY,
  HEREDOC_END,
  STRING_CONTENT,
  MULTILINE_STRING_CONTENT,
  REGEX_CONTENT,
  COMMAND_SUBSTITUTION_START,
  BRACE_EXPANSION,
  ERROR_SENTINEL,
};

// Maximum heredoc delimiter length
#define MAX_DELIMITER_LENGTH 256

// Scanner state
typedef struct {
  // Heredoc state
  bool heredoc_started;
  bool heredoc_strip_tabs;
  char heredoc_delimiter[MAX_DELIMITER_LENGTH];
  uint16_t heredoc_delimiter_length;

  // Nesting tracking
  uint8_t paren_depth;
  uint8_t brace_depth;
  uint8_t bracket_depth;

  // String state
  bool in_double_quote;
  bool in_single_quote;
  bool in_command_sub;
} Scanner;

// Forward declarations
static void advance(TSLexer *lexer);
static void skip(TSLexer *lexer);
static bool is_space(int32_t c);
static bool is_newline(int32_t c);

static void advance(TSLexer *lexer) {
  lexer->advance(lexer, false);
}

static void skip(TSLexer *lexer) {
  lexer->advance(lexer, true);
}

static bool is_space(int32_t c) {
  return c == ' ' || c == '\t';
}

static bool is_newline(int32_t c) {
  return c == '\n' || c == '\r';
}

static bool is_word_char(int32_t c) {
  return (c >= 'a' && c <= 'z') ||
         (c >= 'A' && c <= 'Z') ||
         (c >= '0' && c <= '9') ||
         c == '_';
}

// Scan heredoc delimiter after << or <<<
static bool scan_heredoc_start(Scanner *scanner, TSLexer *lexer) {
  // Skip optional minus for <<-
  if (lexer->lookahead == '-') {
    scanner->heredoc_strip_tabs = true;
    advance(lexer);
  } else {
    scanner->heredoc_strip_tabs = false;
  }

  // Skip whitespace
  while (is_space(lexer->lookahead)) {
    skip(lexer);
  }

  // Read delimiter
  scanner->heredoc_delimiter_length = 0;
  bool quoted = false;

  // Handle quoted delimiters: <<'EOF', <<"EOF", <<\EOF
  if (lexer->lookahead == '\'' || lexer->lookahead == '"') {
    int32_t quote = lexer->lookahead;
    quoted = true;
    advance(lexer);

    while (lexer->lookahead != quote && lexer->lookahead != 0) {
      if (scanner->heredoc_delimiter_length < MAX_DELIMITER_LENGTH - 1) {
        scanner->heredoc_delimiter[scanner->heredoc_delimiter_length++] = (char)lexer->lookahead;
      }
      advance(lexer);
    }

    if (lexer->lookahead == quote) {
      advance(lexer);
    }
  } else if (lexer->lookahead == '\\') {
    // \EOF style
    advance(lexer);
    quoted = true;
    while (is_word_char(lexer->lookahead)) {
      if (scanner->heredoc_delimiter_length < MAX_DELIMITER_LENGTH - 1) {
        scanner->heredoc_delimiter[scanner->heredoc_delimiter_length++] = (char)lexer->lookahead;
      }
      advance(lexer);
    }
  } else {
    // Unquoted delimiter
    while (is_word_char(lexer->lookahead)) {
      if (scanner->heredoc_delimiter_length < MAX_DELIMITER_LENGTH - 1) {
        scanner->heredoc_delimiter[scanner->heredoc_delimiter_length++] = (char)lexer->lookahead;
      }
      advance(lexer);
    }
  }

  scanner->heredoc_delimiter[scanner->heredoc_delimiter_length] = '\0';

  if (scanner->heredoc_delimiter_length > 0) {
    scanner->heredoc_started = true;
    lexer->result_symbol = HEREDOC_START;
    return true;
  }

  return false;
}

// Scan heredoc body content
static bool scan_heredoc_body(Scanner *scanner, TSLexer *lexer) {
  if (!scanner->heredoc_started) {
    return false;
  }

  bool has_content = false;

  while (lexer->lookahead != 0) {
    // Check for delimiter at start of line
    if (lexer->get_column(lexer) == 0 || is_newline(lexer->lookahead)) {
      // Skip newline if present
      if (is_newline(lexer->lookahead)) {
        advance(lexer);
        has_content = true;
      }

      // Skip leading tabs if <<-
      if (scanner->heredoc_strip_tabs) {
        while (lexer->lookahead == '\t') {
          advance(lexer);
        }
      }

      // Check if this line matches the delimiter
      bool matches = true;
      for (uint16_t i = 0; i < scanner->heredoc_delimiter_length; i++) {
        if (lexer->lookahead != scanner->heredoc_delimiter[i]) {
          matches = false;
          break;
        }
        advance(lexer);
      }

      // Delimiter must be followed by newline or EOF
      if (matches && (is_newline(lexer->lookahead) || lexer->lookahead == 0)) {
        // Found the end delimiter
        scanner->heredoc_started = false;
        lexer->result_symbol = HEREDOC_END;
        return true;
      }

      // Not a delimiter, continue scanning content
      has_content = true;
    } else {
      advance(lexer);
      has_content = true;
    }
  }

  if (has_content) {
    lexer->result_symbol = HEREDOC_BODY;
    return true;
  }

  return false;
}

// Scan content inside double-quoted string (handles escapes and substitutions)
static bool scan_string_content(Scanner *scanner, TSLexer *lexer) {
  bool has_content = false;

  while (lexer->lookahead != 0) {
    switch (lexer->lookahead) {
      case '"':
        // End of string
        if (has_content) {
          lexer->result_symbol = STRING_CONTENT;
          return true;
        }
        return false;

      case '\\':
        // Escape sequence - consume two characters
        advance(lexer);
        if (lexer->lookahead != 0) {
          advance(lexer);
        }
        has_content = true;
        break;

      case '$':
      case '`':
        // Substitution start - return what we have so far
        if (has_content) {
          lexer->result_symbol = STRING_CONTENT;
          return true;
        }
        return false;

      default:
        advance(lexer);
        has_content = true;
        break;
    }
  }

  if (has_content) {
    lexer->result_symbol = STRING_CONTENT;
    return true;
  }

  return false;
}

// Scan multiline string content (''' or """)
static bool scan_multiline_string_content(Scanner *scanner, TSLexer *lexer, int32_t quote_char) {
  bool has_content = false;

  while (lexer->lookahead != 0) {
    if (lexer->lookahead == quote_char) {
      // Check for triple quote
      advance(lexer);
      if (lexer->lookahead == quote_char) {
        advance(lexer);
        if (lexer->lookahead == quote_char) {
          // End of multiline string
          if (has_content) {
            lexer->result_symbol = MULTILINE_STRING_CONTENT;
            return true;
          }
          return false;
        }
        // Only two quotes - continue
        has_content = true;
      } else {
        // Only one quote - continue
        has_content = true;
      }
    } else if (lexer->lookahead == '\\' && quote_char == '"') {
      // Escape in double-quoted multiline
      advance(lexer);
      if (lexer->lookahead != 0) {
        advance(lexer);
      }
      has_content = true;
    } else if ((lexer->lookahead == '$' || lexer->lookahead == '`') && quote_char == '"') {
      // Substitution in double-quoted multiline
      if (has_content) {
        lexer->result_symbol = MULTILINE_STRING_CONTENT;
        return true;
      }
      return false;
    } else {
      advance(lexer);
      has_content = true;
    }
  }

  if (has_content) {
    lexer->result_symbol = MULTILINE_STRING_CONTENT;
    return true;
  }

  return false;
}

// Scan regex content between / /
static bool scan_regex_content(Scanner *scanner, TSLexer *lexer) {
  bool has_content = false;

  while (lexer->lookahead != 0) {
    switch (lexer->lookahead) {
      case '/':
        // End of regex
        if (has_content) {
          lexer->result_symbol = REGEX_CONTENT;
          return true;
        }
        return false;

      case '\\':
        // Escape sequence
        advance(lexer);
        if (lexer->lookahead != 0) {
          advance(lexer);
        }
        has_content = true;
        break;

      case '[':
        // Character class - scan until ]
        advance(lexer);
        has_content = true;
        while (lexer->lookahead != 0 && lexer->lookahead != ']') {
          if (lexer->lookahead == '\\') {
            advance(lexer);
            if (lexer->lookahead != 0) {
              advance(lexer);
            }
          } else {
            advance(lexer);
          }
        }
        if (lexer->lookahead == ']') {
          advance(lexer);
        }
        break;

      case '\n':
        // Newline not allowed in regex without escaping
        if (has_content) {
          lexer->result_symbol = REGEX_CONTENT;
          return true;
        }
        return false;

      default:
        advance(lexer);
        has_content = true;
        break;
    }
  }

  if (has_content) {
    lexer->result_symbol = REGEX_CONTENT;
    return true;
  }

  return false;
}

// External scanner interface

void *tree_sitter_ysh_external_scanner_create() {
  Scanner *scanner = calloc(1, sizeof(Scanner));
  return scanner;
}

void tree_sitter_ysh_external_scanner_destroy(void *payload) {
  Scanner *scanner = (Scanner *)payload;
  free(scanner);
}

unsigned tree_sitter_ysh_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *scanner = (Scanner *)payload;

  unsigned size = 0;

  buffer[size++] = scanner->heredoc_started;
  buffer[size++] = scanner->heredoc_strip_tabs;
  buffer[size++] = (scanner->heredoc_delimiter_length >> 8) & 0xFF;
  buffer[size++] = scanner->heredoc_delimiter_length & 0xFF;

  for (uint16_t i = 0; i < scanner->heredoc_delimiter_length && size < TREE_SITTER_SERIALIZATION_BUFFER_SIZE - 1; i++) {
    buffer[size++] = scanner->heredoc_delimiter[i];
  }

  buffer[size++] = scanner->paren_depth;
  buffer[size++] = scanner->brace_depth;
  buffer[size++] = scanner->bracket_depth;
  buffer[size++] = scanner->in_double_quote;
  buffer[size++] = scanner->in_single_quote;
  buffer[size++] = scanner->in_command_sub;

  return size;
}

void tree_sitter_ysh_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *scanner = (Scanner *)payload;

  if (length == 0) {
    scanner->heredoc_started = false;
    scanner->heredoc_strip_tabs = false;
    scanner->heredoc_delimiter_length = 0;
    scanner->heredoc_delimiter[0] = '\0';
    scanner->paren_depth = 0;
    scanner->brace_depth = 0;
    scanner->bracket_depth = 0;
    scanner->in_double_quote = false;
    scanner->in_single_quote = false;
    scanner->in_command_sub = false;
    return;
  }

  unsigned pos = 0;

  scanner->heredoc_started = buffer[pos++];
  scanner->heredoc_strip_tabs = buffer[pos++];
  scanner->heredoc_delimiter_length = ((uint16_t)(unsigned char)buffer[pos++] << 8) |
                                       (uint16_t)(unsigned char)buffer[pos++];

  for (uint16_t i = 0; i < scanner->heredoc_delimiter_length && pos < length; i++) {
    scanner->heredoc_delimiter[i] = buffer[pos++];
  }
  scanner->heredoc_delimiter[scanner->heredoc_delimiter_length] = '\0';

  if (pos < length) scanner->paren_depth = buffer[pos++];
  if (pos < length) scanner->brace_depth = buffer[pos++];
  if (pos < length) scanner->bracket_depth = buffer[pos++];
  if (pos < length) scanner->in_double_quote = buffer[pos++];
  if (pos < length) scanner->in_single_quote = buffer[pos++];
  if (pos < length) scanner->in_command_sub = buffer[pos++];
}

bool tree_sitter_ysh_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  Scanner *scanner = (Scanner *)payload;

  // Handle heredoc body if we're in a heredoc
  if (scanner->heredoc_started && valid_symbols[HEREDOC_BODY]) {
    return scan_heredoc_body(scanner, lexer);
  }

  // Skip whitespace
  while (is_space(lexer->lookahead)) {
    skip(lexer);
  }

  // Check for heredoc start after <<
  if (valid_symbols[HEREDOC_START]) {
    // The << has already been consumed; scan the delimiter
    return scan_heredoc_start(scanner, lexer);
  }

  // String content scanning
  if (valid_symbols[STRING_CONTENT]) {
    return scan_string_content(scanner, lexer);
  }

  // Multiline string content
  if (valid_symbols[MULTILINE_STRING_CONTENT]) {
    if (lexer->lookahead == '\'') {
      return scan_multiline_string_content(scanner, lexer, '\'');
    } else if (lexer->lookahead == '"') {
      return scan_multiline_string_content(scanner, lexer, '"');
    }
  }

  // Regex content
  if (valid_symbols[REGEX_CONTENT]) {
    return scan_regex_content(scanner, lexer);
  }

  return false;
}

