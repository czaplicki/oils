# YSH Language Support for VS Code

This extension provides language support for YSH (Oils Shell) in Visual Studio Code.

## Features

### Syntax Highlighting

Full syntax highlighting for YSH files (`.ysh`) including:

- YSH-specific keywords: `proc`, `func`, `var`, `setvar`, `const`, `call`
- Shell control flow: `if`, `for`, `while`, `case`
- All string types: `''`, `""`, `$''`, `r''`, `u''`, `b''`, `'''`, `"""`
- Variable substitutions: `$var`, `${var}`, `$[expr]`
- Eggex regular expressions: `/pattern/`
- Command substitutions: `$(cmd)`

### IntelliSense

- **Go to Definition**: Navigate to procedure, function, and variable definitions
- **Hover Information**: Documentation for keywords and builtins
- **Completions**: Auto-complete keywords, builtins, and local symbols
- **Document Symbols**: Outline view of procedures and functions

### Diagnostics

- Parse error detection and reporting
- Inline error highlighting

### Snippets

Quick templates for common YSH patterns:
- `proc` - Procedure definition
- `func` - Function definition
- `var` - Variable declaration
- `if` - If statement
- `for` - For loop
- And more...

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "YSH"
4. Click Install

### From Source

1. Clone the repository
2. Navigate to `editors/vscode-ysh`
3. Run `npm install`
4. Run `npm run compile`
5. Press F5 to launch the extension in a new VS Code window

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `ysh.enable` | `true` | Enable YSH language features |
| `ysh.trace.server` | `off` | Trace communication with the language server |
| `ysh.oilsPath` | `oils-for-unix` | Path to the Oils interpreter |
| `ysh.maxNumberOfProblems` | `100` | Maximum number of problems to report |
| `ysh.lint.enable` | `true` | Enable linting |

## Usage

### File Extensions

The extension activates for files with the following extensions:
- `.ysh` - YSH files
- `.osh` - OSH files (bash-compatible)

### Example YSH Code

```ysh
#!/usr/bin/env ysh

# Define a procedure
proc greet (name) {
  echo "Hello, $name!"
}

# Define a function
func add(a, b) {
  return (a + b)
}

# Use YSH expressions
var x = 42
var result = $[add(x, 8)]

if (result > 0) {
  greet 'World'
}

# Iterate over a list
var items = ['apple', 'banana', 'cherry']
for item in (items) {
  echo "Fruit: $item"
}
```

## Commands

| Command | Description |
|---------|-------------|
| `YSH: Restart Language Server` | Restart the language server |
| `YSH: Show Parse Tree` | Show the parse tree of the current file (debugging) |

## Requirements

- VS Code 1.75.0 or higher
- Node.js 18 or higher (for development)

## Related Projects

- [Oils Shell](https://www.oilshell.org/) - The Oils project homepage
- [YSH Language Tour](https://www.oilshell.org/release/latest/doc/ysh-tour.html)
- [tree-sitter-ysh](./tree-sitter-ysh/) - Tree-sitter grammar for YSH

## Contributing

Contributions are welcome! Please see the main [Oils repository](https://github.com/oilshell/oil) for contribution guidelines.

## License

Apache-2.0 - See [LICENSE](../../LICENSE.txt) for details.

