#include <napi.h>

typedef struct TSLanguage TSLanguage;

extern "C" TSLanguage *tree_sitter_ysh();

// "tree-sitter", "currentLanguage" hance the readability of types in
// the generated code.
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports["name"] = Napi::String::New(env, "ysh");
  auto language = Napi::External<TSLanguage>::New(env, tree_sitter_ysh());
  exports["language"] = language;
  return exports;
}

NODE_API_MODULE(tree_sitter_ysh_binding, Init)

