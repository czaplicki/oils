{
  "targets": [
    {
      "target_name": "tree_sitter_ysh_binding",
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except",
      ],
      "include_dirs": [
        "src",
      ],
      "sources": [
        "bindings/node/binding.cc",
        "src/parser.c",
        "src/scanner.c",
      ],
      "cflags_c": [
        "-std=c11",
        "-Wno-unused-value",
      ],
      "conditions": [
        ["OS!='win'", {
          "cflags_c": [
            "-Wno-implicit-fallthrough",
            "-Wno-sign-compare",
          ],
        }],
        ["OS=='mac'", {
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "10.9",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++14",
          },
        }],
      ],
    },
  ],
}

