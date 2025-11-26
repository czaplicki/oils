; Tags for code navigation (ctags-like functionality)

; Functions
(func_definition
  name: (identifier) @name) @definition.function

; Procedures
(proc_definition
  name: (identifier) @name) @definition.function

; Shell functions
(function_definition
  (identifier) @name) @definition.function

; Variables (global scope)
(var_declaration
  (identifier) @name) @definition.variable

(const_declaration
  (identifier) @name) @definition.constant

