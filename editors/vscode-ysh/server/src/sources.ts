/**
 * Source File Resolution for YSH
 *
 * Extracts source statements from parse trees and resolves paths
 * to enable cross-file symbol lookup.
 */

import * as path from 'path';
import * as fs from 'fs';
import { URI } from 'vscode-uri';
import { ParseResult, ASTNode } from './parser';

/**
 * Extract all source paths from a parse result.
 * Handles both `source path` and `source "path"` syntax.
 */
export function extractSourcePaths(result: ParseResult): string[] {
  const paths: string[] = [];

  function visit(node: ASTNode): void {
    // Look for simple_command with name === 'source'
    if (node.type === 'simple_command' && node.name === 'source') {
      if (node.children && node.children.length > 0) {
        // Join all child values to reconstruct the path
        // (tokenizer splits "lib/config.ysh" into "lib", "/", "config.ysh")
        const pathParts = node.children.map(c => c.value || '');
        const sourcePath = pathParts.join('');

        // Remove surrounding quotes if present
        const cleanPath = sourcePath.replace(/^["']|["']$/g, '');

        if (cleanPath) {
          paths.push(cleanPath);
        }
      }
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(result.tree);
  return paths;
}

/**
 * Resolve a source path relative to the document that contains it.
 * Handles shell variable expansion for common patterns like $_this_dir.
 *
 * @param sourcePath - The path from the source statement (e.g., "lib/config.ysh" or "$_this_dir/lib/config.ysh")
 * @param documentUri - The URI of the document containing the source statement
 * @returns The resolved file:// URI, or null if the file doesn't exist
 */
export function resolveSourcePath(sourcePath: string, documentUri: string): string | null {
  try {
    // Convert document URI to file path
    const docUri = URI.parse(documentUri);
    const docPath = docUri.fsPath;
    const docDir = path.dirname(docPath);

    // Expand common shell variables
    let expandedPath = expandShellVariables(sourcePath, docDir);

    // Resolve the source path relative to the document
    const resolvedPath = path.resolve(docDir, expandedPath);

    // Check if file exists
    if (fs.existsSync(resolvedPath)) {
      return URI.file(resolvedPath).toString();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Expand common shell variables in source paths.
 * 
 * Supported variables:
 * - $_this_dir -> directory containing the current script
 * - $BUN_SCRIPT_DIR -> same as $_this_dir (common pattern)
 * - ${_this_dir}, ${BUN_SCRIPT_DIR} -> same with braces
 */
function expandShellVariables(sourcePath: string, docDir: string): string {
  let expanded = sourcePath;
  
  // Replace $_this_dir and variations (YSH convention for script directory)
  expanded = expanded.replace(/\$\{?_this_dir\}?/g, docDir);
  expanded = expanded.replace(/\$\{?BUN_SCRIPT_DIR\}?/g, docDir);
  
  // Handle $0 directory pattern (dirname of script)
  // This is less common but sometimes used
  expanded = expanded.replace(/\$\(dirname\s+\$0\)/g, docDir);
  
  // If path still contains $ it has unexpanded variables - skip those parts
  // and try to find a resolvable suffix
  if (expanded.includes('$')) {
    // Try extracting just the relative path part after any variable
    const match = expanded.match(/\/([^$]+)$/);
    if (match) {
      expanded = match[1];
    }
  }
  
  return expanded;
}

/**
 * Load file contents from a URI.
 *
 * @param uri - The file:// URI to load
 * @returns The file contents, or null if loading fails
 */
export function loadFileContents(uri: string): string | null {
  try {
    const fsPath = URI.parse(uri).fsPath;
    return fs.readFileSync(fsPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Get all source dependencies for a document, recursively.
 * Includes cycle detection to prevent infinite loops.
 *
 * @param documentUri - The URI of the document to analyze
 * @param documentText - The text content of the document
 * @param parseDocument - Function to parse a document
 * @param maxDepth - Maximum recursion depth (default 10)
 * @returns Array of resolved URIs for all dependencies
 */
export function getSourceDependencies(
  documentUri: string,
  documentText: string,
  parseDocument: (text: string) => ParseResult,
  maxDepth: number = 10
): string[] {
  const visited = new Set<string>();
  const dependencies: string[] = [];

  function collectDependencies(uri: string, text: string, depth: number): void {
    if (depth > maxDepth || visited.has(uri)) {
      return;
    }

    visited.add(uri);

    const result = parseDocument(text);
    const sourcePaths = extractSourcePaths(result);

    for (const sourcePath of sourcePaths) {
      const resolvedUri = resolveSourcePath(sourcePath, uri);

      if (resolvedUri && !visited.has(resolvedUri)) {
        dependencies.push(resolvedUri);

        // Recursively collect dependencies
        const contents = loadFileContents(resolvedUri);
        if (contents) {
          collectDependencies(resolvedUri, contents, depth + 1);
        }
      }
    }
  }

  collectDependencies(documentUri, documentText, 0);
  return dependencies;
}

