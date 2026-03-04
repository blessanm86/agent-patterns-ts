// ─── TypeScript AST Parser ───────────────────────────────────────────────────
//
// Uses the TypeScript Compiler API to extract structural information from .ts files.
// No tree-sitter, no native binaries — just the `typescript` package.
//
// Two-phase extraction:
//   1. parseFile() — walk one file's AST, collect definitions + raw identifier references
//   2. resolveReferences() — cross-reference identifiers against definitions from other files

import ts from "typescript";
import type { Definition, FileTag, Reference } from "./types.js";

// ─── Phase 1: Single-File Parsing ────────────────────────────────────────────

export function parseFile(filePath: string, content: string): FileTag {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const definitions: Definition[] = [];
  const identifiers: { name: string; line: number }[] = [];

  function getLineNumber(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function getSignature(node: ts.Node): string {
    const fullText = node.getText(sourceFile);
    // Take just the declaration line (up to the opening brace or semicolon)
    const braceIdx = fullText.indexOf("{");
    const semiIdx = fullText.indexOf(";");
    let endIdx = fullText.length;
    if (braceIdx !== -1) endIdx = Math.min(endIdx, braceIdx);
    if (semiIdx !== -1) endIdx = Math.min(endIdx, semiIdx);
    return fullText.slice(0, endIdx).trim();
  }

  function isExported(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  function visit(node: ts.Node) {
    // ── Collect definitions ──
    if (ts.isFunctionDeclaration(node) && node.name) {
      definitions.push({
        name: node.name.text,
        kind: "function",
        line: getLineNumber(node),
        signature: getSignature(node),
        exported: isExported(node),
      });
    } else if (ts.isClassDeclaration(node) && node.name) {
      definitions.push({
        name: node.name.text,
        kind: "class",
        line: getLineNumber(node),
        signature: getSignature(node),
        exported: isExported(node),
      });
    } else if (ts.isInterfaceDeclaration(node)) {
      definitions.push({
        name: node.name.text,
        kind: "interface",
        line: getLineNumber(node),
        signature: getSignature(node),
        exported: isExported(node),
      });
    } else if (ts.isTypeAliasDeclaration(node)) {
      definitions.push({
        name: node.name.text,
        kind: "type",
        line: getLineNumber(node),
        signature: getSignature(node),
        exported: isExported(node),
      });
    } else if (ts.isEnumDeclaration(node)) {
      definitions.push({
        name: node.name.text,
        kind: "enum",
        line: getLineNumber(node),
        signature: getSignature(node),
        exported: isExported(node),
      });
    } else if (ts.isVariableStatement(node)) {
      const exported = isExported(node);
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          definitions.push({
            name: decl.name.text,
            kind: "const",
            line: getLineNumber(decl),
            signature: getSignature(node),
            exported,
          });
        }
      }
    }

    // ── Collect identifier references ──
    // Only collect identifiers that are NOT definition names (we handle those above)
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      // Skip if this identifier IS the name of a declaration
      const isDeclarationName =
        (ts.isFunctionDeclaration(parent) && parent.name === node) ||
        (ts.isClassDeclaration(parent) && parent.name === node) ||
        (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
        (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
        (ts.isEnumDeclaration(parent) && parent.name === node) ||
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isParameter(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isMethodSignature(parent) && parent.name === node);

      // Skip import specifier names (handled separately via import resolution)
      const isImportName =
        ts.isImportSpecifier(parent) || (ts.isImportClause(parent) && parent.name === node);

      if (!isDeclarationName && !isImportName) {
        identifiers.push({ name: node.text, line: getLineNumber(node) });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // At this stage, references are just raw identifiers — Phase 2 resolves them
  return { filePath, definitions, references: identifiers };
}

// ─── Phase 2: Cross-File Reference Resolution ───────────────────────────────

export function resolveReferences(tags: FileTag[]): void {
  // Build a set of all definition names across all files, keyed by name → defining file
  const definitionIndex = new Map<string, Set<string>>();
  for (const tag of tags) {
    for (const def of tag.definitions) {
      if (!definitionIndex.has(def.name)) {
        definitionIndex.set(def.name, new Set());
      }
      definitionIndex.get(def.name)!.add(tag.filePath);
    }
  }

  // For each file, filter raw identifiers to keep only those that reference
  // a definition in a DIFFERENT file
  for (const tag of tags) {
    const resolved: Reference[] = [];

    for (const ident of tag.references) {
      const definingFiles = definitionIndex.get(ident.name);
      if (!definingFiles) continue;

      // Keep if this name is defined in at least one other file
      // (or defined in this file AND another — cross-file usage)
      const otherFiles = [...definingFiles].filter((f) => f !== tag.filePath);
      if (otherFiles.length > 0) {
        resolved.push({ name: ident.name, line: ident.line });
      }
    }

    // Deduplicate references by name (keep first occurrence)
    const seen = new Set<string>();
    tag.references = resolved.filter((ref) => {
      if (seen.has(ref.name)) return false;
      seen.add(ref.name);
      return true;
    });
  }
}
