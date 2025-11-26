; Tree-sitter highlighting queries for YSH
; Based on Oils syntax from frontend/lexer_def.py

; =============================================================================
; Comments
; =============================================================================

(comment) @comment
(doc_comment) @comment.documentation

; =============================================================================
; Keywords
; =============================================================================

; YSH-specific keywords
[
  "var"
  "const"
  "setvar"
  "setglobal"
  "proc"
  "func"
  "typed"
  "call"
] @keyword

; Control flow keywords
[
  "if"
  "then"
  "else"
  "elif"
  "fi"
  "for"
  "in"
  "do"
  "done"
  "while"
  "until"
  "case"
  "esac"
  "break"
  "continue"
  "return"
  "exit"
] @keyword.control

; Function definition
"function" @keyword.function

; Time keyword
"time" @keyword

; Expression keywords
[
  "and"
  "or"
  "not"
  "is"
] @keyword.operator

; =============================================================================
; Literals
; =============================================================================

(null_literal) @constant.builtin
(boolean_literal) @constant.builtin

(integer) @number
(float) @number.float

; Strings
(single_quoted_string) @string
(double_quoted_string) @string
(dollar_single_quoted_string) @string.special
(raw_string) @string
(multiline_single_string) @string
(multiline_double_string) @string
(j_string) @string.special

(escape_sequence) @string.escape

; =============================================================================
; Variables and Identifiers
; =============================================================================

(identifier) @variable

; Variable substitutions
(simple_variable) @variable.special
(braced_variable
  (identifier) @variable.special)

; Special variables
((simple_variable) @variable.builtin
  (#match? @variable.builtin "^\\$[0-9@#$!?*-]$"))

; =============================================================================
; Functions and Procedures
; =============================================================================

; Function/procedure definitions
(proc_definition
  name: (identifier) @function.definition)

(func_definition
  name: (identifier) @function.definition)

(function_definition
  (identifier) @function.definition)

; Function calls
(call_expression
  (identifier) @function.call)

(call_expression
  (attribute_expression
    (identifier) @function.method))

; Command names (builtins highlighted differently)
(command_name
  (word
    (bare_word) @function.call))

; =============================================================================
; Parameters
; =============================================================================

(param
  (identifier) @variable.parameter)

(named_param
  (identifier) @variable.parameter)

(rest_param
  (identifier) @variable.parameter)

; =============================================================================
; Types
; =============================================================================

(type_expression
  (identifier) @type)

(type_annotation
  (type_expression
    (identifier) @type))

; =============================================================================
; Operators
; =============================================================================

; Arithmetic operators
[
  "+"
  "-"
  "*"
  "/"
  "//"
  "%"
  "**"
  "++"
] @operator

; Comparison operators
[
  "==="
  "!=="
  "~=="
  "<"
  ">"
  "<="
  ">="
  "~"
  "!~"
  "~~"
  "!~~"
] @operator

; Assignment operators
[
  "="
  "+="
  "-="
  "*="
  "/="
  "//="
  "%="
  "**="
  "<<="
  ">>="
  "&="
  "|="
  "^="
] @operator

; Bitwise operators
[
  "&"
  "|"
  "^"
  "<<"
  ">>"
] @operator

; Logical operators
[
  "&&"
  "||"
  "!"
] @operator

; Range operators
[
  "..<"
  "..="
] @operator

; =============================================================================
; Punctuation
; =============================================================================

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ","
  ";"
  ":"
] @punctuation.delimiter

[
  "."
  "->"
] @punctuation.delimiter

; =============================================================================
; Command/Shell specific
; =============================================================================

; Pipe operators
[
  "|"
  "|&"
] @operator

; Control operators
[
  "&&"
  "||"
] @operator

; Background operator
"&" @operator

; =============================================================================
; Redirections
; =============================================================================

(redirect
  ["<" ">" ">>" "<<" "<<<" ">&" "<&" "<>" ">|" "&>" "&>>"] @operator)

(file_descriptor) @number

(heredoc_delimiter) @string.special

; =============================================================================
; Substitutions
; =============================================================================

(command_substitution
  ["$(" ")"] @punctuation.special)

(expression_substitution
  ["$[" "]"] @punctuation.special)

(array_splice
  ["@" "@[" "]"] @punctuation.special)

; =============================================================================
; Eggex (Regular Expressions)
; =============================================================================

(eggex
  "/" @punctuation.special)

(regex_literal) @string.regex

(regex_char_class) @string.regex

(regex_quantifier) @operator

(regex_anchor) @keyword

(regex_flags
  (identifier) @attribute)

; =============================================================================
; Word Arrays
; =============================================================================

(word_array
  [":|" "|"] @punctuation.special)

; =============================================================================
; Brace Expansion
; =============================================================================

(brace_expansion
  ["{" "}" ","] @punctuation.special)

; =============================================================================
; Tilde Expansion
; =============================================================================

(tilde_expansion) @string.special

; =============================================================================
; Glob Patterns
; =============================================================================

(glob_pattern) @string.special

; Pattern in case statement
(pattern) @string.special

