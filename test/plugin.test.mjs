import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const moment = require("moment");
require("moment/locale/zh-cn");
moment.locale("zh-cn");

const { DailyNoteTemplatePlugin, createApp } = require("./.build/plugin.cjs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = 0;
let passed = 0;

async function check(name, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`  ✓ ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`  ✗ ${name}`);
		console.error(`    ${error.stack ?? error.message}`);
	}
}

async function setup(options = {}) {
	const app = createApp({
		coreDailyNotes: options.coreDailyNotes ?? { folder: "日记", format: "YYYY-MM-DD" },
	});
	const plugin = new DailyNoteTemplatePlugin(app, { id: "daily-note-template" });
	await plugin.onload();
	return { app, plugin };
}

function makeEditor() {
	return {
		value: "",
		cursor: { line: 0, ch: 0 },
		getValue() {
			return this.value;
		},
		getCursor() {
			return this.cursor;
		},
		replaceSelection(text) {
			this.value = text;
		},
		posToOffset() {
			return 0;
		},
		offsetToPos(offset) {
			return { line: 0, ch: offset };
		},
		setCursor(pos) {
			this.cursor = pos;
		},
		focus() {},
	};
}

const todayKey = () => moment().format("YYYY-MM-DD");
const tomorrowKey = () => moment().add(1, "day").format("YYYY-MM-DD");
const dayKey = (offset) => moment().add(offset, "day").format("YYYY-MM-DD");

console.log("插件装配");

await check("注册命令、图标和设置页", async () => {
	const { app, plugin } = await setup();
	assert.equal(app.__commands.length, 10);
	assert.equal(app.__ribbons.length, 1);
	assert.equal(app.__settingTabs.length, 1);
	assert.equal(plugin.getFolder(), "日记");
	assert.equal(plugin.getDateFormat(), "YYYY-MM-DD");
	assert.equal(plugin.sectionNames().todo, "To-do list");
	assert.equal(plugin.sectionNames().mission, "Mission");
	assert.equal(plugin.sectionNames().urgent, "Urgent mission");
});

await check("跟随核心日记插件与自定义路径", async () => {
	const { plugin } = await setup();
	plugin.settings.useCoreDailyNotes = false;
	plugin.settings.folder = "Journal/每日";
	plugin.settings.dateFormat = "YYYY年MM月DD日";
	assert.equal(
		plugin.getNotePath(moment("2026-11-23", "YYYY-MM-DD")),
		"Journal/每日/2026年11月23日.md"
	);
});

await check("设置页在两种模板来源下都能完整渲染", async () => {
	const { app, plugin } = await setup();
	const tab = app.__settingTabs[0];
	tab.display();
	plugin.settings.templateSource = "file";
	tab.display();
	plugin.settings.useCoreDailyNotes = false;
	tab.display();
});

console.log("打开 / 新建日记");

await check("打开今日日记：自动创建并写入默认模板", async () => {
	const { app, plugin } = await setup();
	await plugin.openDailyNote(moment());

	const file = app.vault.getAbstractFileByPath(`日记/${todayKey()}.md`);
	assert.ok(file, "应创建日记文件");
	assert.ok(file.__content.startsWith("# To-do list\n- [ ] 喝水 2L"), file.__content);
	assert.ok(file.__content.includes("## Urgent mission"));
	assert.ok(file.__content.includes("# Exercise"));
	assert.ok(!file.__content.includes("{{"), "不应残留占位符");
	assert.equal(app.workspace.getActiveFile(), file);
});

await check("重复打开不会覆盖已写内容", async () => {
	const { app, plugin } = await setup();
	await app.vault.create("日记/2026-11-20.md", "我今天已经写过了");
	await plugin.openDailyNote(moment("2026-11-20", "YYYY-MM-DD"));
	assert.equal(app.vault.getAbstractFileByPath("日记/2026-11-20.md").__content, "我今天已经写过了");
});

await check("新建空白日记（如点击双链）自动套用模板", async () => {
	const { app } = await setup();
	await app.vault.create(`日记/${tomorrowKey()}.md`, "");
	await sleep(150);
	const file = app.vault.getAbstractFileByPath(`日记/${tomorrowKey()}.md`);
	assert.ok(file.__content.startsWith("# To-do list"), file.__content);
	assert.ok(file.__content.includes("- [ ] 喝水 2L"));
	assert.ok(file.__content.includes("# Exercise"), "Exercise 区块应存在");
});

await check("日记文件夹里的普通笔记不会被套模板", async () => {
	const { app } = await setup();
	await app.vault.create("日记/随手记.md", "");
	await sleep(150);
	assert.equal(app.vault.getAbstractFileByPath("日记/随手记.md").__content, "");
});

console.log("列表同步");

await check("待办跟随上一篇日记，勾选被还原", async () => {
	const { app, plugin } = await setup();
	const today = moment();
	await app.vault.create(
		`日记/${today.format("YYYY-MM-DD")}.md`,
		[
			"# To-do list",
			"- [x] 写代码",
			"- [ ] 看书",
			"## Urgent mission",
			"- [ ] 作业A",
			"- [x] 作业B",
			"",
			"# Exercise",
			"",
		].join("\n")
	);

	await plugin.openDailyNote(moment().add(1, "day"));
	const tomorrow = app.vault.getAbstractFileByPath(`日记/${tomorrowKey()}.md`);
	assert.ok(tomorrow, "应创建明天的日记");
	assert.ok(tomorrow.__content.includes("- [ ] 写代码"), "打勾的待办要还原成未勾选");
	assert.ok(tomorrow.__content.includes("- [ ] 看书"));
	assert.ok(tomorrow.__content.includes("- [ ] 作业A"), "未完成的紧急任务要带走");
	assert.ok(!tomorrow.__content.includes("作业B"), "已完成的紧急任务不应出现");
});

await check("Mission 与 Urgent mission 各自独立、规则相同", async () => {
	const { app, plugin } = await setup();
	const today = moment();
	await app.vault.create(
		`日记/${today.format("YYYY-MM-DD")}.md`,
		[
			"# To-do list",
			"- [ ] 待办1",
			"## Mission",
			"- [ ] 任务A",
			"- [x] 任务B",
			"## Urgent mission",
			"- [ ] 急A",
			"- [x] 急B",
			"",
		].join("\n")
	);

	await plugin.openDailyNote(moment().add(1, "day"));
	const tomorrow = app.vault.getAbstractFileByPath(`日记/${tomorrowKey()}.md`);
	const content = tomorrow.__content;

	assert.ok(content.includes("- [ ] 任务A"), content);
	assert.ok(!content.includes("任务B"), "Mission 里已完成的应消失");
	assert.ok(content.includes("- [ ] 急A"), content);
	assert.ok(!content.includes("急B"), "Urgent 里已完成的应消失");

	const afterMission = content.split("## Mission")[1] ?? "";
	const missionBlock = afterMission.split("## Urgent mission")[0] ?? "";
	const urgentBlock = content.split("## Urgent mission")[1] ?? "";
	assert.ok(missionBlock.includes("任务A"));
	assert.ok(!missionBlock.includes("急A"), "两栏不应串");
	assert.ok(urgentBlock.includes("急A"));
});

await check("今天的日记改动后自动同步（防抖）", async () => {
	const { app, plugin } = await setup();
	const today = moment();
	const file = await app.vault.create(`日记/${today.format("YYYY-MM-DD")}.md`, "# To-do list\n- [ ] A\n");
	await sleep(120);
	assert.equal(plugin.settings.synced, null, "创建时还没有同步");

	await app.vault.modify(file, "# To-do list\n- [ ] A\n- [ ] B\n## Urgent mission\n- [ ] C\n");
	await sleep(900);

	const synced = plugin.settings.synced;
	assert.ok(synced, "修改后应产生同步状态");
	assert.equal(synced.sourceDate, today.format("YYYY-MM-DD"));
	assert.equal(synced.todo.length, 2);
	assert.equal(synced.urgent.length, 1);
});

await check("手动同步：从今天的日记抓取列表", async () => {
	const { app, plugin } = await setup();
	const today = moment();
	await app.vault.create(`日记/${today.format("YYYY-MM-DD")}.md`, "# To-do list\n- [x] A\n");
	const ok = await plugin.syncFromToday(true);
	assert.equal(ok, true);
	assert.deepEqual(
		plugin.settings.synced.todo.map((item) => [item.text, item.checked]),
		[["A", true]]
	);
	assert.equal(plugin.syncSummary().counts.todo, 1);
});

await check("没有今天的日记时同步返回 false", async () => {
	const { plugin } = await setup();
	assert.equal(await plugin.syncFromToday(), false);
	assert.equal(plugin.syncSummary(), null);
});

await check("补写历史日记时，用那天之前最近的一篇", async () => {
	const { app, plugin } = await setup();
	await app.vault.create("日记/2026-11-18.md", "# To-do list\n- [ ] 老任务\n");
	await plugin.openDailyNote(moment("2026-11-19", "YYYY-MM-DD"));
	const file = app.vault.getAbstractFileByPath("日记/2026-11-19.md");
	assert.ok(file.__content.includes("- [ ] 老任务"), file.__content);
});

await check("关闭同步后回落到初始待办", async () => {
	const { app, plugin } = await setup();
	plugin.settings.syncTodo = false;
	plugin.settings.recurringTasks = "- [ ] 手动任务";
	await plugin.openDailyNote(moment());
	const file = app.vault.getAbstractFileByPath(`日记/${todayKey()}.md`);
	assert.ok(file.__content.includes("- [ ] 手动任务"), file.__content);
	assert.ok(!file.__content.includes("喝水 2L"));
});

await check("紧急任务关闭同步后不带走任何任务", async () => {
	const { app, plugin } = await setup();
	const today = moment();
	await app.vault.create(
		`日记/${today.format("YYYY-MM-DD")}.md`,
		"# To-do list\n- [ ] A\n## Urgent mission\n- [ ] 作业\n"
	);
	plugin.settings.syncMission = false;
	await plugin.openDailyNote(moment().add(1, "day"));
	const file = app.vault.getAbstractFileByPath(`日记/${tomorrowKey()}.md`);
	assert.ok(file.__content.includes("- [ ] A"));
	assert.ok(!file.__content.includes("作业"));
});

console.log("每天自动创建");

await check("启动时自动创建今天的日记（关闭自动打开）", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoOpenMode = "off";
	app.workspace.triggerLayoutReady();
	await sleep(150);
	const file = app.vault.getAbstractFileByPath(`日记/${todayKey()}.md`);
	assert.ok(file, "应自动创建今天的日记");
	assert.ok(file.__content.startsWith("# To-do list"), file.__content);
	assert.equal(app.workspace.getActiveFile(), null, "关闭自动打开时不应抢焦点");
});

await check("默认「每天首次启动」会自动打开今天的日记", async () => {
	const { app } = await setup();
	app.workspace.triggerLayoutReady();
	await sleep(180);
	const file = app.vault.getAbstractFileByPath(`日记/${todayKey()}.md`);
	assert.ok(file, "应自动创建今天的日记");
	assert.equal(app.workspace.getActiveFile(), file, "应打开今天的日记");
});

await check("已经有今天的日记时不会覆盖，但仍会打开一次", async () => {
	const { app } = await setup();
	const file = await app.vault.create(`日记/${todayKey()}.md`, "我今天已经写过了");
	app.workspace.triggerLayoutReady();
	await sleep(180);
	assert.equal(file.__content, "我今天已经写过了");
	assert.equal(app.workspace.getActiveFile(), file);
});

await check("当天已自动打开过，重启后不再抢焦点", async () => {
	const { app, plugin } = await setup();
	await app.vault.create(`日记/${todayKey()}.md`, "内容");
	plugin.settings.lastOpenDate = todayKey();
	app.workspace.triggerLayoutReady();
	await sleep(180);
	assert.equal(app.workspace.getActiveFile(), null);
});

await check("关闭「每天自动创建」后不会创建", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoCreateDailyNote = false;
	plugin.settings.autoOpenMode = "off";
	app.workspace.triggerLayoutReady();
	await sleep(150);
	assert.equal(app.vault.getAbstractFileByPath(`日记/${todayKey()}.md`), null);
});

await check("跨天时补建新一天的日记，且不打开", async () => {
	const { app, plugin } = await setup();
	plugin.settings.lastAutoCreateDate = moment().subtract(1, "day").format("YYYY-MM-DD");
	plugin.settings.autoOpenMode = "off";
	await plugin.ensureDailyNotes();
	const file = app.vault.getAbstractFileByPath(`日记/${todayKey()}.md`);
	assert.ok(file, "跨天后应补建");
	assert.equal(app.workspace.getActiveFile(), null);
});

await check("连着几天没打开，启动时把缺的日子全部补上", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoOpenMode = "off";
	await app.vault.create(`日记/${dayKey(-3)}.md`, "# To-do list\n- [ ] A\n");
	const result = await plugin.ensureDailyNotes();
	assert.equal(result.total, 3, "应补 3 天");
	for (const offset of [-2, -1, 0]) {
		const file = app.vault.getAbstractFileByPath(`日记/${dayKey(offset)}.md`);
		assert.ok(file, `应补建 ${dayKey(offset)}`);
		assert.ok(file.__content.includes("- [ ] A"), file.__content);
	}
});

await check("补建受「最多向前补几天」限制", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoOpenMode = "off";
	plugin.settings.backfillMaxDays = 2;
	await app.vault.create(`日记/${dayKey(-5)}.md`, "# To-do list\n- [ ] A\n");
	const result = await plugin.ensureDailyNotes();
	assert.equal(result.total, 2);
	assert.equal(app.vault.getAbstractFileByPath(`日记/${dayKey(-4)}.md`), null, "超出上限的日子不补");
	assert.ok(app.vault.getAbstractFileByPath(`日记/${dayKey(-1)}.md`));
	assert.ok(app.vault.getAbstractFileByPath(`日记/${dayKey(0)}.md`));
});

await check("从来没有日记时只建今天，不往回追溯", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoOpenMode = "off";
	const result = await plugin.ensureDailyNotes();
	assert.equal(result.total, 1);
	assert.ok(app.vault.getAbstractFileByPath(`日记/${dayKey(0)}.md`));
	assert.equal(app.vault.getAbstractFileByPath(`日记/${dayKey(-1)}.md`), null);
});

await check("自动补建只向前补，不翻历史旧账", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoOpenMode = "off";
	await app.vault.create(`日记/${dayKey(-5)}.md`, "# To-do list\n- [ ] A\n");
	await app.vault.create(`日记/${dayKey(0)}.md`, "# To-do list\n- [ ] A\n");
	const result = await plugin.ensureDailyNotes();
	assert.equal(result.total, 0, "今天的日记已存在，就不动历史空档");
	assert.equal(app.vault.getAbstractFileByPath(`日记/${dayKey(-4)}.md`), null);
});

await check("手动「补齐」会填掉历史空档", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoOpenMode = "off";
	await app.vault.create(`日记/${dayKey(-5)}.md`, "# To-do list\n- [ ] A\n");
	await app.vault.create(`日记/${dayKey(0)}.md`, "# To-do list\n- [ ] A\n");
	const count = await plugin.fillGapsInWindow();
	assert.equal(count, 4);
	for (const offset of [-4, -3, -2, -1]) {
		assert.ok(
			app.vault.getAbstractFileByPath(`日记/${dayKey(offset)}.md`),
			`应补上 ${dayKey(offset)}`
		);
	}
});

await check("今天删掉的日记不会每分钟反复重建", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoOpenMode = "off";
	app.workspace.triggerLayoutReady();
	await sleep(150);
	assert.equal(plugin.settings.lastAutoCreateDate, todayKey());
	app.vault.nodes.delete(`日记/${todayKey()}.md`);
	const result = await plugin.ensureDailyNotes();
	assert.equal(result.total, 0, "已建过就不再补");
	assert.equal(app.vault.getAbstractFileByPath(`日记/${todayKey()}.md`), null);
});

console.log("年 / 月节点");

await check("创建日记时生成月节点和年节点，并互相链接", async () => {
	const { app, plugin } = await setup();
	await plugin.openDailyNote(moment("2026-11-23", "YYYY-MM-DD"));
	const month = app.vault.getAbstractFileByPath("日记/2026-11.md");
	const year = app.vault.getAbstractFileByPath("日记/2026.md");
	assert.ok(month, "应创建月节点");
	assert.ok(year, "应创建年节点");
	assert.ok(month.__content.includes("所属年份：[[2026]]"), month.__content);
	assert.ok(month.__content.includes("- [[2026-11-23]]"), month.__content);
	assert.ok(year.__content.includes("- [[2026-11]]"), year.__content);
	const day = app.vault.getAbstractFileByPath("日记/2026-11-23.md");
	assert.ok(day.__content.includes("所属月份：[[2026-11]]"), day.__content);
});

await check("月节点会列出当月已有的所有日记", async () => {
	const { app, plugin } = await setup();
	await app.vault.create("日记/2026-11-19.md", "# To-do list\n- [ ] A\n");
	await app.vault.create("日记/2026-11-20.md", "# To-do list\n- [ ] A\n");
	await plugin.ensureTimeNotes(moment("2026-11-24", "YYYY-MM-DD"));
	const month = app.vault.getAbstractFileByPath("日记/2026-11.md");
	assert.ok(month.__content.includes("- [[2026-11-19]]"), month.__content);
	assert.ok(month.__content.includes("- [[2026-11-20]]"));
});

await check("节点可以放到单独文件夹", async () => {
	const { app, plugin } = await setup();
	plugin.settings.timeNoteFolder = "时间轴";
	await plugin.openDailyNote(moment("2026-11-23", "YYYY-MM-DD"));
	assert.ok(app.vault.getAbstractFileByPath("时间轴/2026-11.md"));
	assert.ok(app.vault.getAbstractFileByPath("时间轴/2026.md"));
	const day = app.vault.getAbstractFileByPath("日记/2026-11-23.md");
	assert.ok(day.__content.includes("所属月份：[[2026-11]]"), day.__content);
	const month = app.vault.getAbstractFileByPath("时间轴/2026-11.md");
	assert.ok(month.__content.includes("- [[2026-11-23]]"), month.__content);
});

await check("关闭年/月节点后不生成", async () => {
	const { app, plugin } = await setup();
	plugin.settings.enableTimeNotes = false;
	await plugin.openDailyNote(moment("2026-12-01", "YYYY-MM-DD"));
	assert.equal(app.vault.getAbstractFileByPath("日记/2026-12.md"), null);
	const day = app.vault.getAbstractFileByPath("日记/2026-12-01.md");
	assert.ok(!day.__content.includes("所属月份"), day.__content);
});

await check("给已有日记补月份链接（可重复执行）", async () => {
	const { app, plugin } = await setup();
	await app.vault.create("日记/2026-10-05.md", "# To-do list\n- [ ] A\n");
	await app.vault.create("日记/2026-11-02.md", "# To-do list\n- [ ] A\n");

	const first = await plugin.linkExistingNotes();
	assert.equal(first.total, 2);
	assert.equal(first.linked, 2);

	const oct = app.vault.getAbstractFileByPath("日记/2026-10-05.md");
	assert.ok(oct.__content.includes("所属月份：[[2026-10]]"), oct.__content);
	const nov = app.vault.getAbstractFileByPath("日记/2026-11-02.md");
	assert.ok(nov.__content.includes("所属月份：[[2026-11]]"));
	assert.ok(app.vault.getAbstractFileByPath("日记/2026-10.md"), "应建 10 月节点");
	assert.ok(app.vault.getAbstractFileByPath("日记/2026-11.md"));

	const second = await plugin.linkExistingNotes();
	assert.equal(second.linked, 0, "重复执行不应重复添加");
});

await check("额外日记文件夹也会被索引并补链接", async () => {
	const { app, plugin } = await setup();
	plugin.settings.extraDailyFolders = "生活/日记";
	await app.vault.create("生活/日记/2026-10-12.md", "# To-do list\n- [ ] A\n");
	await app.vault.create("日记/2026-10-20.md", "# To-do list\n- [ ] B\n");

	const result = await plugin.linkExistingNotes();
	assert.equal(result.total, 2);
	assert.equal(result.linked, 2);

	const old = app.vault.getAbstractFileByPath("生活/日记/2026-10-12.md");
	assert.ok(old.__content.includes("所属月份：[[2026-10]]"), old.__content);

	const month = app.vault.getAbstractFileByPath("日记/2026-10.md");
	assert.ok(month, "应建 10 月节点");
	assert.ok(month.__content.includes("- [[2026-10-12]]"), month.__content);
	assert.ok(month.__content.includes("- [[2026-10-20]]"));
	assert.ok(
		month.__content.indexOf("2026-10-12") < month.__content.indexOf("2026-10-20"),
		"清单应按日期升序"
	);
});

await check("归档文件夹里的空白笔记不会被套模板", async () => {
	const { app, plugin } = await setup();
	plugin.settings.extraDailyFolders = "生活/日记";
	await app.vault.create("生活/日记/2026-10-12.md", "");
	await sleep(150);
	assert.equal(app.vault.getAbstractFileByPath("生活/日记/2026-10-12.md").__content, "");
});

await check("空白日记补链接时不会留下多余空行", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoApplyOnCreate = false;
	await app.vault.create("日记/2026-10-12.md", "");
	await plugin.linkExistingNotes();
	assert.equal(
		app.vault.getAbstractFileByPath("日记/2026-10-12.md").__content,
		"所属月份：[[2026-10]]\n"
	);
});

await check("内容没变时不会反复重写 data.json", async () => {
	const { app, plugin } = await setup();
	const today = moment();
	const file = await app.vault.create(
		`日记/${today.format("YYYY-MM-DD")}.md`,
		"# To-do list\n- [ ] A\n"
	);
	await sleep(120);

	let saves = 0;
	const original = plugin.saveSettings.bind(plugin);
	plugin.saveSettings = async () => {
		saves += 1;
		return original();
	};

	await plugin.syncFromFile(file); // 第一次建立状态，允许写一次
	assert.equal(saves, 1);

	await plugin.syncFromFile(file);
	await plugin.syncFromFile(file);
	assert.equal(saves, 1, "内容一致时不应再写盘");

	await app.vault.modify(file, "# To-do list\n- [ ] A\n- [ ] B\n");
	await plugin.syncFromFile(file);
	assert.equal(saves, 2, "内容变化时应写一次");
});

console.log("自动套用开关");

await check("关闭「新建时自动套用」后不再写入", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoApplyOnCreate = false;
	await app.vault.create(`日记/${tomorrowKey()}.md`, "");
	await sleep(150);
	assert.equal(app.vault.getAbstractFileByPath(`日记/${tomorrowKey()}.md`).__content, "");
});

await check("打开空白日记时补上模板", async () => {
	const { app, plugin } = await setup();
	plugin.settings.autoApplyOnCreate = false;
	const file = await app.vault.create(`日记/${tomorrowKey()}.md`, "");
	await sleep(120);
	assert.equal(file.__content, "");
	app.workspace.emit("file-open", file);
	await sleep(30);
	assert.ok(file.__content.includes("# To-do list"));
});

console.log("命令");

await check("把模板插入当前笔记并定位光标", async () => {
	const { app, plugin } = await setup();
	const file = await app.vault.create("日记/2026-11-29.md", "");
	const editor = makeEditor();
	await plugin.insertTemplate(editor, { file });
	assert.ok(editor.value.includes("# To-do list"));
	const rendered = await plugin.renderFor(moment("2026-11-29", "YYYY-MM-DD"), file.path);
	assert.equal(editor.cursor.ch, rendered.cursorOffset);
});

console.log("模板来源");

await check("使用模板文件", async () => {
	const { app, plugin } = await setup();
	plugin.settings.templateSource = "file";
	plugin.settings.templateFile = "模板/日记模板.md";
	plugin.settings.injectTasksWithoutPlaceholder = false;
	await app.vault.create("模板/日记模板.md", "# {{title}}\n\n来自模板文件：{{date}}\n");
	await plugin.openDailyNote(moment("2026-11-25", "YYYY-MM-DD"));
	const file = app.vault.getAbstractFileByPath("日记/2026-11-25.md");
	assert.equal(
		file.__content,
		"# 2026-11-25\n\n来自模板文件：2026-11-25\n\n所属月份：[[2026-11]]\n"
	);
});

await check("模板文件不存在时回退内置模板", async () => {
	const { app, plugin } = await setup();
	plugin.settings.templateSource = "file";
	plugin.settings.templateFile = "模板/不存在.md";
	await plugin.openDailyNote(moment("2026-11-26", "YYYY-MM-DD"));
	const file = app.vault.getAbstractFileByPath("日记/2026-11-26.md");
	assert.ok(file.__content.startsWith("# To-do list"), file.__content);
});

await check("ensureTemplateFile 会自动创建模板文件", async () => {
	const { app, plugin } = await setup();
	plugin.settings.templateSource = "file";
	plugin.settings.templateFile = "模板/新建模板.md";
	const file = await plugin.ensureTemplateFile();
	assert.ok(file);
	assert.equal(file.path, "模板/新建模板.md");
	assert.ok(file.__content.includes("{{todo_list}}"));
});

console.log("自定义文件名格式");

await check("YYYY/MM/DD 会自动创建子文件夹", async () => {
	const { app, plugin } = await setup();
	plugin.settings.useCoreDailyNotes = false;
	plugin.settings.folder = "日记";
	plugin.settings.dateFormat = "YYYY/MM/DD";
	await plugin.openDailyNote(moment("2026-12-01", "YYYY-MM-DD"));
	const file = app.vault.getAbstractFileByPath("日记/2026/12/01.md");
	assert.ok(file, "应创建子文件夹中的日记");
	assert.ok(file.__content.startsWith("# To-do list"));
});

await check("中文日期格式可以反推出日期", async () => {
	const { app, plugin } = await setup();
	plugin.settings.useCoreDailyNotes = false;
	plugin.settings.folder = "日记";
	plugin.settings.dateFormat = "YYYY年MM月DD日";
	const file = await app.vault.create("日记/2026年11月23日.md", "");
	assert.equal(plugin.isDailyNotePath(file), true);
	const parsed = plugin.dateFromFile(file);
	assert.ok(parsed);
	assert.equal(parsed.format("YYYY-MM-DD"), "2026-11-23");
});

console.log(`\n插件集成测试：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
