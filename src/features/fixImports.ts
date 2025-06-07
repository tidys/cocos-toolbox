import { Project, ModuleKind } from "ts-morph";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";

function normalizePath(p: string): string {
	return p.replace(/\\/g, "/");
}

function getTsconfigPaths(tsconfigPath: string) {
	try {
		const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
		const baseUrl = tsconfig.compilerOptions?.baseUrl || ".";
		const paths = tsconfig.compilerOptions?.paths || {};
		return { baseUrl, paths };
	} catch {
		return { baseUrl: ".", paths: {} };
	}
}

function resolveWithPaths(
	importPath: string,
	fileDir: string,
	paths: Record<string, string[]>,
	baseUrl: string,
	rootDir: string
): string | null {
	for (const [alias, targets] of Object.entries(paths)) {
		const aliasPrefix = alias.replace(/\*$/, "");
		if (importPath.startsWith(aliasPrefix)) {
			const rest = importPath.slice(aliasPrefix.length);
			const target = targets[0].replace(/\*$/, "") + rest;
			const absPath = path.resolve(rootDir, baseUrl, target);
			return normalizePath(absPath + ".ts");
		}
	}

	// fallback to relative path
	const absPath = path.resolve(fileDir, importPath + ".ts");
	return normalizePath(absPath);
}

function tryGetAliasPath(
	absTargetPath: string,
	sourceFilePath: string,
	baseUrl: string,
	paths: Record<string, string[]>,
	rootDir: string
): string | null {
	const relToBase = path.relative(path.resolve(rootDir, baseUrl), absTargetPath);
	for (const [alias, targets] of Object.entries(paths)) {
		const target = targets[0].replace(/\*$/, "");
		if (relToBase.startsWith(target)) {
			const rest = relToBase.slice(target.length);
			const importPath = alias.replace(/\*$/, "") + rest;
			return normalizePath(importPath).replace(/\.ts$/, "");
		}
	}
	return null;
}

export async function fixImportsAfterMove(oldPath: string, newPath: string) {
	debugger;
	const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!rootDir) return;

	const tsconfigPath = path.join(rootDir, "tsconfig.json");
	const { baseUrl, paths } = getTsconfigPaths(tsconfigPath);

	const project = new Project({
		tsConfigFilePath: tsconfigPath,
		skipAddingFilesFromTsConfig: false,
		compilerOptions: {
			module: ModuleKind.CommonJS,
		},
	});

	let changed = false;
	const assetsDir = normalizePath(path.join(rootDir, "assets"));
	const sourceFiles = project.getSourceFiles();
	for (const sourceFile of sourceFiles) {
		const filePath = normalizePath(sourceFile.getFilePath());
		// 将assets目录下的文件排除
		if (!filePath.startsWith(assetsDir)) {
			continue;
		}
		const imports = sourceFile.getImportDeclarations();
		for (const imp of imports) {
			const rawSpecifier = imp.getModuleSpecifierValue();
			const resolved = resolveWithPaths(rawSpecifier, path.dirname(filePath), paths, baseUrl, rootDir);
			const old_nr = normalizePath(path.resolve(oldPath));
			if (resolved && resolved.toLowerCase() === old_nr.toLowerCase()) {
				const aliasImportPath = tryGetAliasPath(path.resolve(newPath), filePath, baseUrl, paths, rootDir);

				if (aliasImportPath) {
					imp.setModuleSpecifier(aliasImportPath);
				} else {
					const rel = path.relative(path.dirname(filePath), newPath);
					const finalPath = normalizePath(rel).replace(/\.ts$/, "");
					imp.setModuleSpecifier(finalPath.startsWith(".") ? finalPath : "./" + finalPath);
				}

				changed = true;
				console.log(`✅ 修复 import: ${sourceFile.getBaseName()} 中的 ${rawSpecifier}`);
			}
		}
	}

	if (changed) {
		await project.save();
		vscode.window.showInformationMessage("已修复带路径别名的 import 引用");
	}
}
