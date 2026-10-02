import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const coreDir = __dirname;

/**
 * Globals the pure core must not touch: clocks, I/O, logging, randomness,
 * locale, dynamic code, and module-system escape hatches.
 */
const forbiddenGlobals = new Set([
  "process",
  "global",
  "Intl",
  "crypto",
  "eval",
  "Function",
  "module",
  "exports",
  "Date",
  "performance",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
  "queueMicrotask",
  "fetch",
  "console",
  "require",
  "globalThis",
]);

/**
 * Checks whether a member name is locale-dependent: `localeCompare` or any
 * `toLocale*` method.
 *
 * @param name - the member name.
 * @returns whether the name is locale-dependent.
 */
const isLocaleMember = (name: string) =>
  name === "localeCompare" || name.startsWith("toLocale");

/**
 * Checks whether a module specifier is allowed in a core file: `zod`, or a
 * relative module that stays inside the core directory or its subdirectories.
 *
 * @param fileName - the importing file.
 * @param specifier - the module specifier.
 * @returns whether the import is allowed.
 */
function isAllowedImport(fileName: string, specifier: string): boolean {
  if (specifier === "zod") {
    return true;
  }
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return false;
  }
  const relative = path.relative(
    coreDir,
    path.resolve(path.dirname(fileName), specifier)
  );
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Reports the boundary violations of one core source file.
 *
 * @param fileName - the file's path, used to resolve relative imports.
 * @param source - the file's TypeScript source.
 * @returns a description of each violation.
 */
function findBoundaryViolations(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const violations: string[] = [];
  const checkSpecifier = (node: ts.Node | undefined) => {
    if (!node || !ts.isStringLiteralLike(node)) {
      violations.push("non-literal module specifier");
    } else if (!isAllowedImport(fileName, node.text)) {
      violations.push(`import ${node.text}`);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      checkSpecifier(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      checkSpecifier(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      violations.push("import equals declaration");
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      checkSpecifier(node.arguments[0]);
    } else if (ts.isImportTypeNode(node)) {
      checkSpecifier(
        ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined
      );
    } else if (
      (ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Math" &&
        node.name.text === "random") ||
      (ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Math" &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "random")
    ) {
      violations.push("Math.random");
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      isLocaleMember(node.argumentExpression.text)
    ) {
      violations.push(`locale member ${node.argumentExpression.text}`);
    } else if (ts.isIdentifier(node) && isLocaleMember(node.text)) {
      violations.push(`locale member ${node.text}`);
    } else if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) {
      const parent = node.parent;
      const isMemberName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node) ||
        ((ts.isPropertySignature(parent) ||
          ts.isPropertyDeclaration(parent) ||
          ts.isMethodDeclaration(parent) ||
          ts.isMethodSignature(parent)) &&
          parent.name === node);
      if (!isMemberName) {
        violations.push(`global ${node.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

describe("core boundary", () => {
  const syntheticFile = path.join(coreDir, "synthetic.ts");

  it.each([
    ["models", 'import { Document } from "@server/models";'],
    ["sequelize", 'import { Op } from "sequelize";'],
    ["policies", 'import { can } from "@server/policies";'],
    ["server env", 'import env from "@server/env";'],
    ["shared env", 'import env from "@shared/env";'],
    ["queues", 'import { taskQueue } from "@server/queues/tasks";'],
    ["the Event model", 'import Event from "@server/models/Event";'],
    ["the cache", 'import { Redis } from "@server/storage/redis";'],
    ["the logger", 'import Logger from "@server/logging/Logger";'],
    ["the clock", "export const now = () => Date.now();"],
    ["node:http", 'import http from "node:http";'],
    ["the fetch utility", 'import fetch from "@server/utils/fetch";'],
    ["node:fs", 'import fs from "node:fs";'],
    ["file storage", 'import FileStorage from "@server/storage/files";'],
    ["a type-only import", 'import type { User } from "@server/models";'],
    ["a re-export", 'export { schema } from "@server/editor";'],
    ["a dynamic import", 'export const load = () => import("node:fs");'],
    ["an import type node", 'type T = import("@server/models").User;'],
    ["an adapter", 'import { parser } from "../adapters/canonicalSyntax";'],
    ["require", 'const fs = require("node:fs");'],
    ["process", "export const env = process.env;"],
    ["performance", "export const t = performance.now();"],
    ["a timer", "setTimeout(() => undefined, 1);"],
    ["global fetch", 'export const r = fetch("x");'],
    ["console", 'console.log("x");'],
    ["globalThis", "export const g = globalThis;"],
    ["Math.random", "export const r = Math.random();"],
    ["Math['random']", 'export const r = Math["random"]();'],
    ["a constructed date", "export const d = new Date(0);"],
    ["global", "export const env = global.process.env;"],
    ["Intl", 'export const c = new Intl.Collator("en");'],
    ["crypto", "export const id = crypto.randomUUID();"],
    ["eval", 'export const x = eval("1");'],
    ["Function", 'export const f = new Function("return 1");'],
    ["module", "module.exports = {};"],
    ["exports", "exports.x = 1;"],
    ["localeCompare", 'export const c = "a".localeCompare("b");'],
    ["element localeCompare", 'export const c = "a"["localeCompare"]("b");'],
    ["a destructured localeCompare", 'const { localeCompare } = "";'],
    ["toLocaleString", "export const s = (1).toLocaleString();"],
    ["toLocaleUpperCase", 'export const s = "a".toLocaleUpperCase();'],
    ["an import that leaves the core", 'import { x } from "./sub/../../x";'],
    ["the core's parent", 'import { x } from "..";'],
  ])("reports %s", (_name, source) => {
    expect(findBoundaryViolations(syntheticFile, source)).not.toEqual([]);
  });

  it("allows zod, sibling modules, and member names", () => {
    const source = [
      'import { z } from "zod";',
      'import type { Finding } from "./contracts";',
      'import { sortIssues } from "./ordering";',
      'export { createFinding } from "./registry";',
      "const value = { process: 1, Date: 2 };",
      "export const read = (x: { console: number }) => x.console + value.Date;",
      "export const max = Math.max(1, 2);",
    ].join("\n");

    expect(findBoundaryViolations(syntheticFile, source)).toEqual([]);
  });

  it("allows relative imports within core subdirectories", () => {
    const nestedFile = path.join(coreDir, "rules", "nested.ts");
    const source = [
      'import type { Finding } from "../contracts";',
      'import { helper } from "./helper";',
      'import { deep } from "../rules/deeper/deep";',
    ].join("\n");

    expect(findBoundaryViolations(nestedFile, source)).toEqual([]);
    expect(
      findBoundaryViolations(
        nestedFile,
        'import { x } from "../../adapters/x";'
      )
    ).not.toEqual([]);
  });

  it("reports no violations in the real core files", () => {
    const files = fs
      .readdirSync(coreDir, { recursive: true, encoding: "utf8" })
      .filter(
        (name) =>
          /\.[cm]?[jt]sx?$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name)
      );

    expect(files).toEqual(
      expect.arrayContaining([
        "contracts.ts",
        "documentRules.ts",
        "ordering.ts",
        "registry.ts",
        "result.ts",
      ])
    );
    for (const name of files) {
      const fileName = path.join(coreDir, name);
      expect({
        name,
        violations: findBoundaryViolations(
          fileName,
          fs.readFileSync(fileName, "utf8")
        ),
      }).toEqual({ name, violations: [] });
    }
  });
});
