/**
 * 从日记里解析「待办」和「紧急任务」两个区块，并把它们渲染回模板。
 * 纯函数，不依赖 Obsidian，方便单测。
 *
 * 规则：
 * - 待办（todo）：完整镜像当天的条目，写进模板时一律恢复成未勾选；
 * - 紧急任务（mission）：只保留「没打勾」的条目，打勾的从模板里消失。
 */

export interface ListItem {
	/** 条目文本（已去掉列表符号和复选框状态） */
	text: string;
	/** true = 已勾选，false = 未勾选，null = 没有复选框的普通条目 */
	checked: boolean | null;
	/** 缩进，原样保留 */
	indent: string;
	/** 原始列表符号：- * + 或 1. */
	marker?: string;
	/** 不是列表项的行（段落、引用等），原样保留 */
	raw?: boolean;
	/** 空行，用来保留段落间距 */
	blank?: boolean;
}

export interface SectionNames {
	todo: string;
	/** 普通任务（与紧急任务共用逻辑） */
	mission: string;
	/** 紧急任务；不传则忽略这一栏 */
	urgent?: string;
}

export interface ParsedLists {
	todo: ListItem[];
	mission: ListItem[];
	urgent: ListItem[];
	found: { todo: boolean; mission: boolean; urgent: boolean };
}

