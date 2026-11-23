/**
 * 模板渲染核心：纯函数实现，不直接依赖 Obsidian API，
 * 日期格式化通过 ctx.format 回调注入（插件中传入 Obsidian 的 moment），
 * 这样既方便单元测试，也方便以后复用到其他环境。
 */

export interface RenderContext {
	/** 目标日期（日记对应的一天，通常为当天 00:00 之后的本地时间） */
	date: Date;
	/** 笔记标题（不含 .md 扩展名） */
	title: string;
	/** 笔记所在文件夹（相对仓库根目录，根目录为空字符串） */
	folder: string;
	/** 待办列表的渲染结果（复选框已统一恢复成未勾选） */
	todoText: string;
	/** 普通任务（Mission）的渲染结果（已完成的条目已被剔除） */
	missionText: string;
	/** 紧急任务（Urgent mission）的渲染结果（已完成的条目已被剔除） */
	urgentText: string;
	/** 待办区块的标题名，用于「模板里忘了放占位符」时兜底 */
	todoHeading: string;
	/** 普通任务区块的标题名 */
	missionHeading: string;
	/** 紧急任务区块的标题名 */
	urgentHeading: string;
	/** 日期格式化函数，等价于 moment(date).format(pattern) */
	format: (date: Date, pattern: string) => string;
	/** 月节点的链接文本，例如 [[2026-11]]；空字符串表示不建立关联 */
	monthLink?: string;
	/** 年节点的链接文本，例如 [[2026]] */
	yearLink?: string;
	/** 模板里没写对应占位符时，是否把列表追加到同名标题下（默认 true） */
	injectLists?: boolean;
}

export interface RenderResult {
	/** 最终写入笔记的内容 */
	content: string;
	/** {{cursor}} 在 content 中的字符偏移；模板中没有该占位符时为 null */
	cursorOffset: number | null;
}

/** 默认模板 */
export const DEFAULT_TEMPLATE = `# To-do list
{{todo_list}}

## Mission
{{mission_list}}

## Urgent mission
{{urgent_list}}

# Exercise

{{cursor}}`;

/** 默认的初始待办：一行一个，只在还没有可同步的日记时使用 */
export const DEFAULT_TASKS = `喝水 2L
运动 30 分钟
阅读 30 分钟`;

/** 变量占位符：{{name}} 或 {{name:格式}} */
const VARIABLE_RE =
	/\{\{\s*(date|time|yesterday|tomorrow|weekday|title|filename|folder|todo_list|mission_list|urgent_list|daily_tasks|tasks|month_link|year_link|todo_heading|mission_heading|urgent_heading|cursor)\s*(?::([^{}]*?))?\s*\}\}/gi;

function addDays(date: Date, days: number): Date {
	const copy = new Date(date.getTime());
	copy.setDate(copy.getDate() + days);
	return copy;
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把设置里「初始待办」的多行文本整理成 Markdown 列表。
 * - 空行忽略
 * - 已经是列表项 / 标题的行原样保留
 * - 其余行自动加上 `- [ ] `
 */
export function normalizeTaskLines(raw: string): string[] {
	if (!raw) return [];
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) =>
			/^([-*+]|\d+\.)\s/.test(line) || /^#{1,6}\s/.test(line) ? line : `- [ ] ${line}`
		);
}

function substitute(source: string, ctx: RenderContext): string {
	return source.replace(VARIABLE_RE, (_match, rawName: string, rawPattern?: string) => {
		const name = String(rawName).toLowerCase();
		const pattern = rawPattern && rawPattern.trim() ? rawPattern.trim() : undefined;
		switch (name) {
			case "date":
				return ctx.format(ctx.date, pattern ?? "YYYY-MM-DD");
			case "time":
				return ctx.format(ctx.date, pattern ?? "HH:mm");
			case "yesterday":
				return ctx.format(addDays(ctx.date, -1), pattern ?? "YYYY-MM-DD");
			case "tomorrow":
				return ctx.format(addDays(ctx.date, 1), pattern ?? "YYYY-MM-DD");
			case "weekday":
				return ctx.format(ctx.date, pattern ?? "dddd");
			case "title":
			case "filename":
				return ctx.title;
			case "folder":
				return ctx.folder;
			case "todo_list":
			case "daily_tasks":
			case "tasks":
				return ctx.todoText;
			case "mission_list":
				return ctx.missionText;
			case "urgent_list":
				return ctx.urgentText;
			case "month_link":
				return ctx.monthLink ?? "";
			case "year_link":
				return ctx.yearLink ?? "";
			case "todo_heading":
				return ctx.todoHeading;
			case "mission_heading":
				return ctx.missionHeading;
			case "urgent_heading":
				return ctx.urgentHeading;
			case "cursor":
				// cursor 已在 renderTemplate 中优先处理，剩下的重复占位符直接丢弃
				return "";
			default:
				return `{{${rawName}}}`;
		}
	});
}

interface RenderState {
	content: string;
	cursorOffset: number | null;
}

/** 模板里没放占位符时，把列表塞到同名标题下面 */
function injectUnderHeading(state: RenderState, heading: string, text: string): void {
	const name = heading.trim();
	if (!name) return;
	const headingRe = new RegExp(`^#{1,6}[ \\t]*${escapeRegExp(name)}[ \\t]*$`, "im");
	const match = headingRe.exec(state.content);
	if (match) {
		const insertAt = match.index + match[0].length;
		state.content =
			state.content.slice(0, insertAt) + "\n" + text + state.content.slice(insertAt);
		if (state.cursorOffset !== null && state.cursorOffset > insertAt) {
			state.cursorOffset += text.length + 1;
		}
		return;
	}
	const base = state.content.replace(/\s*$/, "");
	state.content = base ? `${base}\n\n## ${name}\n${text}\n` : `## ${name}\n${text}\n`;
}

