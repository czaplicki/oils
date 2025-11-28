# Change Log

All notable changes to the "ysh-language" extension will be documented in this file.

## [0.1.0] - 2024-11-27

### Added

- Initial release
- Syntax highlighting for YSH via TextMate grammar
- Language Server Protocol (LSP) support:
  - Go-to-definition for procs, funcs, variables, and parameters
  - Cross-file navigation via `source` statement resolution
  - Dict key navigation (e.g., `CONFIG.project` → dict definition)
  - Variable detection in strings (`$var`, `$[expr]`)
  - Hover information for keywords and builtins
  - Auto-completion for keywords, builtins, and symbols
  - Document symbols (outline view)
  - Diagnostics (parse error reporting)
- Code snippets for common YSH patterns
- Support for `.ysh` and `.osh` file extensions
- Debug commands: `YSH: Show Parse Tree`, `YSH: Show Symbols`, `YSH: Show Debug Info`

