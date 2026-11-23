/**
 * 直接加载编译产物 main.js（也就是真正会被放进 Obsidian 插件的文件），
 * 用一个假的 obsidian 模块顶替真实依赖，确认它能被 require、能注册命令、能写出日记。
 */
import { createRequire } from "node:module";
import Module from "node:module";
import assert from "node:assert/strict";
import * as fake from "./fake-obsidian.mjs";

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
	if (request === "obsidian") return fake;
	return originalLoad.call(this, request, parent, isMain);
};

let bundle;
try {
	bundle = require("../main.js");
} finally {
	Module._load = originalLoad;
}

const PluginClass = bundle.default ?? bundle;

assert.equal(typeof PluginClass, "function", "main.js 应当默认导出一个插件类");

const app = fake.createApp({ coreDailyNotes: { folder: "日记", format: "YYYY-MM-DD" } });
const plugin = new PluginClass(app, { id: "daily-note-template" });
await plugin.onload();

assert.equal(app.__commands.length, 10, "应注册 10 个命令");
assert.equal(app.__ribbons.length, 1, "应注册一个左侧图标");
assert.equal(app.__settingTabs.length, 1, "应注册设置页");

await plugin.openDailyNote(fake.moment("2026-11-23", "YYYY-MM-DD"));
const file = app.vault.getAbstractFileByPath("日记/2026-11-23.md");
assert.ok(file, "应创建今日日记");
assert.ok(file.__content.startsWith("# To-do list"), file.__content);
assert.ok(file.__content.includes("- [ ] 喝水 2L"), file.__content);

console.log("  ✓ main.js 可以加载，命令/设置页注册正常，能按模板生成日记");
console.log("\n产物冒烟测试：通过");
