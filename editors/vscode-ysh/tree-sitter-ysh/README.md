# tree-sitter-ysh

Tree-sitter grammar for YSH (Oils Shell).

YSH is the new shell language from the [Oils project](https://www.oilshell.org/). It's designed to be a better shell language with proper expressions, types, and modern syntax.

## Features

This grammar supports:

- **YSH-specific syntax**: `proc`, `func`, `var`, `setvar`, `const`, `call`
- **Shell commands**: pipelines, redirections, control flow
- **Expressions**: arithmetic, boolean, list/dict literals
- **String literals**: `''`, `""`, `$''`, `r''`, `u''`, `b''`, `'''`, `"""`
- **Substitutions**: `$var`, `${var}`, `$(cmd)`, `$[expr]`, `@array`
- **Eggex**: Regular expression literals `/pattern/`
- **Here-documents**: `<<EOF`, `<<<` strings

## Installation

### npm

```bash
npm install tree-sitter-ysh
```

### Cargo

```toml
[dependencies]
tree-sitter-ysh = "0.1"
```

## Usage

### Node.js

```javascript
const Parser = require('tree-sitter');
const YSH = require('tree-sitter-ysh');

const parser = new Parser();
parser.setLanguage(YSH);

const sourceCode = `
proc greet (name) {
  echo "Hello, $name!"
}

var x = 42
if (x > 0) {
  greet 'world'
}
`;

const tree = parser.parse(sourceCode);
console.log(tree.rootNode.toString());
```

### Rust

```rust
use tree_sitter::Parser;

fn main() {
    let mut parser = Parser::new();
    parser.set_language(tree_sitter_ysh::language()).unwrap();

    let source_code = r#"
proc greet (name) {
  echo "Hello, $name!"
}
"#;

    let tree = parser.parse(source_code, None).unwrap();
    println!("{}", tree.root_node().to_sexp());
}
```

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
npm test
```

### Generating Parser

After modifying `grammar.js`:

```bash
npx tree-sitter generate
```

## References

- [Oils Shell](https://www.oilshell.org/)
- [YSH Language Tour](https://www.oilshell.org/release/latest/doc/ysh-tour.html)
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)

## License

Apache-2.0