function hasSlot(template: string, kind: "todo" | "mission" | "urgent"): boolean {
	if (kind === "todo") return /\{\{\s*(todo_list|daily_tasks|tasks)\s*(\}|:)/i.test(template);
	if (kind === "mission") return /\{\{\s*mission_list\s*(\}|:)/i.test(template);
	return /\{\{\s*urgent_list\s*(\}|:)/i.test(template);
}

/**
 * 渲染模板。
 * 支持 {{cursor}}：渲染结果中不会保留该占位符，而是通过 cursorOffset 告诉调用方光标该放哪里。
 */
export function renderTemplate(template: string, ctx: RenderContext): RenderResult {
	// 先按 {{cursor}} 切分：光标位置 = 前一段渲染后的长度
	const pieces = template.split(/\{\{\s*cursor\s*\}\}/i);
	const head = substitute(pieces[0] ?? "", ctx);
	const tail = substitute(pieces.slice(1).join(""), ctx);

	const state: RenderState = {
		content: head + tail,
		cursorOffset: pieces.length > 1 ? head.length : null,
	};

	if (ctx.injectLists !== false) {
		if (!hasSlot(template, "todo") && ctx.todoText) {
			injectUnderHeading(state, ctx.todoHeading, ctx.todoText);
		}
		if (!hasSlot(template, "mission") && ctx.missionText) {
			injectUnderHeading(state, ctx.missionHeading, ctx.missionText);
		}
		if (!hasSlot(template, "urgent") && ctx.urgentText) {
			injectUnderHeading(state, ctx.urgentHeading, ctx.urgentText);
		}
	}

	// 模板里没写 {{month_link}} 时，在文末兜底挂上月节点，保证日记和月节点有连接
	if (ctx.monthLink && !state.content.includes(ctx.monthLink)) {
		const base = state.content.replace(/\s*$/, "");
		state.content = `${base}${base ? "\n\n" : ""}所属月份：${ctx.monthLink}\n`;
	}

	if (!state.content.endsWith("\n")) state.content += "\n";
	return { content: state.content, cursorOffset: state.cursorOffset };
}

/** moment 格式串里的 token → 正则片段，用于判断某个文件名是否符合日期格式 */
const DATE_TOKENS: Array<[string, string]> = [
	["YYYY", "\\d{4}"],
	["YY", "\\d{2}"],
	["MMMM", "[^\\s/]+"],
	["MMM", "[^\\s/]+"],
	["MM", "\\d{2}"],
	["Mo", "\\d{1,2}(?:st|nd|rd|th)?"],
	["M", "\\d{1,2}"],
	["DDDD", "\\d{1,3}"],
	["DDD", "\\d{1,3}"],
	["DD", "\\d{2}"],
	["Do", "\\d{1,2}(?:st|nd|rd|th)?"],
	["D", "\\d{1,2}"],
	["dddd", "[^\\s/]+"],
	["ddd", "[^\\s/]+"],
	["dd", "[^\\s/]+"],
	["do", "\\d{1,2}(?:st|nd|rd|th)?"],
	["d", "\\d"],
	["HH", "\\d{2}"],
	["H", "\\d{1,2}"],
	["hh", "\\d{2}"],
	["h", "\\d{1,2}"],
	["kk", "\\d{2}"],
	["k", "\\d{1,2}"],
	["mm", "\\d{2}"],
	["m", "\\d{1,2}"],
	["ss", "\\d{2}"],
	["s", "\\d{1,2}"],
	["SSS", "\\d{3}"],
	["ZZ", "[+-]\\d{4}"],
	["Z", "[+-]\\d{2}:\\d{2}"],
	["A", "[AP]M"],
	["a", "[ap]m"],
	["Q", "\\d"],
	["X", "\\d+"],
	["x", "\\d+"],
];

const SORTED_TOKENS = [...DATE_TOKENS].sort((a, b) => b[0].length - a[0].length);

/**
 * 把 moment 格式串转换成匹配文件名的正则源码（不含首尾锚点）。
 * 例如 `YYYY-MM-DD` → `\d{4}-\d{2}-\d{2}`，`YYYY年M月D日` → `\d{4}年\d{1,2}月\d{1,2}日`。
 */
export function formatToRegex(format: string): string {
	let out = "";
	let i = 0;
	while (i < format.length) {
		const ch = format[i] as string;
		// 方括号内是 moment 的字面量转义
		if (ch === "[") {
			const end = format.indexOf("]", i + 1);
			if (end > i) {
				out += escapeRegExp(format.slice(i + 1, end));
				i = end + 1;
				continue;
			}
		}
		let matched = false;
		for (const [token, pattern] of SORTED_TOKENS) {
			if (format.startsWith(token, i)) {
				out += pattern;
				i += token.length;
				matched = true;
				break;
			}
		}
		if (!matched) {
			out += escapeRegExp(ch);
			i += 1;
		}
	}
	return out;
}

/** 判断一个（相对仓库的、去掉 .md 的）路径是否符合日期格式 */
export function matchesDateFormat(relativePath: string, format: string): boolean {
	try {
		return new RegExp(`^${formatToRegex(format)}$`).test(relativePath);
	} catch {
		return false;
	}
}
