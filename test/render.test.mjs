import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const moment = require("moment");
require("moment/locale/zh-cn");
moment.locale("zh-cn");

const {
	renderTemplate,
	normalizeTaskLines,
	formatToRegex,
	matchesDateFormat,
	DEFAULT_TEMPLATE,
	parseLists,
	renderItems,
	itemsFromLines,
	countCarryOver,
	appendToSection,
	replaceSection,
} = require("./.build/logic.cjs");

const DAY = new Date(2026, 10, 23, 8, 5, 0); // 2026-11-23 08:05（本地时间，星期一）

function makeContext(overrides = {}) {
	return {
		date: DAY,
		title: "2026-11-23",
		folder: "日记",
		todoText: "",
		missionText: "",
		todoHeading: "To-do list",
		missionHeading: "Urgent mission",
		format: (date, pattern) => moment(date).format(pattern),
		...overrides,
	};
}

let failed = 0;
let passed = 0;

function check(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`  ✓ ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`  ✗ ${name}`);
		console.error(`    ${error.message}`);
	}
}

console.log("模板渲染");

check("默认模板：两个列表落位，光标在末尾", () => {
	const result = renderTemplate(
		DEFAULT_TEMPLATE,
		makeContext({ todoText: "- [ ] 喝水", missionText: "- [ ] 作业" })
	);
	assert.equal(
		result.content,
		"# To-do list\n- [ ] 喝水\n\n## Urgent mission\n- [ ] 作业\n\n# Exercise\n\n"
	);
	assert.equal(result.cursorOffset, result.content.length);
});

check("基础变量", () => {
	const template =
		"{{date}}|{{time}}|{{yesterday}}|{{tomorrow}}|{{weekday}}|{{title}}|{{filename}}|{{folder}}";
	const result = renderTemplate(template, makeContext());
	assert.equal(
		result.content,
		"2026-11-23|08:05|2026-11-22|2026-11-24|星期一|2026-11-23|2026-11-23|日记\n"
	);
});

check("自定义日期格式", () => {
	const result = renderTemplate(
		"{{date:YYYY年M月D日}} / {{yesterday:MM-DD}} / {{weekday}}",
		makeContext()
	);
	assert.equal(result.content, "2026年11月23日 / 11-22 / 星期一\n");
});

check("大小写与空格容错", () => {
	const result = renderTemplate("{{ DATE }} {{Date:YYYY}}", makeContext());
	assert.equal(result.content, "2026-11-23 2026\n");
});

check("光标占位符会被移除并给出偏移", () => {
	const result = renderTemplate("前{{cursor}}后", makeContext());
	assert.equal(result.content, "前后\n");
	assert.equal(result.cursorOffset, 1);
});

check("没有光标占位符时 cursorOffset 为 null", () => {
	const result = renderTemplate("没有光标", makeContext());
	assert.equal(result.cursorOffset, null);
});

check("未知变量保持原样", () => {
	const result = renderTemplate("{{unknown}} {{date}}", makeContext());
	assert.equal(result.content, "{{unknown}} 2026-11-23\n");
});

check("旧写法 {{daily_tasks}} 仍然映射到待办", () => {
	const result = renderTemplate("{{daily_tasks}}", makeContext({ todoText: "- [ ] a" }));
	assert.equal(result.content, "- [ ] a\n");
});

console.log("占位符缺失时兜底");

check("模板有同名标题时插到标题下面", () => {
	const result = renderTemplate("# To-do list\n\n# Exercise", makeContext({ todoText: "- [ ] a" }));
	assert.equal(result.content, "# To-do list\n- [ ] a\n\n# Exercise\n");
});

check("模板没有同名标题时追加一节", () => {
	const result = renderTemplate("# Exercise", makeContext({ todoText: "- [ ] a" }));
	assert.equal(result.content, "# Exercise\n\n## To-do list\n- [ ] a\n");
});

check("关闭兜底后不再追加", () => {
	const result = renderTemplate("# Exercise", makeContext({ todoText: "- [ ] a", injectLists: false }));
	assert.equal(result.content, "# Exercise\n");
});

console.log("年 / 月节点链接");

check("模板里有 {{month_link}} 时按位置插入", () => {
	const result = renderTemplate(
		"日期：{{date}}\n上级：{{month_link}}",
		makeContext({ monthLink: "[[2026-11]]" })
	);
	assert.equal(result.content, "日期：2026-11-23\n上级：[[2026-11]]\n");
});

check("模板没有 {{month_link}} 时在文末兜底挂上", () => {
	const result = renderTemplate("# 标题", makeContext({ monthLink: "[[2026-11]]" }));
	assert.equal(result.content, "# 标题\n\n所属月份：[[2026-11]]\n");
});

check("关闭年/月节点时不加链接", () => {
	const result = renderTemplate("# 标题", makeContext({ monthLink: "" }));
	assert.equal(result.content, "# 标题\n");
});

check("appendToSection：建区块 / 追加 / 幂等", () => {
	const a = appendToSection("# 2026年\n\n## 月份\n", "月份", "- [[2026-11]]");
	assert.equal(a, "# 2026年\n\n## 月份\n\n- [[2026-11]]\n");
	const b = appendToSection(a, "月份", "- [[2026-12]]");
	assert.ok(b.includes("- [[2026-11]]"));
	assert.ok(b.includes("- [[2026-12]]"));
	assert.equal(appendToSection(b, "月份", "- [[2026-11]]"), b);
	const c = appendToSection("# 空", "日记", "- [[2026-11-01]]");
	assert.equal(c, "# 空\n\n## 日记\n\n- [[2026-11-01]]\n");
});

check("replaceSection 会整体重排区块内容", () => {
	const md = "# 2026年\n\n## 月份\n\n- [[2026-11]]\n";
	const out = replaceSection(md, "月份", ["- [[2026-10]]", "- [[2026-11]]"]);
	assert.equal(out, "# 2026年\n\n## 月份\n\n- [[2026-10]]\n- [[2026-11]]\n");
	const created = replaceSection("# 空", "日记", ["- [[2026-11-01]]"]);
	assert.equal(created, "# 空\n\n## 日记\n\n- [[2026-11-01]]\n");
});

console.log("日记解析");

const SAMPLE = `# To-do list
- [ ] LEETCODE.
- [x] complete the Model Training.
## Urgent mission
- [ ] 计组作业7
- [x] 词汇作业2
- [ ] 讲座笔记1
# Exercise
15*4`;

check("解析出待办与紧急任务，勾选状态正确", () => {
	const parsed = parseLists(SAMPLE, { todo: "To-do list", mission: "Urgent mission" });
	assert.equal(parsed.found.todo, true);
	assert.equal(parsed.found.mission, true);
	assert.deepEqual(
		parsed.todo.map((item) => [item.text, item.checked]),
		[
			["LEETCODE.", false],
			["complete the Model Training.", true],
		]
	);
	assert.deepEqual(
		parsed.mission.map((item) => [item.text, item.checked]),
		[
			["计组作业7", false],
			["词汇作业2", true],
			["讲座笔记1", false],
		]
	);
});

check("子区块不会混进待办（任务挂在 ## 标题下）", () => {
	const parsed = parseLists(SAMPLE, { todo: "To-do list", mission: "Urgent mission" });
	assert.equal(parsed.todo.length, 2, "待办不应包含紧急任务里的条目");
});

check("标题匹配忽略大小写", () => {
	const parsed = parseLists("# to-do LIST\n- [ ] a", { todo: "To-do list", mission: "x" });
	assert.equal(parsed.todo.length, 1);
});

check("区块里没有标题时 found 为 false", () => {
	const parsed = parseLists("# 别的标题\n- [ ] a", { todo: "To-do list", mission: "Urgent mission" });
	assert.equal(parsed.found.todo, false);
	assert.equal(parsed.todo.length, 0);
});

check("待办渲染：勾选状态被还原", () => {
	const parsed = parseLists(SAMPLE, { todo: "To-do list", mission: "Urgent mission" });
	assert.equal(renderItems(parsed.todo), "- [ ] LEETCODE.\n- [ ] complete the Model Training.");
});

check("紧急任务渲染：已完成的被剔除", () => {
	const parsed = parseLists(SAMPLE, { todo: "To-do list", mission: "Urgent mission" });
	assert.equal(renderItems(parsed.mission, { dropChecked: true }), "- [ ] 计组作业7\n- [ ] 讲座笔记1");
});

check("紧急任务勾选数统计正确", () => {
	const parsed = parseLists(SAMPLE, { todo: "To-do list", mission: "Urgent mission" });
	const counts = countCarryOver({
		todo: parsed.todo,
		mission: parsed.mission,
		sourcePath: "x.md",
		sourceDate: "2026-11-23",
		updatedAt: 0,
	});
	assert.equal(counts.todo, 2);
	assert.equal(counts.mission, 2);
});

check("非列表行原样保留", () => {
	const parsed = parseLists("## Urgent mission\n- [ ] a\n> 备注一行", {
		todo: "x",
		mission: "Urgent mission",
	});
	assert.equal(renderItems(parsed.mission, { dropChecked: true }), "- [ ] a\n> 备注一行");
});

check("缩进保留", () => {
	const parsed = parseLists("## Urgent mission\n  - [ ] 子任务", {
		todo: "x",
		mission: "Urgent mission",
	});
	assert.equal(renderItems(parsed.mission), "  - [ ] 子任务");
});

check("设置里的手写任务行转成条目", () => {
	const items = itemsFromLines(normalizeTaskLines("喝水\n- [x] 已完成\n## 分组"));
	assert.deepEqual(
		items.map((item) => [item.text, item.checked]),
		[
			["喝水", false],
			["已完成", false],
			["## 分组", null],
		]
	);
});

console.log("文件名格式匹配");

check("formatToRegex 基本转换", () => {
	assert.equal(formatToRegex("YYYY-MM-DD"), "\\d{4}-\\d{2}-\\d{2}");
	assert.equal(formatToRegex("YYYY年M月D日"), "\\d{4}年\\d{1,2}月\\d{1,2}日");
	assert.equal(formatToRegex("[日记] YYYY"), "日记 \\d{4}");
});

check("matchesDateFormat 判断文件名", () => {
	assert.equal(matchesDateFormat("2026-11-23", "YYYY-MM-DD"), true);
	assert.equal(matchesDateFormat("2026/11/23", "YYYY/MM/DD"), true);
	assert.equal(matchesDateFormat("2026年11月23日", "YYYY年M月D日"), true);
	assert.equal(matchesDateFormat("2026-11-23 星期一", "YYYY-MM-DD dddd"), true);
	assert.equal(matchesDateFormat("随手记", "YYYY-MM-DD"), false);
	assert.equal(matchesDateFormat("2026-11-23", "YYYY/MM/DD"), false);
});

check("结尾保证有换行", () => {
	assert.equal(renderTemplate("abc", makeContext()).content, "abc\n");
	assert.equal(renderTemplate("abc\n", makeContext()).content, "abc\n");
});

console.log(`\n模板渲染测试：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
