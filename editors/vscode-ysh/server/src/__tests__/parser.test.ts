/**
 * Parser Tests for YSH Language Server
 *
 * Tests parser against real-world YSH scripts to ensure:
 * 1. Parser doesn't crash on complex files
 * 2. Symbols are extracted correctly
 * 3. Cross-file source handling works
 */

import * as fs from 'fs';
import * as path from 'path';
import { YSHParser, ParseResult, ASTNode } from '../parser';
import { SymbolTable, WorkspaceSymbols } from '../symbols';
import { extractSourcePaths, resolveSourcePath } from '../sources';
import { getWordAtPosition } from '../definition';

// Test timeout - fail fast if parser hangs
jest.setTimeout(5000);

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string {
    const filePath = path.join(FIXTURES_DIR, name);
    console.log(`Loading fixture: ${filePath}`);
    return fs.readFileSync(filePath, 'utf-8');
}

function countNodeTypes(node: ASTNode, counts: Map<string, number> = new Map()): Map<string, number> {
    counts.set(node.type, (counts.get(node.type) || 0) + 1);
    if (node.children) {
        for (const child of node.children) {
            countNodeTypes(child, counts);
        }
    }
    return counts;
}

function findNodesOfType(node: ASTNode, type: string, results: ASTNode[] = []): ASTNode[] {
    if (node.type === type) {
        results.push(node);
    }
    if (node.children) {
        for (const child of node.children) {
            findNodesOfType(child, type, results);
        }
    }
    return results;
}

