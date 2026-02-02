{
  description = "YSH Language Support for VSCode/VSCodium";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          name = "vscode-ysh-dev";

          buildInputs = with pkgs; [
            # Node.js for extension development
            nodejs_22

            # Tree-sitter CLI for grammar development
            tree-sitter

            # For building native modules
            python3

            # Useful tools
            jq
          ];

          shellHook = ''
            echo "🛢️  YSH VSCode Extension Development Environment"
            echo ""
            echo "Available commands:"
            echo "  npm install      - Install dependencies"
            echo "  npm run compile  - Compile TypeScript"
            echo "  npm run watch    - Watch mode compilation"
            echo ""
            echo "To test the extension:"
            echo "  1. Open this folder in VSCodium: codium ."
            echo "  2. Press F5 to launch Extension Development Host"
            echo "  3. Create a .ysh file in the new window"
            echo ""

            # Ensure node_modules/.bin is in PATH
            export PATH="$PWD/node_modules/.bin:$PWD/server/node_modules/.bin:$PATH"
          '';
        };

        # Package for the lsp server
        packages.ysh-lsp = pkgs.buildNpmPackage {
          pname = "ysh-lsp";
          version = "0.1.0";

          src = ./server; 

          npmDepsHash = "sha256-OyAHp1Vs9FJ49qAtbpdBifWp1Lzb1YZiLVi68TDf+J4=";

          nativeBuildInputs = [ pkgs.makeWrapper ];

          buildPhase = ''
            npm run compile
          '';

          installPhase = ''
            # 1. Create a private 'lib' directory in the store
            mkdir -p $out/lib/ysh-lsp
    
            # 2. Copy the compiled JS (the 'out' folder) and the runtime node_modules
            # We copy the whole 'out' folder to keep relative imports working
            cp -r out node_modules package.json $out/lib/ysh-lsp/

            # 3. Create the binary wrapper
            # This points to the entry point while ensuring it runs from the lib dir
            makeWrapper ${pkgs.nodejs}/bin/node $out/bin/ysh-lsp \
              --add-flags "$out/lib/ysh-lsp/out/server.js --stdio"
          '';
        };

        # Package for the tree-sitter grammar
        packages.tree-sitter-ysh = pkgs.stdenv.mkDerivation {
          pname = "tree-sitter-ysh";
          version = "0.1.0";
          src = ./tree-sitter-ysh;

          nativeBuildInputs = with pkgs; [
            nodejs_22
            tree-sitter
          ];

          buildPhase = ''
            tree-sitter generate
          '';

          installPhase = ''
            mkdir -p $out
            cp -r src $out/
            cp grammar.js $out/
            cp package.json $out/
          '';
        };
      }
    );
}

