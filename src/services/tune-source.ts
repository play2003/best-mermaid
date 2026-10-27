/**
 * 微调模式的源码层（纯函数，不依赖 Obsidian）：
 * - 识别 flowchart 源码
 * - 扫描节点定义 / 连线的标签位置（用于文字回写）
 * - 读写 %% bm-tune: {...} %% 注释指令
 * - 定位/替换笔记里的 mermaid 围栏代码块（只动 fence 之间的内容）
 *
 * 安全策略：标签无法唯一定位时返回错误，绝不半写。
 */
import type { BmTuneData } from "../types";
import { serializeTune } from "../pipeline/tune-overlay";

export const MAX_LABEL_LENGTH = 500;

const TUNE_LINE_RE = /^([ \t]*)%%[ \t]*bm-tune:[ \t]*(.*?)[ \t]*%%[ \t]*$/;
const SKIP_LINE_RE = /^\s*(%%|classDef\b|class\s|style\s|linkStyle\b|click\s|direction\s|end\b|subgraph\b)/;
const NODE_ID_RE = /^[A-Za-z_][\w-]*/;

export interface NodeOccurrence {
	id: string;
	/** 标签内容在行内的区间（不含形状分隔符与包裹引号） */
	labelStart: number;
	labelEnd: number;
	line: number;
}

export interface EdgeOccurrence {
	from: string;
	to: string;
	line: number;
	userEdgeId?: string;
	/** 标签内容区间；无标签时为 null */
	labelStart: number | null;
	labelEnd: number | null;
	/** 标签承载形式：|x| / -- x --> / 无 */
	labelMode: "pipe" | "text" | "none";
	/** 整个箭头（含标签）在行内的区间 */
	arrowStart: number;
	arrowEnd: number;
}

export interface ScanResult {
	headerLine: number | null;
	nodes: NodeOccurrence[];
	edges: EdgeOccurrence[];
	bareNodeIds: Set<string>;
}

export interface TextEditResult {
	source: string;
	changed: boolean;
	error?: string;
}

export function isFlowchartSource(source: string): boolean {
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("%%")) continue;
		return /^(flowchart|graph)\b/.test(line);
	}
	return false;
}

/** 提取最后一条有效 bm-tune 指令体，并在返回源码中剥离全部同类指令行 */
export function extractTuneDirective(source: string): { raw: string | null; clean: string } {
	let raw: string | null = null;
	const kept: string[] = [];
	for (const line of source.split(/\r?\n/)) {
		const match = TUNE_LINE_RE.exec(line);
		if (match) {
			raw = match[2];
			continue;
		}
		kept.push(line);
	}
	return { raw, clean: kept.join(detectEol(source)) };
}

/** 写入/替换/移除 bm-tune 指令：始终只有一行，幂等 */
export function upsertTuneDirective(source: string, tune: BmTuneData | null): string {
	const eol = detectEol(source);
	const kept = source.split(/\r?\n/).filter((line) => !TUNE_LINE_RE.test(line));
	if (isEmptyTune(tune)) return kept.join(eol);

	const header = kept.findIndex((line) => /^\s*(flowchart|graph)\b/.test(line));
	const line = `%% bm-tune: ${serializeTune(tune)} %%`;
	kept.splice(header < 0 ? 0 : header, 0, line);
	return kept.join(eol);
}

export function removeTuneDirective(source: string): string {
	return upsertTuneDirective(source, null);
}

function isEmptyTune(tune: BmTuneData | null): tune is null {
	if (!tune) return true;
	return Object.keys(tune.nodes ?? {}).length === 0 && Object.keys(tune.edges ?? {}).length === 0;
}

/** 扫描节点的标签定义与连线（跳过注释、样式语句与跨行语法） */
export function scanFlowchartSource(source: string): ScanResult {
	const result: ScanResult = { headerLine: null, nodes: [], edges: [], bareNodeIds: new Set() };
	const lines = source.split(/\r?\n/);

	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const line = lines[lineNo];
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (result.headerLine === null && /^(flowchart|graph)\b/.test(trimmed)) {
			result.headerLine = lineNo;
			continue;
		}
		if (SKIP_LINE_RE.test(line)) continue;

		const seenOnLine = new Set<string>();
		let pos = skipSpace(line, 0);
		let node = parseNodeRef(line, pos, lineNo);
		if (!node) continue;

		while (node) {
			if (node.definition) result.nodes.push(node.definition);
			seenOnLine.add(node.id);
			pos = node.end;

			const edge = parseEdge(line, skipSpace(line, pos), lineNo, node.id);
			if (!edge) break;
			result.edges.push(edge.occurrence);
			if (edge.definition) result.nodes.push(edge.definition);
			seenOnLine.add(edge.occurrence.to);

			node = { id: edge.occurrence.to, end: edge.end };
			pos = edge.end;
		}

		// 只有出现、没有形状定义的节点（如 A --> B）：记录以便插入标签时补定义
		for (const id of seenOnLine) {
			const defined = result.nodes.some((n) => n.id === id && n.line === lineNo);
			if (!defined) result.bareNodeIds.add(id);
		}
	}

	return result;
}

