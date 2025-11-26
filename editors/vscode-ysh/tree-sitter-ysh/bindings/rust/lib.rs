//! Tree-sitter grammar for YSH (Oils Shell)

use tree_sitter::Language;

extern "C" {
    fn tree_sitter_ysh() -> Language;
}

/// Get the tree-sitter [Language][] for YSH.
///
/// [Language]: https://docs.rs/tree-sitter/*/tree_sitter/struct.Language.html
pub fn language() -> Language {
    unsafe { tree_sitter_ysh() }
}

/// The content of the [`node-types.json`][] file for this grammar.
///
/// [`node-types.json`]: https://tree-sitter.github.io/tree-sitter/using-parsers#static-node-types
pub const NODE_TYPES: &str = include_str!("../../src/node-types.json");

/// The syntax highlighting queries for this grammar.
pub const HIGHLIGHTS_QUERY: &str = include_str!("../../queries/highlights.scm");

/// The local variable queries for this grammar.
pub const LOCALS_QUERY: &str = include_str!("../../queries/locals.scm");

#[cfg(test)]
mod tests {
    #[test]
    fn test_can_load_grammar() {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(super::language())
            .expect("Error loading YSH grammar");
    }
}

