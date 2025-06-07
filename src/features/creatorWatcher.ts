import * as vscode from 'vscode';
import * as path from "path";
import { Project } from "ts-morph";
type FileSnapshot = {
	path: string;
	size: number;
	mtime: number;
	hash: string;
};
import { readFileSync, statSync } from 'fs'
import * as crypto from "crypto";
import { fixImportsAfterMove } from './fixImports';

function getFileSnapshot(filePath: string): FileSnapshot | null {
	try {
		const stat = statSync(filePath);
		const content = readFileSync(filePath);
		const hash = crypto.createHash("sha256").update(content).digest("hex");
		return {
			path: filePath,
			size: stat.size,
			mtime: stat.mtimeMs,
			hash,
		};
	} catch (e) {
		return null;
	}
}

export default class CreatorWatcher {
	public static init(context: vscode.ExtensionContext): void {
		vscode.window.registerUriHandler({
			handleUri: async (uri) => {
				const params = new URLSearchParams(uri.query);
				let data = params.get('data');
				if (!data) {
					return
				}
				try {
					data = decodeURIComponent(data);
					const obj = JSON.parse(data);
					const { from, to } = obj;
					if (!from || !to) {
						return
					}
					await fixImportsAfterMove(from, to);
				} catch (e) {
				}
			},
		})
		return;
		const vscodeHandFiles = new Set<string>();
		const createQueue: FileSnapshot[] = [];
		const deleteQueue: FileSnapshot[] = [];

		vscode.workspace.onDidRenameFiles((event) => {
			event.files.forEach(file => {
				vscodeHandFiles.add(file.oldUri.fsPath);
				vscodeHandFiles.add(file.newUri.fsPath);
				setTimeout(() => {
					vscodeHandFiles.delete(file.oldUri.fsPath);
					vscodeHandFiles.delete(file.newUri.fsPath);
				}, 100)
			})
		})
		vscode.workspace.onDidDeleteFiles((event) => {
			event.files.forEach(file => {
				vscodeHandFiles.add(file.fsPath);
				setTimeout(() => {
					vscodeHandFiles.delete(file.fsPath);
				}, 100);
			})
		})
		vscode.workspace.onWillCreateFiles((event) => {
			event.files.forEach(file => {
				vscodeHandFiles.add(file.fsPath);
				setTimeout(() => {
					vscodeHandFiles.delete(file.fsPath);
				}, 100)
			})
		})
		let matchTimer: NodeJS.Timeout | null = null;

		function scheduleMatchCheck() {
			if (matchTimer) {
				clearTimeout(matchTimer);
			}
			matchTimer = setTimeout(matchCreateDeletePairs, 300);
		}
		async function matchCreateDeletePairs() {
			const matched: [FileSnapshot, FileSnapshot][] = [];

			for (const d of deleteQueue) {
				const match = createQueue.find(c => c.hash === d.hash && c.size === d.size);
				if (match) {
					matched.push([d, match]);
				}
			}
			for (const [del, cre] of matched) {
				console.log(`📦 检测到移动: ${del.path} → ${cre.path}`);
				await fixImportsAfterMove(del.path, cre.path);
			}
			createQueue.length = 0;
			deleteQueue.length = 0;
		}
		const watcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx}");
		watcher.onDidCreate(async (uri) => {
			if (vscodeHandFiles.has(uri.fsPath)) {
				return;
			}
			const snap = getFileSnapshot(uri.fsPath);
			if (snap) {
				createQueue.push(snap);
				scheduleMatchCheck();
			}
		});
		watcher.onDidDelete(async (uri) => {
			if (vscodeHandFiles.has(uri.fsPath)) {
				return;
			}
			const snap = getFileSnapshot(uri.fsPath);
			if (snap) {
				deleteQueue.push(snap);
				scheduleMatchCheck();
			} else {
			}
		});
		watcher.onDidChange((uri) => {
			console.log(`📝 文件修改: ${uri.fsPath}`)
			if (vscodeHandFiles.has(uri.fsPath)) {
				return;
			}
		});
	}
}