/**
 * @file Tree-sitter grammar for YSH (Oils Shell)
 * @author Oils Contributors
 * @license Apache-2.0
 *
 * Based on the Oils lexer definitions in frontend/lexer_def.py
 * and AST structure in frontend/syntax.asdl
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Operator precedence levels (higher = tighter binding)
const PREC = {
  LOWEST: 0,
  OR: 1,           // or, ||
  AND: 2,          // and, &&
  NOT: 3,          // not, !
  COMPARE: 4,      // == != < > <= >= === !== ~== in 'not in' is 'is not'
  BITOR: 5,        // |
  BITXOR: 6,       // ^
  BITAND: 7,       // &
  SHIFT: 8,        // << >>
  ADD: 9,          // + -
  MUL: 10,         // * / // %
  UNARY: 11,       // - ~ !
  POWER: 12,       // **
  POSTFIX: 13,     // . -> [] ()
  PRIMARY: 14,
};

// YSH keywords
const YSH_KEYWORDS = [
  'var', 'const', 'setvar', 'setglobal',
  'proc', 'func', 'typed',
  'call',
];

// Shell keywords
const SHELL_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi',
  'for', 'in', 'do', 'done',
  'while', 'until',
  'case', 'esac',
  'function',
  'time',
];

// Control flow keywords (parsed statically in Oils)
const CONTROL_FLOW = ['break', 'continue', 'return', 'exit'];

// Expression keywords
const EXPR_KEYWORDS = [
  'null', 'true', 'false',
  'and', 'or', 'not',
  'is', 'in', 'if', 'else',
  'for', 'capture', 'as',
];

module.exports = grammar({
  name: 'ysh',

  // Tokens handled by external scanner (src/scanner.c)
  externals: $ => [
    $._heredoc_start,
    $._heredoc_body,
    $._heredoc_end,
    $._string_content,
    $._multiline_string_content,
    $._regex_content,
    $._command_substitution_start,
    $._brace_expansion,
    $.error_sentinel,
  ],

  // Extra tokens that can appear anywhere (whitespace, comments)
  extras: $ => [
    /\s/,
    $.comment,
    $.line_continuation,
  ],

  // Handle conflicts
  conflicts: $ => [
    [$.simple_command, $.variable_assignment],
    [$.command_name, $.word],
    [$._expression, $.command_substitution],
    [$.proc_definition, $.func_definition],
  ],

  // Word boundaries
  word: $ => $.identifier,

  // Inline rules for better performance
  inline: $ => [
    $._statement,
    $._primary_expression,
  ],

  rules: {
    // =========================================================================
    // Program (entry point)
    // =========================================================================
    source_file: $ => repeat($._statement),

    _statement: $ => choice(
      $._command,
      $._ysh_statement,
    ),

    // =========================================================================
    // Comments and Line Continuation
    // =========================================================================
    comment: $ => token(seq('#', /.*/)),

    doc_comment: $ => token(seq('###', /.*/)),

    line_continuation: $ => token(seq('\\', /\r?\n/)),

    // =========================================================================
    // Commands
    // =========================================================================
    _command: $ => choice(
      $.simple_command,
      $.pipeline,
      $.and_or,
      $.subshell,
      $.brace_group,
      $.if_statement,
      $.for_statement,
      $.while_statement,
      $.case_statement,
      $.function_definition,
      $.redirect_statement,
    ),

    simple_command: $ => seq(
      repeat($.variable_assignment),
      optional($.command_name),
      repeat(choice(
        $.word,
        $._expression_word,
        $.redirect,
      )),
    ),

    command_name: $ => $.word,

    pipeline: $ => prec.left(seq(
      $._command,
      repeat1(seq(
        choice('|', '|&'),
        $._command,
      )),
    )),

    and_or: $ => prec.left(PREC.AND, seq(
      $._command,
      repeat1(seq(
        choice('&&', '||'),
        $._command,
      )),
    )),

    subshell: $ => seq('(', repeat($._statement), ')'),

    brace_group: $ => seq('{', repeat($._statement), '}'),

    redirect_statement: $ => seq(
      $._command,
      repeat1($.redirect),
    ),

    // =========================================================================
    // Control Flow
    // =========================================================================
    if_statement: $ => seq(
      'if',
      $._condition,
      choice(
        // YSH style: if (expr) { }
        seq('{', repeat($._statement), '}'),
        // Shell style: if cmd; then ... fi
        seq('then', repeat($._statement)),
      ),
      repeat($.elif_clause),
      optional($.else_clause),
      optional('fi'),
    ),

    elif_clause: $ => seq(
      'elif',
      $._condition,
      choice(
        seq('{', repeat($._statement), '}'),
        seq('then', repeat($._statement)),
      ),
    ),

    else_clause: $ => seq(
      'else',
      choice(
        seq('{', repeat($._statement), '}'),
        repeat($._statement),
      ),
    ),

    _condition: $ => choice(
      // YSH expression condition: (expr)
      $.parenthesized_expression,
      // Shell command condition
      seq(repeat1($._command), optional(';')),
    ),

    for_statement: $ => seq(
      'for',
      $.identifier,
      optional(seq('in', $._for_iterable)),
      optional(';'),
      choice(
        // YSH style
        seq('{', repeat($._statement), '}'),
        // Shell style
        seq('do', repeat($._statement), 'done'),
      ),
    ),

    _for_iterable: $ => choice(
      // YSH: for x in (mylist) { }
      $.parenthesized_expression,
      // Shell: for x in a b c; do ... done
      repeat1($.word),
    ),

    while_statement: $ => seq(
      choice('while', 'until'),
      $._condition,
      choice(
        seq('{', repeat($._statement), '}'),
        seq('do', repeat($._statement), 'done'),
      ),
    ),

    case_statement: $ => seq(
      'case',
      choice(
        // YSH: case (expr) { }
        seq($.parenthesized_expression, '{'),
        // Shell: case $x in
        seq($.word, 'in'),
      ),
      repeat($.case_arm),
      choice('}', 'esac'),
    ),

    case_arm: $ => seq(
      optional('('),
      $.pattern_list,
      choice(
        // YSH style
        seq('{', repeat($._statement), '}'),
        // Shell style
        seq(')', repeat($._statement), optional(choice(';;', ';&', ';;&'))),
      ),
    ),

    pattern_list: $ => seq(
      $.pattern,
      repeat(seq('|', $.pattern)),
    ),

    pattern: $ => choice(
      $.word,
      $.glob_pattern,
      '*',  // default case
    ),

    glob_pattern: $ => /[*?]+[^\s]*/,

    // =========================================================================
    // Function Definition (Shell style)
    // =========================================================================
    function_definition: $ => choice(
      // function keyword style
      seq(
        optional('function'),
        $.identifier,
        optional(seq('(', ')')),
        $.brace_group,
      ),
    ),

    // =========================================================================
    // YSH Statements
    // =========================================================================
    _ysh_statement: $ => choice(
      $.var_declaration,
      $.const_declaration,
      $.setvar_statement,
      $.setglobal_statement,
      $.proc_definition,
      $.func_definition,
      $.call_expression_statement,
      $.expression_statement,
    ),

    var_declaration: $ => seq(
      'var',
      $.identifier,
      optional($.type_annotation),
      optional(seq('=', $._expression)),
    ),

    const_declaration: $ => seq(
      'const',
      $.identifier,
      optional($.type_annotation),
      '=',
      $._expression,
    ),

    setvar_statement: $ => seq(
      'setvar',
      $._lvalue,
      $._assignment_op,
      $._expression,
    ),

    setglobal_statement: $ => seq(
      'setglobal',
      $._lvalue,
      $._assignment_op,
      $._expression,
    ),

    _lvalue: $ => choice(
      $.identifier,
      $.subscript_expression,
      $.attribute_expression,
    ),

    _assignment_op: $ => choice(
      '=', '+=', '-=', '*=', '/=', '//=', '%=', '**=',
      '<<=', '>>=', '&=', '|=', '^=',
    ),

    type_annotation: $ => seq(':', $.type_expression),

    type_expression: $ => seq(
      $.identifier,
      optional(seq('[', commaSep1($.type_expression), ']')),
    ),

    proc_definition: $ => seq(
      'proc',
      $.identifier,
      optional($.proc_signature),
      $.brace_group,
    ),

    proc_signature: $ => choice(
      // Open proc: proc p { }
      seq('(', ')'),
      // Closed proc with params: proc p (x, y; z) { }
      seq('(', optional($.param_list), ')'),
    ),

    func_definition: $ => seq(
      'func',
      $.identifier,
      '(',
      optional($.param_list),
      ')',
      optional(seq(':', $.type_expression)),
      $.brace_group,
    ),

    param_list: $ => seq(
      commaSep1($.param),
      optional(seq(';', commaSep1($.named_param))),
    ),

    param: $ => seq(
      $.identifier,
      optional($.type_annotation),
      optional(seq('=', $._expression)),
    ),

    named_param: $ => seq(
      $.identifier,
      optional($.type_annotation),
      optional(seq('=', $._expression)),
    ),

    rest_param: $ => seq('...', $.identifier),

    call_expression_statement: $ => seq(
      'call',
      $._expression,
    ),

    expression_statement: $ => seq(
      '=',
      $._expression,
    ),

    // =========================================================================
    // Expressions
    // =========================================================================
    _expression: $ => choice(
      $._primary_expression,
      $.unary_expression,
      $.binary_expression,
      $.ternary_expression,
      $.comparison_expression,
      $.range_expression,
    ),

    _primary_expression: $ => choice(
      $.identifier,
      $.number,
      $.string,
      $.list_literal,
      $.dict_literal,
      $.parenthesized_expression,
      $.call_expression,
      $.subscript_expression,
      $.attribute_expression,
      $.command_substitution,
      $.variable_substitution,
      $.expression_substitution,
      $.array_splice,
      $.eggex,
      $.null_literal,
      $.boolean_literal,
    ),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    unary_expression: $ => prec(PREC.UNARY, choice(
      seq('-', $._expression),
      seq('+', $._expression),
      seq('~', $._expression),
      seq('not', $._expression),
      seq('!', $._expression),
    )),

    binary_expression: $ => choice(
      // Arithmetic
      prec.left(PREC.ADD, seq($._expression, choice('+', '-'), $._expression)),
      prec.left(PREC.MUL, seq($._expression, choice('*', '/', '//', '%'), $._expression)),
      prec.right(PREC.POWER, seq($._expression, '**', $._expression)),
      // String concatenation
      prec.left(PREC.ADD, seq($._expression, '++', $._expression)),
      // Bitwise
      prec.left(PREC.BITOR, seq($._expression, '|', $._expression)),
      prec.left(PREC.BITXOR, seq($._expression, '^', $._expression)),
      prec.left(PREC.BITAND, seq($._expression, '&', $._expression)),
      prec.left(PREC.SHIFT, seq($._expression, choice('<<', '>>'), $._expression)),
      // Logical
      prec.left(PREC.AND, seq($._expression, choice('and', '&&'), $._expression)),
      prec.left(PREC.OR, seq($._expression, choice('or', '||'), $._expression)),
    ),

    comparison_expression: $ => prec.left(PREC.COMPARE, seq(
      $._expression,
      repeat1(seq(
        choice(
          '===', '!==', '~==',
          '<', '>', '<=', '>=',
          'in', 'is',
          seq('not', 'in'),
          seq('is', 'not'),
          '~', '!~', '~~', '!~~',
        ),
        $._expression,
      )),
    )),

    ternary_expression: $ => prec.right(PREC.LOWEST, seq(
      $._expression,
      'if',
      $._expression,
      'else',
      $._expression,
    )),

    range_expression: $ => prec.left(PREC.COMPARE, seq(
      $._expression,
      choice('..<', '..='),
      $._expression,
    )),

    call_expression: $ => prec(PREC.POSTFIX, seq(
      $._primary_expression,
      '(',
      optional($.argument_list),
      ')',
    )),

    argument_list: $ => seq(
      commaSep1($._argument),
      optional(seq(';', commaSep1($.named_argument))),
    ),

    _argument: $ => choice(
      $._expression,
      $.spread_argument,
    ),

    named_argument: $ => seq(
      $.identifier,
      '=',
      $._expression,
    ),

    spread_argument: $ => seq('...', $._expression),

    subscript_expression: $ => prec(PREC.POSTFIX, seq(
      $._primary_expression,
      '[',
      $._expression,
      ']',
    )),

    attribute_expression: $ => prec(PREC.POSTFIX, seq(
      $._primary_expression,
      choice('.', '->'),
      $.identifier,
    )),

    // =========================================================================
    // Literals
    // =========================================================================
    null_literal: $ => 'null',

    boolean_literal: $ => choice('true', 'false'),

    number: $ => choice(
      $.integer,
      $.float,
    ),

    integer: $ => choice(
      // Decimal: 42, 1_000_000
      /[0-9](_?[0-9])*/,
      // Binary: 0b1010
      /0[bB](_?[01])+/,
      // Octal: 0o755
      /0[oO](_?[0-7])+/,
      // Hex: 0xff
      /0[xX](_?[0-9a-fA-F])+/,
    ),

    float: $ => /[0-9](_?[0-9])*(\.[0-9](_?[0-9])*)?([eE][+-]?[0-9]+)?/,

    list_literal: $ => seq(
      '[',
      optional(commaSep($._expression)),
      optional(','),
      ']',
    ),

    dict_literal: $ => seq(
      '{',
      optional(commaSep($.dict_pair)),
      optional(','),
      '}',
    ),

    dict_pair: $ => seq(
      choice($.identifier, $.string),
      ':',
      $._expression,
    ),

    // =========================================================================
    // Strings
    // =========================================================================
    string: $ => choice(
      $.single_quoted_string,
      $.double_quoted_string,
      $.dollar_single_quoted_string,
      $.raw_string,
      $.multiline_single_string,
      $.multiline_double_string,
      $.j_string,
    ),

    single_quoted_string: $ => seq(
      "'",
      repeat(choice(
        /[^'\\]+/,
        $.escape_sequence,
      )),
      "'",
    ),

    double_quoted_string: $ => seq(
      '"',
      repeat(choice(
        /[^"\\$`]+/,
        $.escape_sequence,
        $.variable_substitution,
        $.command_substitution,
        $.expression_substitution,
      )),
      '"',
    ),

    dollar_single_quoted_string: $ => seq(
      "$'",
      repeat(choice(
        /[^'\\]+/,
        $.escape_sequence,
      )),
      "'",
    ),

    raw_string: $ => seq(
      "r'",
      /[^']*/,
      "'",
    ),

    multiline_single_string: $ => seq(
      choice("'''", "u'''", "b'''", "r'''"),
      repeat(choice(
        /[^']+/,
        seq("'", /[^']/),
        seq("''", /[^']/),
      )),
      "'''",
    ),

    multiline_double_string: $ => seq(
      choice('"""', '$"""'),
      repeat(choice(
        /[^"\\$`]+/,
        seq('"', /[^"]/),
        seq('""', /[^"]/),
        $.escape_sequence,
        $.variable_substitution,
        $.command_substitution,
        $.expression_substitution,
      )),
      '"""',
    ),

    j_string: $ => seq(
      'j"',
      repeat(choice(
        /[^"\\]+/,
        $.escape_sequence,
      )),
      '"',
    ),

    escape_sequence: $ => token(choice(
      // Single character escapes
      /\\[\\'"abefnrtv0]/,
      // Hex escapes: \xff
      /\\x[0-9a-fA-F]{1,2}/,
      // Unicode escapes: \u{1234}
      /\\u\{[0-9a-fA-F]{1,6}\}/,
      // Legacy unicode: \u1234
      /\\u[0-9a-fA-F]{4}/,
      // Octal: \377
      /\\[0-7]{1,3}/,
    )),

    // =========================================================================
    // Substitutions
    // =========================================================================
    variable_substitution: $ => choice(
      // Simple: $var, $1, $?, $@, etc.
      $.simple_variable,
      // Braced: ${var}, ${var:-default}, etc.
      $.braced_variable,
    ),

    simple_variable: $ => token(seq(
      '$',
      choice(
        /[a-zA-Z_][a-zA-Z0-9_]*/,  // $name
        /[0-9]/,                    // $1
        /[!@#$*?\-]/,              // special vars
      ),
    )),

    braced_variable: $ => seq(
      '${',
      optional(choice('#', '!')),  // prefix operators
      $.identifier,
      optional($._variable_operation),
      '}',
    ),

    _variable_operation: $ => choice(
      // Test operators: ${var:-default}
      seq(choice(':-', '-', ':=', '=', ':?', '?', ':+', '+'), optional($.word)),
      // String operators: ${var%pattern}
      seq(choice('%', '%%', '#', '##'), optional($.word)),
      // Substitution: ${var/pat/replace}
      seq('/', optional('/'), optional($.word), optional(seq('/', optional($.word)))),
      // Slice: ${var:offset:length}
      seq(':', $._expression, optional(seq(':', $._expression))),
      // Array index: ${arr[i]}
      seq('[', choice($._expression, '@', '*'), ']'),
    ),

    command_substitution: $ => choice(
      seq('$(', repeat($._statement), ')'),
      // Backtick form (deprecated but supported)
      seq('`', /[^`]*/, '`'),
    ),

    expression_substitution: $ => seq(
      '$[',
      $._expression,
      ']',
    ),

    array_splice: $ => choice(
      // @array
      seq('@', $.identifier),
      // @[expr]
      seq('@[', $._expression, ']'),
    ),

    // =========================================================================
    // Eggex (Regular Expressions)
    // =========================================================================
    eggex: $ => seq(
      '/',
      repeat($._regex_part),
      '/',
      optional($.regex_flags),
    ),

    _regex_part: $ => choice(
      $.regex_literal,
      $.regex_char_class,
      $.regex_group,
      $.regex_quantifier,
      $.regex_anchor,
      $.regex_splice,
    ),

    regex_literal: $ => /[^\/\[\](){}*+?|\\^$\s]+/,

    regex_char_class: $ => seq(
      '[',
      optional('^'),
      repeat(choice(
        /[^\]\\]/,
        $.escape_sequence,
        $.regex_range,
      )),
      ']',
    ),

    regex_range: $ => /.-./,

    regex_group: $ => seq(
      choice(
        '(',
        seq('<', optional('capture'), optional($.identifier)),
      ),
      repeat($._regex_part),
      choice(')', '>'),
    ),

    regex_quantifier: $ => choice(
      '*',
      '+',
      '?',
      seq('{', /[0-9]+/, optional(seq(',', optional(/[0-9]+/))), '}'),
    ),

    regex_anchor: $ => choice('^', '$', '%start', '%end'),

    regex_splice: $ => seq('@', $.identifier),

    regex_flags: $ => seq(';', repeat($.identifier)),

    // =========================================================================
    // Redirections
    // =========================================================================
    redirect: $ => seq(
      optional($.file_descriptor),
      choice(
        // Input redirections
        seq('<', $.word),
        seq('<<', $.heredoc_redirect),
        seq('<<<', $.word),
        // Output redirections
        seq('>', $.word),
        seq('>>', $.word),
        seq('>|', $.word),
        seq('&>', $.word),
        seq('&>>', $.word),
        // Descriptor redirections
        seq('>&', choice($.file_descriptor, '-')),
        seq('<&', choice($.file_descriptor, '-')),
        seq('<>', $.word),
      ),
    ),

    file_descriptor: $ => /[0-9]+/,

    heredoc_redirect: $ => seq(
      optional('-'),
      $.heredoc_delimiter,
    ),

    heredoc_delimiter: $ => choice(
      $.identifier,
      $.single_quoted_string,
      $.double_quoted_string,
    ),

    // =========================================================================
    // Variable Assignment
    // =========================================================================
    variable_assignment: $ => seq(
      $.identifier,
      optional(seq('[', $._expression, ']')),
      choice('=', '+='),
      optional($.word),
    ),

    // =========================================================================
    // Words and Identifiers
    // =========================================================================
    word: $ => choice(
      $.bare_word,
      $.string,
      $.variable_substitution,
      $.command_substitution,
      $.expression_substitution,
      $.brace_expansion,
      $.tilde_expansion,
    ),

    _expression_word: $ => choice(
      $.string,
      $.variable_substitution,
      $.command_substitution,
      $.expression_substitution,
    ),

    bare_word: $ => /[a-zA-Z0-9_\-\.\/]+/,

    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    brace_expansion: $ => seq(
      '{',
      choice(
        // Sequence: {1..10} or {a..z}
        seq($._brace_element, '..', $._brace_element, optional(seq('..', $._brace_element))),
        // Alternatives: {a,b,c}
        seq($._brace_element, repeat1(seq(',', $._brace_element))),
      ),
      '}',
    ),

    _brace_element: $ => choice(
      /[a-zA-Z0-9_\-]+/,
      $.variable_substitution,
    ),

    tilde_expansion: $ => seq(
      '~',
      optional(/[a-zA-Z_][a-zA-Z0-9_]*/),
    ),

    // =========================================================================
    // Word Array Literals
    // =========================================================================
    word_array: $ => seq(
      ':|',
      repeat($.word),
      '|',
    ),
  },
});

// Helper function for comma-separated lists
function commaSep(rule) {
  return optional(commaSep1(rule));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

