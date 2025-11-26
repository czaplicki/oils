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
 *
 * @param sourcePath - The path from the source statement (e.g., "lib/config.ysh")
 * @param documentUri - The URI of the document containing the source statement
 * @returns The resolved file:// URI, or null if the file doesn't exist
 */
export function resolveSourcePath(sourcePath: string, documentUri: string): string | null {
  try {
    // Convert document URI to file path
    const docUri = URI.parse(documentUri);
    const docPath = docUri.fsPath;
    const docDir = path.dirname(docPath);

    // Resolve the source path relative to the document
    const resolvedPath = path.resolve(docDir, sourcePath);

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