/** 改写节点标签：所有出现处同步（mermaid 后者覆盖前者，保持一致最安全） */
export function rewriteNodeLabel(source: string, nodeId: string, text: string): TextEditResult {
	const sanitized = sanitizeLabelText(text);
	if (sanitized.error) return { source, changed: false, error: sanitized.error };

	const scan = scanFlowchartSource(source);
	const occurrences = scan.nodes.filter((n) => n.id === nodeId);
	const lines = source.split(/\r?\n/);
	const eol = detectEol(source);

	if (occurrences.length === 0) {
		if (!scan.bareNodeIds.has(nodeId)) return { source, changed: false, error: "node-not-found" };
		if (scan.headerLine === null) return { source, changed: false, error: "node-not-found" };
		// 裸节点：在图声明行后插入独立定义
		const indent = /^\s*/.exec(lines[scan.headerLine])?.[0] ?? "";
		lines.splice(scan.headerLine + 1, 0, `${indent}${nodeId}["${sanitized.text}"]`);
		return { source: lines.join(eol), changed: true };
	}

	// 从后往前替换，避免同一行多处偏移失效
	const sorted = [...occurrences].sort((a, b) => b.line - a.line || b.labelStart - a.labelStart);
	for (const occ of sorted) {
		const line = lines[occ.line];
		lines[occ.line] = line.slice(0, occ.labelStart) + `"${sanitized.text}"` + line.slice(occ.labelEnd);
	}
	return { source: lines.join(eol), changed: true };
}

/** 改写连线标签；同名边存在多条时拒绝（无法确定性定位） */
export function rewriteEdgeLabel(source: string, from: string, to: string, text: string): TextEditResult {
	const sanitized = sanitizeLabelText(text);
	if (sanitized.error) return { source, changed: false, error: sanitized.error };

	const scan = scanFlowchartSource(source);
	const matches = scan.edges.filter((e) => e.from === from && e.to === to);
	if (matches.length === 0) return { source, changed: false, error: "edge-not-found" };
	if (matches.length > 1) return { source, changed: false, error: "edge-ambiguous" };

	const edge = matches[0];
	const lines = source.split(/\r?\n/);
	const line = lines[edge.line];
	let next: string;

	if (!sanitized.text) {
		// 清空标签：去掉 |...| 或还原纯箭头
		if (edge.labelMode === "pipe" && edge.labelStart !== null && edge.labelEnd !== null) {
			next = line.slice(0, edge.labelStart - 1) + line.slice(edge.labelEnd + 1);
		} else if (edge.labelMode === "text") {
			const plain = plainArrow(line.slice(edge.arrowStart, edge.arrowEnd));
			next = line.slice(0, edge.arrowStart) + plain + line.slice(edge.arrowEnd);
		} else {
			return { source, changed: false };
		}
	} else if (edge.labelMode === "pipe" && edge.labelStart !== null && edge.labelEnd !== null) {
		const safe = sanitized.text.replace(/\|/g, "#124;");
		next = line.slice(0, edge.labelStart) + safe + line.slice(edge.labelEnd);
	} else if (edge.labelMode === "text" && edge.labelStart !== null && edge.labelEnd !== null) {
		const safe = sanitized.text.replace(/\|/g, "#124;").replace(/\s+/g, " ");
		next = line.slice(0, edge.labelStart) + safe + line.slice(edge.labelEnd);
	} else {
		next = line.slice(0, edge.arrowEnd) + `|${sanitized.text.replace(/\|/g, "#124;")}|` + line.slice(edge.arrowEnd);
	}

	lines[edge.line] = next;
	return { source: lines.join(detectEol(source)), changed: true };
}

export type PendingEdit =
	| { kind: "node"; id: string; text: string }
	| { kind: "edge"; from: string; to: string; text: string };

