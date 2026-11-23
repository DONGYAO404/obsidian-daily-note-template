/**
 * 一个极简的「假 Obsidian」：只实现本插件用到的那部分 API，
 * 用于在 node 里真正加载、驱动插件逻辑（不需要打开 Obsidian）。
 */
import realMoment from "moment";
import "moment/locale/zh-cn.js";

if (!globalThis.window) {
	globalThis.window = globalThis;
}

realMoment.locale("zh-cn");

export const moment = realMoment;

export function normalizePath(path) {
	const normalized = String(path)
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\.\//, "")
		.replace(/\/\.\//g, "/")
		.replace(/^\//, "");
	return normalized === "" ? "/" : normalized;
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const notices = [];

export class Notice {
	constructor(message) {
		this.message = message;
		notices.push(message);
	}
	hide() {}
}

export class Component {}

export class Plugin extends Component {
	constructor(app, manifest) {
		super();
		this.app = app;
		this.manifest = manifest ?? { id: "daily-note-template" };
		this.registeredEvents = [];
	}
	async loadData() {
		return this.app.__data ?? null;
	}
	async saveData(data) {
		this.app.__data = data;
	}
	addRibbonIcon(name, title, callback) {
		(this.app.__ribbons ??= []).push({ name, title, callback });
	}
	addCommand(command) {
		(this.app.__commands ??= []).push(command);
	}
	addSettingTab(tab) {
		(this.app.__settingTabs ??= []).push(tab);
	}
	registerEvent(ref) {
		this.registeredEvents.push(ref);
	}
	registerDomEvent() {}
	registerInterval(id) {
		// node 里让定时器不阻塞测试进程退出
		if (id && typeof id.unref === "function") id.unref();
		return id;
	}
}

function fakeElement() {
	const el = {
		empty() {},
		addClass() {},
		createEl() {
			return fakeElement();
		},
		createDiv() {
			return fakeElement();
		},
		createSpan() {
			return fakeElement();
		},
		appendChild() {},
		setText() {},
		addEventListener() {},
	};
	return el;
}

export class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = fakeElement();
	}
	display() {}
	hide() {}
}

class FakeText {
	constructor() {
		this.inputEl = { addClass() {}, disabled: false };
	}
	setPlaceholder() {
		return this;
	}
	setValue() {
		return this;
	}
	onChange() {
		return this;
	}
}

class FakeToggle {
	setValue() {
		return this;
	}
	onChange() {
		return this;
	}
}

class FakeDropdown {
	addOption() {
		return this;
	}
	setValue() {
		return this;
	}
	onChange() {
		return this;
	}
}

class FakeButton {
	setButtonText() {
		return this;
	}
	setCta() {
		return this;
	}
	setWarning() {
		return this;
	}
	setIcon() {
		return this;
	}
	setDisabled() {
		return this;
	}
	onClick() {
		return this;
	}
}

export class Setting {
	constructor(containerEl) {
		this.containerEl = containerEl;
	}
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	setHeading() {
		return this;
	}
	setClass() {
		return this;
	}
	addText(cb) {
		cb(new FakeText());
		return this;
	}
	addTextArea(cb) {
		cb(new FakeText());
		return this;
	}
	addToggle(cb) {
		cb(new FakeToggle());
		return this;
	}
	addDropdown(cb) {
		cb(new FakeDropdown());
		return this;
	}
	addButton(cb) {
		cb(new FakeButton());
		return this;
	}
}

export class Modal {
	constructor(app) {
		this.app = app;
		this.contentEl = fakeElement();
		this.titleEl = fakeElement();
	}
	open() {
		if (this.onOpen) this.onOpen();
	}
	close() {
		if (this.onClose) this.onClose();
	}
}

export class MarkdownView {
	constructor(file, editor) {
		this.file = file;
		this.editor = editor;
	}
}

export class TFile {
	constructor(path) {
		this.path = path;
		this.name = path.split("/").pop();
		this.basename = this.name.replace(/\.md$/, "");
		this.extension = this.name.includes(".") ? this.name.split(".").pop() : "";
		this.parent = null;
		this.__content = "";
	}
}

export class TFolder {
	constructor(path) {
		this.path = path;
		this.name = path.split("/").pop();
	}
}

export class TAbstractFile {}

class Emitter {
	constructor() {
		this.handlers = new Map();
	}
	on(name, callback) {
		if (!this.handlers.has(name)) this.handlers.set(name, []);
		this.handlers.get(name).push(callback);
		return { name, callback };
	}
	off(name, callback) {
		const list = this.handlers.get(name) ?? [];
		const index = list.indexOf(callback);
		if (index >= 0) list.splice(index, 1);
	}
	emit(name, payload) {
		for (const callback of [...(this.handlers.get(name) ?? [])]) callback(payload);
	}
}

export class FakeVault extends Emitter {
	constructor() {
		super();
		this.nodes = new Map();
	}
	getAbstractFileByPath(path) {
		return this.nodes.get(path) ?? null;
	}
	async create(path, content = "") {
		if (this.nodes.has(path)) throw new Error(`文件已存在：${path}`);
		const file = new TFile(path);
		file.__content = content;
		this.nodes.set(path, file);
		this.emit("create", file);
		return file;
	}
	async createFolder(path) {
		if (this.nodes.has(path)) throw new Error(`已存在：${path}`);
		const folder = new TFolder(path);
		this.nodes.set(path, folder);
		return folder;
	}
	async modify(file, content) {
		file.__content = content;
		this.emit("modify", file);
	}
	async process(file, fn) {
		const before = file.__content ?? "";
		const after = fn(before);
		file.__content = after;
		if (after !== before) this.emit("modify", file);
		return after;
	}
	async cachedRead(file) {
		return file.__content ?? "";
	}
	async read(file) {
		return file.__content ?? "";
	}
	getFiles() {
		return [...this.nodes.values()].filter((node) => node instanceof TFile);
	}
	getMarkdownFiles() {
		return this.getFiles().filter((file) => file.extension === "md");
	}
}

export class FakeWorkspace extends Emitter {
	constructor(app) {
		super();
		this.app = app;
		this.activeFile = null;
		this.activeView = null;
		this.layoutReadyCallbacks = [];
	}
	onLayoutReady(callback) {
		this.layoutReadyCallbacks.push(callback);
	}
	triggerLayoutReady() {
		for (const callback of this.layoutReadyCallbacks.splice(0)) callback();
	}
	getLeaf() {
		return {
			openFile: async (file) => {
				this.activeFile = file;
				this.emit("file-open", file);
			},
		};
	}
	getActiveFile() {
		return this.activeFile;
	}
	getActiveViewOfType() {
		return this.activeView;
	}
}

export function createApp(options = {}) {
	const app = {
		vault: null,
		workspace: null,
		internalPlugins: null,
		__data: null,
		__commands: [],
		__settingTabs: [],
		__ribbons: [],
	};
	app.vault = new FakeVault();
	app.workspace = new FakeWorkspace(app);
	if (options.coreDailyNotes) {
		app.internalPlugins = {
			getPluginById(id) {
				if (id !== "daily-notes") return null;
				return { instance: { options: options.coreDailyNotes } };
			},
		};
	}
	return app;
}
