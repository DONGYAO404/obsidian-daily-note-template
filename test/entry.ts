// 测试入口：把插件与假 Obsidian 打进同一个 bundle，
// 保证两边共享同一批类（instanceof 才成立）。
import DailyNoteTemplatePlugin from "../src/main";
import { createApp, TFile, notices } from "./fake-obsidian.mjs";

export { DailyNoteTemplatePlugin, createApp, TFile, notices };
