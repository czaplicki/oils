; Local variable definitions and scopes for YSH
; Used for go-to-definition and reference finding

; =============================================================================
; Scopes
; =============================================================================

; Function and procedure bodies create scopes
(proc_definition) @scope
(func_definition) @scope
(function_definition) @scope

; Block scopes
(brace_group) @scope
(subshell) @scope

; Control flow bodies create scopes
(if_statement) @scope
(for_statement) @scope
(while_statement) @scope
(case_arm) @scope

; =============================================================================
; Definitions
; =============================================================================

; Variable declarations
(var_declaration
  (identifier) @definition.variable)

(const_declaration
  (identifier) @definition.variable)

; Function and procedure names
(proc_definition
  name: (identifier) @definition.function)

(func_definition
  name: (identifier) @definition.function)

(function_definition
  (identifier) @definition.function)

; Parameters are definitions within their scope
(param
  (identifier) @definition.parameter)

(named_param
  (identifier) @definition.parameter)

(rest_param
  (identifier) @definition.parameter)

; For loop variables
(for_statement
  (identifier) @definition.variable)

; Variable assignments (shell style)
(variable_assignment
  (identifier) @definition.variable)

; =============================================================================
; References
; =============================================================================

; Variable references
(identifier) @reference

; Variable substitutions reference variables
(simple_variable) @reference
(braced_variable
  (identifier) @reference)