function debugParse(code: string, parser: YSHParser): ParseResult {
    console.log(`Parsing ${code.length} characters...`);
    const start = Date.now();
    const result = parser.parse(code);
    const elapsed = Date.now() - start;
    console.log(`Parse completed in ${elapsed}ms`);
    console.log(`  Tree type: ${result.tree.type}`);
    console.log(`  Children: ${result.tree.children?.length || 0}`);
    console.log(`  Errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
        console.log(`  First error: ${result.errors[0].message}`);
    }
    return result;
}

describe('YSH Parser', () => {
    let parser: YSHParser;

    beforeEach(() => {
        parser = new YSHParser();
    });

    describe('Basic Parsing', () => {
        test('parses empty input', () => {
            const result = debugParse('', parser);
            expect(result.tree.type).toBe('program');
            expect(result.tree.children).toHaveLength(0);
            expect(result.errors).toHaveLength(0);
        });

        test('parses simple command', () => {
            const result = debugParse('echo hello', parser);
            expect(result.tree.type).toBe('program');
            expect(result.tree.children).toHaveLength(1);
            expect(result.tree.children![0].type).toBe('simple_command');
            expect(result.tree.children![0].name).toBe('echo');
        });

        test('parses comments', () => {
            const result = debugParse('# This is a comment\necho hello', parser);
            expect(result.errors).toHaveLength(0);
        });
    });

    describe('Variable Declarations', () => {
        test('parses var declaration', () => {
            const result = debugParse('var x = 42', parser);
            const vars = findNodesOfType(result.tree, 'var_declaration');
            expect(vars).toHaveLength(1);
            expect(vars[0].name).toBe('x');
        });

        test('parses const declaration', () => {
            const result = debugParse("const NAME = 'test'", parser);
            const consts = findNodesOfType(result.tree, 'const_declaration');
            expect(consts).toHaveLength(1);
            expect(consts[0].name).toBe('NAME');
        });

        test('parses setvar statement', () => {
            const result = debugParse('setvar x = 10', parser);
            const setvars = findNodesOfType(result.tree, 'setvar');
            expect(setvars).toHaveLength(1);
            expect(setvars[0].name).toBe('x');
        });

        test('parses setglobal statement', () => {
            const result = debugParse('setglobal GLOBAL_VAR = "value"', parser);
            const setglobals = findNodesOfType(result.tree, 'setglobal');
            expect(setglobals).toHaveLength(1);
            expect(setglobals[0].name).toBe('GLOBAL_VAR');
        });
    });

    describe('Dict Literals', () => {
        test('parses simple dict literal', () => {
            const result = debugParse("const obj = { key: 'value' }", parser);
            expect(result.errors).toHaveLength(0);
            const consts = findNodesOfType(result.tree, 'const_declaration');
            expect(consts).toHaveLength(1);
            expect(consts[0].name).toBe('obj');
        });

        test('parses multiline dict literal', () => {
            const code = `const CONFIG = {
  name: 'test',
  value: 42,
  nested: {
    inner: 'data',
  },
}`;
            const result = debugParse(code, parser);
            expect(result.errors).toHaveLength(0);
            const consts = findNodesOfType(result.tree, 'const_declaration');
            expect(consts).toHaveLength(1);
            expect(consts[0].name).toBe('CONFIG');
        });
    });

    describe('Proc Definitions', () => {
        test('parses simple proc', () => {
            const code = `proc greet (name) {
  echo "Hello, $name"
}`;
            const result = debugParse(code, parser);
            const procs = findNodesOfType(result.tree, 'proc_definition');
            expect(procs).toHaveLength(1);
            expect(procs[0].name).toBe('greet');
            expect(procs[0].params).toContain('name');
        });

        test('parses proc with named params', () => {
            const code = `proc wait_for_ssh (instance, project, zone; max_attempts=30, interval=10) {
  echo "Waiting..."
}`;
            const result = debugParse(code, parser);
            expect(result.errors).toHaveLength(0);
            const procs = findNodesOfType(result.tree, 'proc_definition');
            expect(procs).toHaveLength(1);
            expect(procs[0].name).toBe('wait_for_ssh');
        });
    });

    describe('Try Blocks', () => {
        test('parses try block', () => {
            const code = `try {
  var result = $(risky-command)
}`;
            const result = debugParse(code, parser);
            expect(result.errors).toHaveLength(0);
            const tries = findNodesOfType(result.tree, 'try_statement');
            expect(tries).toHaveLength(1);
        });
    });

    describe('Control Flow', () => {
        test('parses if with expression condition', () => {
            const code = `if (x > 0) {
  echo "positive"
}`;
            const result = debugParse(code, parser);
            expect(result.errors).toHaveLength(0);
        });

        test('parses while with expression condition', () => {
            const code = `while (counter < max) {
  setvar counter = counter + 1
}`;
            const result = debugParse(code, parser);
            expect(result.errors).toHaveLength(0);
        });

        test('parses while true loop', () => {
            const code = `while true {
  echo "loop"
  break
}`;
            const result = debugParse(code, parser);
            expect(result.errors).toHaveLength(0);
        });
    });
});

describe('Real-World Scripts', () => {
    let parser: YSHParser;

    beforeEach(() => {
        parser = new YSHParser();
    });

    test('parses simple.ysh without errors', () => {
        const code = loadFixture('simple.ysh');
        const result = debugParse(code, parser);

        expect(result.tree.type).toBe('program');
        expect(result.tree.children!.length).toBeGreaterThan(0);

        const procs = findNodesOfType(result.tree, 'proc_definition');
        console.log(`Found ${procs.length} procs: ${procs.map(p => p.name).join(', ')}`);
        expect(procs.length).toBeGreaterThan(0);
    });

    test('parses lib/config.ysh without crashing', () => {
        const code = loadFixture('lib/config.ysh');
        const result = debugParse(code, parser);

        expect(result.tree.type).toBe('program');
        expect(result.tree.children!.length).toBeGreaterThan(0);

        const consts = findNodesOfType(result.tree, 'const_declaration');
        console.log(`Found ${consts.length} consts: ${consts.map(c => c.name).join(', ')}`);
        expect(consts.length).toBeGreaterThanOrEqual(4);

        const procs = findNodesOfType(result.tree, 'proc_definition');
        console.log(`Found ${procs.length} procs: ${procs.map(p => p.name).join(', ')}`);
        expect(procs.length).toBeGreaterThan(10);
    });

    test('parses caddy.ysh without crashing', () => {
        const code = loadFixture('caddy.ysh');
        const result = debugParse(code, parser);

        expect(result.tree.type).toBe('program');
        expect(result.tree.children!.length).toBeGreaterThan(0);

        const procs = findNodesOfType(result.tree, 'proc_definition');
        console.log(`Found ${procs.length} procs: ${procs.map(p => p.name).join(', ')}`);
        expect(procs.length).toBeGreaterThan(0);

        // Should find source statement
        const commands = findNodesOfType(result.tree, 'simple_command');
        const sourceCmd = commands.find(c => c.name === 'source');
        expect(sourceCmd).toBeDefined();
    });
});

describe('Symbol Table', () => {
    let parser: YSHParser;

    beforeEach(() => {
        parser = new YSHParser();
    });

    test('builds symbol table from simple code', () => {
        const code = `const NAME = 'test'
var counter = 0
proc greet (msg) {
  echo "$msg"
}`;
        const result = debugParse(code, parser);
        const symbols = new SymbolTable();
        symbols.setText(code);
        symbols.buildFromParseResult(result);

        console.log(`Symbols found: ${symbols.getAllSymbols().map(s => s.name).join(', ')}`);

        expect(symbols.lookup('NAME')).toHaveLength(1);
        expect(symbols.lookup('counter')).toHaveLength(1);
        expect(symbols.lookup('greet')).toHaveLength(1);
    });

    test('tracks nested variables', () => {
        const code = `proc test {
  var inner = 1
  while (inner < 10) {
    setvar inner = inner + 1
  }
}`;
        const result = debugParse(code, parser);
        const symbols = new SymbolTable();
        symbols.setText(code);
        symbols.buildFromParseResult(result);

        console.log(`Symbols found: ${symbols.getAllSymbols().map(s => `${s.name}(${s.detail})`).join(', ')}`);

        expect(symbols.lookup('inner').length).toBeGreaterThan(0);
    });

    test('builds symbol table from lib/config.ysh', () => {
        const code = loadFixture('lib/config.ysh');
        const result = debugParse(code, parser);
        const symbols = new SymbolTable();
        symbols.setText(code);
        symbols.buildFromParseResult(result);

        console.log(`Total symbols: ${symbols.getAllSymbols().length}`);
        console.log(`Functions: ${symbols.getFunctions().map(f => f.name).join(', ')}`);

        expect(symbols.lookup('CONFIG').length).toBeGreaterThan(0);
        expect(symbols.lookup('log').length).toBeGreaterThan(0);
        expect(symbols.getFunctions().length).toBeGreaterThan(0);
    });
});

describe('Cross-File Source Handling', () => {
    let parser: YSHParser;

    beforeEach(() => {
        parser = new YSHParser();
    });

    test('detects source statements', () => {
        const code = `source lib/config.ysh`;
        const result = debugParse(code, parser);

        const commands = findNodesOfType(result.tree, 'simple_command');
        const sourceCmd = commands.find(c => c.name === 'source');

        expect(sourceCmd).toBeDefined();
        expect(sourceCmd!.children).toBeDefined();
        expect(sourceCmd!.children!.length).toBeGreaterThan(0);

        // Path is tokenized as: lib / config.ysh (3 tokens)
        // Join them to get the full path
        const pathParts = sourceCmd!.children!.map(c => c.value);
        const fullPath = pathParts.join('');
        expect(fullPath).toBe('lib/config.ysh');
    });

    test('detects source-guard statements', () => {
        const code = `source-guard caddy.ysh || return 0`;
        const result = debugParse(code, parser);

        // source-guard is treated as a simple command
        const commands = findNodesOfType(result.tree, 'simple_command');
        const sourceGuard = commands.find(c => c.name === 'source-guard');

        expect(sourceGuard).toBeDefined();
    });

    test('caddy.ysh sources lib/config.ysh', () => {
        const caddyCode = loadFixture('caddy.ysh');
        const result = debugParse(caddyCode, parser);

        // Find source statement
        const commands = findNodesOfType(result.tree, 'simple_command');
        const sourceCmd = commands.find(c => c.name === 'source');

        expect(sourceCmd).toBeDefined();

        // Extract source path - tokens are: lib / config.ysh
        if (sourceCmd && sourceCmd.children && sourceCmd.children.length > 0) {
            const pathParts = sourceCmd.children.map(c => c.value);
            const sourcePath = pathParts.join('');
            console.log(`caddy.ysh sources: ${sourcePath}`);
            expect(sourcePath).toBe('lib/config.ysh');
        }
    });

    test('can resolve symbols across files', () => {
        // Load both files
        const configCode = loadFixture('lib/config.ysh');
        const caddyCode = loadFixture('caddy.ysh');

        // Parse config first
        const configResult = debugParse(configCode, parser);
        const configSymbols = new SymbolTable();
        configSymbols.setText(configCode);
        configSymbols.buildFromParseResult(configResult);

        // Parse caddy
        const caddyResult = debugParse(caddyCode, parser);
        const caddySymbols = new SymbolTable();
        caddySymbols.setText(caddyCode);
        caddySymbols.buildFromParseResult(caddyResult);

        // Config should have these symbols
        expect(configSymbols.lookup('CONFIG').length).toBeGreaterThan(0);
        expect(configSymbols.lookup('log').length).toBeGreaterThan(0);
        expect(configSymbols.lookup('log_section').length).toBeGreaterThan(0);
        expect(configSymbols.lookup('wait_for_ssh').length).toBeGreaterThan(0);

        // Caddy uses these symbols from config - currently local symbols only
        // But caddy should have its own procs
        expect(caddySymbols.lookup('get_instance_ip').length).toBeGreaterThan(0);
        expect(caddySymbols.lookup('verify_dns').length).toBeGreaterThan(0);
        expect(caddySymbols.lookup('wait_for_dns').length).toBeGreaterThan(0);
        expect(caddySymbols.lookup('enable_tls').length).toBeGreaterThan(0);

        console.log('Config symbols:', configSymbols.getFunctions().map(f => f.name).join(', '));
        console.log('Caddy symbols:', caddySymbols.getFunctions().map(f => f.name).join(', '));
    });
});

describe('Source Extraction', () => {
    let parser: YSHParser;

    beforeEach(() => {
        parser = new YSHParser();
    });

    test('extractSourcePaths finds source statements', () => {
        const code = `#!/usr/bin/env ysh
source lib/config.ysh
source utils/helpers.ysh
echo "hello"`;
        const result = parser.parse(code);
        const paths = extractSourcePaths(result);

        expect(paths).toContain('lib/config.ysh');
        expect(paths).toContain('utils/helpers.ysh');
        expect(paths).toHaveLength(2);
    });

    test('extractSourcePaths handles quoted paths', () => {
        const code = `source "lib/config.ysh"`;
        const result = parser.parse(code);
        const paths = extractSourcePaths(result);

        expect(paths).toContain('lib/config.ysh');
    });

    test('extractSourcePaths from caddy.ysh', () => {
        const code = loadFixture('caddy.ysh');
        const result = parser.parse(code);
        const paths = extractSourcePaths(result);

        console.log('Source paths in caddy.ysh:', paths);
        expect(paths).toContain('lib/config.ysh');
    });
});

describe('WorkspaceSymbols Cross-File Lookup', () => {
    let parser: YSHParser;

    beforeEach(() => {
        parser = new YSHParser();
    });

    test('lookupWithUri finds CONFIG in lib/config.ysh', () => {
        // Load and parse both files
        const configCode = loadFixture('lib/config.ysh');
        const caddyCode = loadFixture('caddy.ysh');

        const configUri = 'file:///test/lib/config.ysh';
        const caddyUri = 'file:///test/caddy.ysh';

        // Build symbol tables
        const configResult = parser.parse(configCode);
        const configSymbols = new SymbolTable();
        configSymbols.setText(configCode);
        configSymbols.buildFromParseResult(configResult);

        const caddyResult = parser.parse(caddyCode);
        const caddySymbols = new SymbolTable();
        caddySymbols.setText(caddyCode);
        caddySymbols.buildFromParseResult(caddyResult);

        // Create workspace symbols
        const workspace = new WorkspaceSymbols();
        workspace.addFileSymbols(configUri, configSymbols);
        workspace.addFileSymbols(caddyUri, caddySymbols);

        // Lookup CONFIG - should find it in config.ysh
        const results = workspace.lookupWithUri('CONFIG');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].uri).toBe(configUri);
        console.log('CONFIG found in:', results[0].uri);
    });

    test('lookupWithPriority prefers current document', () => {
        const code1 = `proc helper { echo "v1" }`;
        const code2 = `proc helper { echo "v2" }`;

        const uri1 = 'file:///test/file1.ysh';
        const uri2 = 'file:///test/file2.ysh';

        const result1 = parser.parse(code1);
        const symbols1 = new SymbolTable();
        symbols1.setText(code1);
        symbols1.buildFromParseResult(result1);

        const result2 = parser.parse(code2);
        const symbols2 = new SymbolTable();
        symbols2.setText(code2);
        symbols2.buildFromParseResult(result2);

        const workspace = new WorkspaceSymbols();
        workspace.addFileSymbols(uri1, symbols1);
        workspace.addFileSymbols(uri2, symbols2);

        // When searching from file1, should find file1's version first
        const resultsFromFile1 = workspace.lookupWithPriority('helper', uri1);
        expect(resultsFromFile1.length).toBeGreaterThan(0);
        expect(resultsFromFile1[0].uri).toBe(uri1);

        // When searching from file2, should find file2's version first
        const resultsFromFile2 = workspace.lookupWithPriority('helper', uri2);
        expect(resultsFromFile2.length).toBeGreaterThan(0);
        expect(resultsFromFile2[0].uri).toBe(uri2);
    });

    test('cross-file lookup for log function', () => {
        const configCode = loadFixture('lib/config.ysh');
        const caddyCode = loadFixture('caddy.ysh');

        const configUri = 'file:///test/lib/config.ysh';
        const caddyUri = 'file:///test/caddy.ysh';

        const configResult = parser.parse(configCode);
        const configSymbols = new SymbolTable();
        configSymbols.setText(configCode);
        configSymbols.buildFromParseResult(configResult);

        const caddyResult = parser.parse(caddyCode);
        const caddySymbols = new SymbolTable();
        caddySymbols.setText(caddyCode);
        caddySymbols.buildFromParseResult(caddyResult);

        const workspace = new WorkspaceSymbols();
        workspace.addFileSymbols(configUri, configSymbols);
        workspace.addFileSymbols(caddyUri, caddySymbols);

        // log is defined in config.ysh but used in caddy.ysh
        const logResults = workspace.lookupWithPriority('log', caddyUri);
        expect(logResults.length).toBeGreaterThan(0);
        expect(logResults[0].uri).toBe(configUri);
        console.log('log function found in:', logResults[0].uri);
    });
});

describe('Dict Key Tracking', () => {
    let parser: YSHParser;

    beforeEach(() => {
        parser = new YSHParser();
    });

    test('extracts dict keys from const declaration', () => {
        const code = `const CONFIG = {
  project: 'test',
  zone: 'us-central1-a',
  port: 8080,
}`;
        const result = parser.parse(code);
        const symbols = new SymbolTable();
        symbols.setText(code);
        symbols.buildFromParseResult(result);

        // Check that dict keys are tracked
        const configSymbol = symbols.lookup('CONFIG')[0];
        expect(configSymbol).toBeDefined();
        expect(configSymbol.dictKeys).toBeDefined();
        expect(configSymbol.dictKeys!.has('project')).toBe(true);
        expect(configSymbol.dictKeys!.has('zone')).toBe(true);
        expect(configSymbol.dictKeys!.has('port')).toBe(true);

        console.log('Dict keys:', Array.from(configSymbol.dictKeys!.keys()));
    });

    test('lookupDictKey finds key in dict', () => {
        const code = `const CONFIG = {
  instance_name: 'test-vm',
  project: 'my-project',
}`;
        const result = parser.parse(code);
        const symbols = new SymbolTable();
        symbols.setText(code);
        symbols.buildFromParseResult(result);

        const keyRange = symbols.lookupDictKey('CONFIG', 'instance_name');
        expect(keyRange).toBeDefined();
        console.log('instance_name key range:', keyRange);
    });

    test('WorkspaceSymbols.lookupDictKey works cross-file', () => {
        const configCode = loadFixture('lib/config.ysh');
        const configUri = 'file:///test/lib/config.ysh';
        const caddyUri = 'file:///test/caddy.ysh';

        const result = parser.parse(configCode);
        const symbols = new SymbolTable();
        symbols.setText(configCode);
        symbols.buildFromParseResult(result);

        const workspace = new WorkspaceSymbols();
        workspace.addFileSymbols(configUri, symbols);

        // Look up CONFIG.project from caddy.ysh context
        const keyResult = workspace.lookupDictKey('CONFIG', 'project');
        expect(keyResult).toBeDefined();
        expect(keyResult!.uri).toBe(configUri);
        console.log('CONFIG.project found in:', keyResult!.uri);
    });
});

describe('Variable Detection in Strings', () => {
    test('getWordAtPosition extracts $var in strings', () => {
        const text = `echo "Hello $name"`;
        // Position at 'n' in $name - includes $ prefix
        const offset = text.indexOf('name');
        const word = getWordAtPosition(text, offset);
        // Word includes $ prefix to indicate it's a variable reference
        expect(word).toBe('$name');
    });

    test('getWordAtPosition extracts var from $[CONFIG.foo]', () => {
        const text = `gcloud compute $[CONFIG.instance_name]`;
        // Position at 'C' in CONFIG - inside $[...], no $ prefix in result
        const offset = text.indexOf('CONFIG');
        const word = getWordAtPosition(text, offset);
        expect(word).toBe('CONFIG');
    });

    test('getWordAtPosition extracts property from CONFIG.foo', () => {
        const text = `$[CONFIG.instance_name]`;
        // Position at 'i' in instance_name
        const offset = text.indexOf('instance_name');
        const word = getWordAtPosition(text, offset);
        expect(word).toBe('instance_name');
    });

    test('getWordAtPosition extracts $dir in path', () => {
        const text = `source "lib/$dir/config.ysh"`;
        // Position at 'd' in $dir - includes $ prefix
        const offset = text.indexOf('dir');
        const word = getWordAtPosition(text, offset);
        // Word includes $ prefix to indicate it's a variable reference
        expect(word).toBe('$dir');
    });

    test('getWordAtPosition handles ${var} syntax', () => {
        const text = `echo "Value: \${my_var}"`;
        const offset = text.indexOf('my_var');
        const word = getWordAtPosition(text, offset);
        // Inside ${...}, no $ prefix in result
        expect(word).toBe('my_var');
    });
});