/** 顺序应用文本编辑；任一失败则整体拒绝（不写半成品） */
export function applyTextEdits(source: string, edits: PendingEdit[]): TextEditResult {
	let next = source;
	for (const edit of edits) {
		const result =
			edit.kind === "node"
				? rewriteNodeLabel(next, edit.id, edit.text)
				: rewriteEdgeLabel(next, edit.from, edit.to, edit.text);
		if (result.error) return { source, changed: false, error: result.error };
		next = result.source;
	}
	return { source: next, changed: next !== source };
}

/** 标签文本清洗：统一双引号包裹，换行→<br/>，引号→实体 */
export function sanitizeLabelText(text: string): { text: string; error?: string } {
	const normalized = text.replace(/\r\n?/g, "\n").trim();
	if (normalized.length > MAX_LABEL_LENGTH) return { text: "", error: "label-too-long" };
	if (hasControlChars(normalized)) return { text: "", error: "label-control-chars" };
	return { text: normalized.replace(/"/g, "#quot;").replace(/\n/g, "<br/>") };
}

/** 控制字符检查（避免在源码里写不可见的正则字面量） */
function hasControlChars(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if ((code < 32 && code !== 9 && code !== 10) || code === 127) return true;
	}
	return false;
}

export interface BlockLocation {
	/** fence 之间的内容行号（0-based，含首含尾） */
	bodyStartLine: number;
	bodyEndLine: number;
	/** 每行统一前缀（缩进/引用） */
	prefix: string;
}

/** 在笔记全文中定位 mermaid 围栏块（支持 ``` / ~~~、缩进、引用） */
export function locateFencedBlock(
	text: string,
	hint: { rawSource: string; lineStartHint?: number | null },
): BlockLocation | null {
	const lines = text.split(/\r?\n/);
	const candidates: BlockLocation[] = [];

	for (let i = 0; i < lines.length; i++) {
		const open = /^(\s*(?:>\s?)*)(`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[i]);
		if (!open) continue;
		const marker = open[2][0];
		const fenceLen = open[2].length;
		if (!open[3].toLowerCase().startsWith("mermaid")) continue;

		const closeRe = new RegExp(`^\\s*(?:>\\s?)*${marker}{${fenceLen},}\\s*$`);
		let end = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (closeRe.test(lines[j])) {
				end = j;
				break;
			}
		}
		if (end < 0) continue;

		const prefix = open[1];
		const content = lines
			.slice(i + 1, end)
			.map((line) => stripPrefix(line, prefix))
			.join("\n")
			.trim();
		if (content !== hint.rawSource.trim()) continue;
		candidates.push({ bodyStartLine: i + 1, bodyEndLine: end - 1, prefix });
	}

	if (candidates.length === 0) return null;
	if (candidates.length === 1) return candidates[0];
	const hintLine = hint.lineStartHint;
	if (typeof hintLine === "number") {
		let best = candidates[0];
		for (const c of candidates) {
			if (Math.abs(c.bodyStartLine - hintLine) < Math.abs(best.bodyStartLine - hintLine)) best = c;
		}
		return best;
	}
	return null;
}

/** 只替换 fence 之间的内容，其余字节原样保留 */
export function replaceBlockBody(text: string, loc: BlockLocation, nextBody: string): string {
	const eol = detectEol(text);
	const lines = text.split(/\r?\n/);
	const bodyLines = nextBody.replace(/\r?\n$/, "").split(/\r?\n/);
	const prefixed = bodyLines.map((line) => (line ? `${loc.prefix}${line}` : line));
	lines.splice(loc.bodyStartLine, loc.bodyEndLine - loc.bodyStartLine + 1, ...prefixed);
	return lines.join(eol);
}

interface ParsedNodeRef {
	id: string;
	end: number;
	definition?: NodeOccurrence;
}

function parseNodeRef(line: string, pos: number, lineNo: number): ParsedNodeRef | null {
	const head = NODE_ID_RE.exec(line.slice(pos));
	if (!head) return null;
	const id = head[0];
	if (/^(end|subgraph|direction|classDef|class|style|linkStyle|click)$/.test(id)) return null;

	const cursor = pos + id.length;
	const shape = SHAPE_PREFIXES.find((s) => line.startsWith(s.open, cursor));
	if (!shape) return { id, end: cursor };

	const innerStart = cursor + shape.open.length;
	const close = findCloser(line, innerStart, shape.close, shape.altClose);
	if (close === null) return { id, end: cursor };

	// 标签区间包含原有包裹引号/反引号：回写时整体替换为 "..."，不会产生双引号
	const definition: NodeOccurrence = { id, labelStart: innerStart, labelEnd: close, line: lineNo };
	return { id, end: close + shape.close.length, definition };
}

interface ParsedEdge {
	occurrence: EdgeOccurrence;
	end: number;
	definition?: NodeOccurrence;
}

function parseEdge(line: string, pos: number, lineNo: number, from: string): ParsedEdge | null {
	let cursor = skipSpace(line, pos);

	// 可选自定义边 id：e1@-->
	const idMatch = /^([\w-]+)@/.exec(line.slice(cursor));
	let userEdgeId: string | undefined;
	if (idMatch) {
		userEdgeId = idMatch[1];
		cursor += idMatch[0].length;
	}

	const arrowStart = cursor;
	const textArrow = findTextArrow(line, cursor);
	if (textArrow) {
		const arrowEnd = cursor + textArrow.match[0].length;
		const labelStart = cursor + textArrow.match[0].indexOf(textArrow.label);
		const next = parseNodeRef(line, skipSpace(line, arrowEnd), lineNo);
		if (!next) return null;
		return {
			occurrence: {
				from,
				to: next.id,
				line: lineNo,
				userEdgeId,
				labelStart,
				labelEnd: labelStart + textArrow.label.length,
				labelMode: "text",
				arrowStart,
				arrowEnd,
			},
			end: next.end,
			definition: next.definition,
		};
	}

	const simple = /^(<-->|-->|---|--o|--x|-\.->|-\.-|==>|===|~~~)/.exec(line.slice(cursor));
	if (!simple) return null;
	cursor += simple[0].length;

	let labelStart: number | null = null;
	let labelEnd: number | null = null;
	let labelMode: EdgeOccurrence["labelMode"] = "none";
	const pipe = /^\s*\|([^|]*)\|/.exec(line.slice(cursor));
	if (pipe) {
		const innerStart = cursor + pipe[0].indexOf("|") + 1;
		labelStart = innerStart;
		labelEnd = innerStart + pipe[1].length;
		labelMode = "pipe";
		cursor += pipe[0].length;
	}
	const arrowEnd = cursor;

	const next = parseNodeRef(line, skipSpace(line, cursor), lineNo);
	if (!next) return null;
	return {
		occurrence: {
			from,
			to: next.id,
			line: lineNo,
			userEdgeId,
			labelStart,
			labelEnd,
			labelMode,
			arrowStart,
			arrowEnd,
		},
		end: next.end,
		definition: next.definition,
	};
}

function findTextArrow(line: string, pos: number): { match: RegExpExecArray; label: string } | null {
	const slice = line.slice(pos);
	const candidates = [/^--\s+([^|<>]+?)\s+-->/, /^-\.\s+([^.]+?)\s+\.->/, /^==\s+([^=|]+?)\s+==>/];
	for (const re of candidates) {
		const match = re.exec(slice);
		if (match) return { match, label: match[1] };
	}
	return null;
}

const SHAPE_PREFIXES: Array<{ open: string; close: string; altClose?: string }> = [
	{ open: "([", close: "])" },
	{ open: "[(", close: ")]" },
	{ open: "((", close: "))" },
	{ open: "[[", close: "]]" },
	{ open: "{{", close: "}}" },
	{ open: "[/", close: "/]", altClose: "\\]" },
	{ open: "[\\", close: "\\]", altClose: "/]" },
	{ open: ">", close: "]" },
	{ open: "[", close: "]" },
	{ open: "(", close: ")" },
	{ open: "{", close: "}" },
];

/** 引号/反引号感知的闭合符查找（标签里允许出现 ] ) } 等字符） */
function findCloser(line: string, from: number, closer: string, alt?: string): number | null {
	let inQuote = false;
	let inBacktick = false;
	for (let i = from; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"' && !inBacktick) inQuote = !inQuote;
		else if (ch === "`" && !inQuote) inBacktick = !inBacktick;
		if (inQuote || inBacktick) continue;
		if (line.startsWith(closer, i)) return i;
		if (alt && line.startsWith(alt, i)) return i;
	}
	return null;
}

function plainArrow(raw: string): string {
	if (raw.startsWith("-.")) return "-.->";
	if (raw.startsWith("==")) return "==>";
	return "-->";
}

function stripPrefix(line: string, prefix: string): string {
	if (!prefix) return line;
	return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

function skipSpace(line: string, pos: number): number {
	while (pos < line.length && /\s/.test(line[pos])) pos++;
	return pos;
}

function detectEol(text: string): string {
	const index = text.indexOf("\n");
	return index > 0 && text[index - 1] === "\r" ? "\r\n" : "\n";
}