/** 同步结果，保存在插件 data.json 里 */
export interface SyncedLists {
	todo: ListItem[];
	mission: ListItem[];
	urgent: ListItem[];
	/** 来源日记路径 */
	sourcePath: string;
	/** 来源日记日期 YYYY-MM-DD */
	sourceDate: string;
	updatedAt: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const CHECK_RE = /^\[( |x|X)\]\s*(.*)$/;

interface Block {
	heading: string;
	body: string[];
}

/** 按标题切块：每块从某个标题开始，到下一个标题为止（不管级别） */
function splitBlocks(markdown: string): Block[] {
	const blocks: Block[] = [];
	let current: Block | null = null;
	for (const line of markdown.split(/\r?\n/)) {
		const heading = HEADING_RE.exec(line);
		if (heading) {
			if (current) blocks.push(current);
			current = { heading: (heading[2] as string).trim(), body: [] };
			continue;
		}
		if (current) current.body.push(line);
	}
	if (current) blocks.push(current);
	return blocks;
}

function sameHeading(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 把一段正文解析成条目列表 */
export function parseItems(body: string[]): ListItem[] {
	const items: ListItem[] = [];
	const pushBlank = (): void => {
		const last = items[items.length - 1];
		if (!last || last.blank) return;
		items.push({ text: "", checked: null, indent: "", blank: true });
	};

	for (const line of body) {
		if (line.trim() === "") {
			pushBlank();
			continue;
		}

		const item = ITEM_RE.exec(line);
		if (!item) {
			// 段落、引用、代码块等：整行原样保留（含缩进），不加任何标记
			items.push({ text: line.replace(/\s+$/, ""), checked: null, indent: "", raw: true });
			continue;
		}

		const indent = (item[1] as string).replace(/\t/g, "    ");
		const marker = item[2] as string;
		const rest = item[3] as string;
		const check = CHECK_RE.exec(rest);
		if (check) {
			items.push({
				text: (check[2] as string).trim(),
				checked: (check[1] as string).toLowerCase() === "x",
				indent,
				marker,
			});
		} else {
			items.push({ text: rest.trim(), checked: null, indent, marker });
		}
	}

	// 去掉末尾的空行
	while (items.length > 0 && items[items.length - 1]?.blank) items.pop();
	return items;
}

/** 从整篇日记里取各个区块 */
export function parseLists(markdown: string, names: SectionNames): ParsedLists {
	const result: ParsedLists = {
		todo: [],
		mission: [],
		urgent: [],
		found: { todo: false, mission: false, urgent: false },
	};
	for (const block of splitBlocks(markdown)) {
		if (!result.found.todo && sameHeading(block.heading, names.todo)) {
			result.todo = parseItems(block.body);
			result.found.todo = true;
		} else if (!result.found.mission && sameHeading(block.heading, names.mission)) {
			result.mission = parseItems(block.body);
			result.found.mission = true;
		} else if (
			names.urgent &&
			!result.found.urgent &&
			sameHeading(block.heading, names.urgent)
		) {
			result.urgent = parseItems(block.body);
			result.found.urgent = true;
		}
	}
	return result;
}

export interface RenderListOptions {
	/** 丢掉已勾选的条目（紧急任务用） */
	dropChecked?: boolean;
}

/** 把条目渲染成 Markdown 列表；复选框一律输出成未勾选 */
export function renderItems(items: ListItem[], options: RenderListOptions = {}): string {
	const lines: string[] = [];
	for (const item of items) {
		if (item.blank) {
			lines.push("");
			continue;
		}
		if (options.dropChecked && item.checked === true) continue;

		if (item.raw) {
			lines.push(item.text);
			continue;
		}

		const marker = item.marker ?? "-";
		if (item.checked === null) {
			lines.push(`${item.indent}${marker} ${item.text}`);
		} else {
			lines.push(`${item.indent}${marker} [ ] ${item.text}`);
		}
	}
	return lines.join("\n");
}

/** 把设置里手写的任务行（可能是 `- [ ] xxx`）转成条目 */
export function itemsFromLines(lines: string[]): ListItem[] {
	return lines.map((line) => {
		const item = ITEM_RE.exec(line);
		if (!item) return { text: line.trim(), checked: null, indent: "" };
		const marker = item[2] as string;
		const check = CHECK_RE.exec(item[3] as string);
		if (check) {
			return { text: (check[2] as string).trim(), checked: false, indent: "", marker };
		}
		return { text: (item[3] as string).trim(), checked: null, indent: "", marker };
	});
}

/** 统计：模板里最终会带走的条目数 */
export function countCarryOver(
	list: SyncedLists | null
): { todo: number; mission: number; urgent: number } {
	if (!list) return { todo: 0, mission: 0, urgent: 0 };
	const carry = (items: ListItem[] | undefined): number =>
		(items ?? []).filter((item) => item.checked !== true).length;
	return {
		todo: list.todo.length,
		mission: carry(list.mission),
		urgent: carry(list.urgent),
	};
}

/**
 * 往某个标题的区块末尾追加一行（已存在则原样返回）。
 * 找不到标题时在文末新建该区块。
 */
export function appendToSection(markdown: string, heading: string, line: string): string {
	if (markdown.includes(line)) return markdown;

	const lines = markdown.split(/\r?\n/);
	const index = lines.findIndex((text) => {
		const match = HEADING_RE.exec(text);
		return match !== null && sameHeading(match[2] as string, heading);
	});

	if (index === -1) {
		const base = markdown.replace(/\s*$/, "");
		return `${base}${base ? "\n\n" : ""}## ${heading}\n\n${line}\n`;
	}

	let end = lines.length;
	for (let i = index + 1; i < lines.length; i += 1) {
		if (HEADING_RE.test(lines[i] as string)) {
			end = i;
			break;
		}
	}

	let insertAt = end;
	while (insertAt > index + 1 && (lines[insertAt - 1] ?? "").trim() === "") insertAt -= 1;

	if (insertAt === index + 1) {
		lines.splice(insertAt, 0, "", line);
	} else {
		lines.splice(insertAt, 0, line);
		if (insertAt + 1 < lines.length && (lines[insertAt + 1] ?? "").trim() !== "") {
			lines.splice(insertAt + 1, 0, "");
		}
	}
	return lines.join("\n");
}

/** 把某个标题下的内容整体替换掉（找不到标题就在文末新建） */
export function replaceSection(markdown: string, heading: string, bodyLines: string[]): string {
	const lines = markdown.split(/\r?\n/);
	const index = lines.findIndex((text) => {
		const match = HEADING_RE.exec(text);
		return match !== null && sameHeading(match[2] as string, heading);
	});

	if (index === -1) {
		const base = markdown.replace(/\s*$/, "");
		const body = bodyLines.join("\n");
		return `${base}${base ? "\n\n" : ""}## ${heading}\n\n${body}\n`;
	}

	let end = lines.length;
	for (let i = index + 1; i < lines.length; i += 1) {
		if (HEADING_RE.test(lines[i] as string)) {
			end = i;
			break;
		}
	}

	const head = lines.slice(0, index + 1);
	const tail = lines.slice(end);
	const body = ["", ...bodyLines];
	if (tail.length > 0 && (tail[0] ?? "").trim() !== "") body.push("");

	const joined = [...head, ...body, ...tail].join("\n");
	return joined.endsWith("\n") ? joined : `${joined}\n`;
}
