import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { countCarryOver, renderItems } from "./daily-list";
import type { SyncedLists } from "./daily-list";
import type DailyNoteTemplatePlugin from "./main";
import { DEFAULT_TASKS, DEFAULT_TEMPLATE } from "./template";
import { moment } from "./time";
import { ConfirmModal, PreviewModal } from "./ui";

export interface DailyTemplateSettings {
	/** 模板来源：内置文本 / 仓库里的笔记文件 */
	templateSource: "inline" | "file";
	/** 内置模板正文 */
	templateContent: string;
	/** 模板文件路径（相对仓库根目录） */
	templateFile: string;
	/** 是否跟随 Obsidian「日记」核心插件的文件夹与文件名格式 */
	useCoreDailyNotes: boolean;
	/** 自定义日记文件夹（留空 = 仓库根目录） */
	folder: string;
	/** 自定义文件名格式（moment 格式串） */
	dateFormat: string;
	/** 新建空白日记时自动套用模板 */
	autoApplyOnCreate: boolean;
	/** 打开内容为空的日记时自动套用模板 */
	autoApplyOnOpenEmpty: boolean;
	/** 初始待办：还没有可同步的日记时使用 */
	recurringTasks: string;
	/** 模板里没有 {{todo_list}} / {{mission_list}} 时是否追加 */
	injectTasksWithoutPlaceholder: boolean;
	/** 待办区块的标题名 */
	todoHeading: string;
	/** 任务区块的标题名（与紧急任务共用同一套更新逻辑） */
	missionHeading: string;
	/** 紧急任务区块的标题名 */
	urgentHeading: string;
	/** 待办列表跟随今天的日记 */
	syncTodo: boolean;
	/** 紧急任务跟随今天的日记（完成的会被剔除） */
	syncMission: boolean;
	/** 最近一次同步的结果 */
	synced: SyncedLists | null;
	/** 自动生成年 / 月节点 */
	enableTimeNotes: boolean;
	/** 月节点文件名格式 */
	monthNoteFormat: string;
	/** 年节点文件名格式 */
	yearNoteFormat: string;
	/** 年 / 月节点存放文件夹（留空 = 与日记同目录） */
	timeNoteFolder: string;
	/** 额外日记文件夹（旧日记归档），逗号或换行分隔 */
	extraDailyFolders: string;
	/** 每天自动补建缺失的日记 */
	autoCreateDailyNote: boolean;
	/** 补建时最多往回找多少天 */
	backfillMaxDays: number;
	/** 自动打开今天的日记：不打开 / 仅新建时打开 / 每天首次启动打开 */
	autoOpenMode: "off" | "created" | "daily";
	/** 已经自动创建过日记的日期，避免重复 */
	lastAutoCreateDate: string;
	/** 已经自动打开过日记的日期，避免重复抢焦点 */
	lastOpenDate: string;
}

export const DEFAULT_SETTINGS: DailyTemplateSettings = {
	templateSource: "inline",
	templateContent: DEFAULT_TEMPLATE,
	templateFile: "模板/日记模板.md",
	useCoreDailyNotes: true,
	folder: "日记",
	dateFormat: "YYYY-MM-DD",
	autoApplyOnCreate: true,
	autoApplyOnOpenEmpty: true,
	recurringTasks: DEFAULT_TASKS,
	injectTasksWithoutPlaceholder: true,
	todoHeading: "To-do list",
	missionHeading: "Mission",
	urgentHeading: "Urgent mission",
	syncTodo: true,
	syncMission: true,
	synced: null,
	enableTimeNotes: true,
	monthNoteFormat: "YYYY-MM",
	yearNoteFormat: "YYYY",
	timeNoteFolder: "",
	extraDailyFolders: "",
	autoCreateDailyNote: true,
	backfillMaxDays: 31,
	autoOpenMode: "daily",
	lastAutoCreateDate: "",
	lastOpenDate: "",
};

export class DailyTemplateSettingTab extends PluginSettingTab {
	plugin: DailyNoteTemplatePlugin;
	private saveTimer: number | null = null;

	constructor(app: App, plugin: DailyNoteTemplatePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		this.flushSave();
	}

	private flushSave(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.plugin.saveSettings();
		}
	}

	private queueSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.plugin.saveSettings();
		}, 400);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("dnt-settings");

		containerEl.createEl("h2", { text: "日记模板" });
		containerEl.createEl("p", {
			cls: "dnt-hint",
			text: "每次新建（或打开空白）日记时，插件会把这里的模板写进去。模板里的 {{todo_list}} 和 {{mission_list}} 会自动跟随「今天」的日记更新。",
		});

		this.renderTemplateSection(containerEl);
		this.renderSyncSection(containerEl);
		this.renderTasksSection(containerEl);
		this.renderLocationSection(containerEl);
		this.renderTimeNotesSection(containerEl);
		this.renderAutomationSection(containerEl);
		this.renderVariablesSection(containerEl);
	}

	// ─────────────────────────── 模板 ───────────────────────────

	private renderTemplateSection(parent: HTMLElement): void {
		new Setting(parent).setName("模板").setHeading();

		new Setting(parent)
			.setName("模板来源")
			.setDesc(
				"内置文本：直接在本页编辑；笔记文件：用仓库里的一个 Markdown 笔记当模板，方便同步和版本管理。"
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("inline", "内置文本")
					.addOption("file", "笔记文件")
					.setValue(this.plugin.settings.templateSource)
					.onChange(async (value) => {
						this.plugin.settings.templateSource = value === "file" ? "file" : "inline";
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.templateSource === "file") {
			this.renderTemplateFileSetting(parent);
		} else {
			this.renderTemplateTextarea(parent);
		}
	}

	private renderTemplateTextarea(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "dnt-block" });
		wrap.createEl("div", { cls: "dnt-block-title", text: "模板内容" });
		wrap.createEl("div", {
			cls: "dnt-block-desc",
			text: "{{todo_list}} 放待办，{{mission_list}} 放任务，{{urgent_list}} 放紧急任务，{{cursor}} 决定打开日记后光标停在哪。",
		});

		const textarea = wrap.createEl("textarea", { cls: "dnt-textarea" });
		textarea.value = this.plugin.settings.templateContent;
		textarea.rows = 14;
		textarea.spellcheck = false;
		textarea.addEventListener("input", () => {
			this.plugin.settings.templateContent = textarea.value;
			this.queueSave();
		});
		textarea.addEventListener("blur", () => this.flushSave());

		new Setting(parent)
			.setClass("dnt-actions")
			.addButton((button) =>
				button.setButtonText("预览渲染结果").onClick(() => void this.preview())
			)
			.addButton((button) =>
				button
					.setButtonText("恢复默认模板")
					.setWarning()
					.onClick(() => this.restoreDefaultTemplate(textarea))
			);
	}

	private restoreDefaultTemplate(textarea: HTMLTextAreaElement): void {
		new ConfirmModal(
			this.app,
			"恢复默认模板？",
			"当前模板内容会被默认模板替换，且无法撤销。",
			"恢复",
			(confirmed) => {
				if (!confirmed) return;
				this.plugin.settings.templateContent = DEFAULT_TEMPLATE;
				textarea.value = DEFAULT_TEMPLATE;
				void this.plugin.saveSettings();
				new Notice("已恢复默认模板。");
			}
		).open();
	}

	private renderTemplateFileSetting(parent: HTMLElement): void {
		new Setting(parent)
			.setName("模板文件路径")
			.setDesc(
				"相对仓库根目录的 Markdown 文件，例如 模板/日记模板.md。文件不存在时会按内置模板自动创建。"
			)
			.addText((text) => {
				text
					.setPlaceholder("模板/日记模板.md")
					.setValue(this.plugin.settings.templateFile)
					.onChange((value) => {
						this.plugin.settings.templateFile = value;
						this.queueSave();
					});
				text.inputEl.addClass("dnt-text-wide");
			});

		new Setting(parent)
			.setClass("dnt-actions")
			.addButton((button) =>
				button
					.setButtonText("创建 / 打开模板文件")
					.setCta()
					.onClick(() => void this.openTemplateFile())
			)
			.addButton((button) =>
				button.setButtonText("预览渲染结果").onClick(() => void this.preview())
			);
	}

	private async openTemplateFile(): Promise<void> {
		const file = await this.plugin.ensureTemplateFile();
		if (file) await this.app.workspace.getLeaf(false).openFile(file);
	}

	// ─────────────────────────── 列表同步 ───────────────────────────

	private renderSyncSection(parent: HTMLElement): void {
		new Setting(parent).setName("列表同步").setHeading();

		parent.createEl("p", {
			cls: "dnt-hint",
			text: "打开插件或修改「今天」的日记时，插件会读取三个区块：待办原样保留（勾选状态在生成新日记时统一还原）；任务和紧急任务共用一套逻辑——只保留没打勾的，打勾的从模板里消失，但当天日记不受影响。",
		});

		new Setting(parent)
			.setName("待办区块标题")
			.setDesc("用来识别日记里的待办列表，例如「To-do list」。")
			.addText((text) => {
				text
					.setPlaceholder("To-do list")
					.setValue(this.plugin.settings.todoHeading)
					.onChange((value) => {
						this.plugin.settings.todoHeading = value;
						this.queueSave();
					});
				text.inputEl.addClass("dnt-text-wide");
			});

		new Setting(parent)
			.setName("任务区块标题")
			.setDesc("例如「Mission」。与紧急任务共用同一套「只带未完成」的逻辑。")
			.addText((text) => {
				text
					.setPlaceholder("Mission")
					.setValue(this.plugin.settings.missionHeading)
					.onChange((value) => {
						this.plugin.settings.missionHeading = value;
						this.queueSave();
					});
				text.inputEl.addClass("dnt-text-wide");
			});

		new Setting(parent)
			.setName("紧急任务区块标题")
			.setDesc("例如「Urgent mission」。")
			.addText((text) => {
				text
					.setPlaceholder("Urgent mission")
					.setValue(this.plugin.settings.urgentHeading)
					.onChange((value) => {
						this.plugin.settings.urgentHeading = value;
						this.queueSave();
					});
				text.inputEl.addClass("dnt-text-wide");
			});

		new Setting(parent)
			.setName("待办列表跟随今天的日记")
			.setDesc("关闭后，模板里的待办改用下面「初始待办」里的内容。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncTodo).onChange(async (value) => {
					this.plugin.settings.syncTodo = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		new Setting(parent)
			.setName("任务 / 紧急任务跟随今天的日记")
			.setDesc("两者共用同一套逻辑；关闭后，模板里的这两块永远为空。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncMission).onChange(async (value) => {
					this.plugin.settings.syncMission = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		this.renderSyncStatus(parent);
	}

	private renderSyncStatus(parent: HTMLElement): void {
		const synced = this.plugin.settings.synced;
		const box = parent.createDiv({ cls: "dnt-sync-box" });

		if (!synced) {
			box.createEl("div", {
				cls: "dnt-hint",
				text: "还没有同步过：现在还没有今天的日记，模板会先使用下面的「初始待办」。",
			});
		} else {
			const counts = countCarryOver(synced);
			box.createEl("div", {
				cls: "dnt-sync-source",
				text: `同步来源：${synced.sourcePath}（${synced.sourceDate}）｜待办 ${counts.todo} 条｜任务会带走 ${counts.mission} 条｜紧急任务会带走 ${counts.urgent} 条`,
			});

			const preview = box.createEl("pre", { cls: "dnt-sync-preview" });
			const todoLines = renderItems(synced.todo ?? []) || "（空）";
			const missionLines = renderItems(synced.mission ?? [], { dropChecked: true }) || "（空）";
			const urgentLines = renderItems(synced.urgent ?? [], { dropChecked: true }) || "（空）";
			preview.setText(
				`待办：\n${todoLines}\n\n任务（未完成）：\n${missionLines}\n\n紧急任务（未完成）：\n${urgentLines}`
			);
		}

		new Setting(parent)
			.setClass("dnt-actions")
			.addButton((button) =>
				button
					.setButtonText("从今天的日记同步")
					.setCta()
					.onClick(() => void this.syncNow())
			)
			.addButton((button) =>
				button.setButtonText("打开今天的日记").onClick(() => void this.plugin.openDailyNote())
			);
	}

	private async syncNow(): Promise<void> {
		const ok = await this.plugin.syncFromToday(true);
		if (!ok) new Notice("没有找到今天的日记，或读取失败。");
		this.display();
	}

	private async fillNow(): Promise<void> {
		const count = await this.plugin.fillGapsInWindow();
		if (count === 0) new Notice("最近的日子没有缺口。");
	}

	private async preview(): Promise<void> {
		const day = moment();
		const rendered = await this.plugin.renderFor(day, this.plugin.getNotePath(day));
		new PreviewModal(this.app, "模板预览", rendered.content).open();
	}

	// ─────────────────────────── 初始待办 ───────────────────────────

	private renderTasksSection(parent: HTMLElement): void {
		new Setting(parent).setName("初始待办").setHeading();

		const wrap = parent.createDiv({ cls: "dnt-block" });
		wrap.createEl("div", { cls: "dnt-block-title", text: "初始待办清单（一行一个）" });
		wrap.createEl("div", {
			cls: "dnt-block-desc",
			text: "只在还没有可同步的日记时使用（例如第一次使用）。平时改待办请直接改今天日记里的列表，模板会自动跟随。",
		});

		const textarea = wrap.createEl("textarea", { cls: "dnt-textarea dnt-textarea-small" });
		textarea.value = this.plugin.settings.recurringTasks;
		textarea.rows = 8;
		textarea.spellcheck = false;
		textarea.addEventListener("input", () => {
			this.plugin.settings.recurringTasks = textarea.value;
			this.queueSave();
		});
		textarea.addEventListener("blur", () => this.flushSave());

		new Setting(parent)
			.setName("模板里没写占位符时也插入列表")
			.setDesc("开启后，即使模板里忘了放 {{todo_list}} / {{mission_list}}，列表也会追加到同名标题下面。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.injectTasksWithoutPlaceholder)
					.onChange(async (value) => {
						this.plugin.settings.injectTasksWithoutPlaceholder = value;
						await this.plugin.saveSettings();
					})
			);
	}

	// ─────────────────────────── 位置 ───────────────────────────

	private renderLocationSection(parent: HTMLElement): void {
		new Setting(parent).setName("日记位置").setHeading();

		const core = this.plugin.getCoreDailyNotesOptions();
		const coreDesc = core
			? `当前读取到：文件夹「${core.folder || "仓库根目录"}」，文件名格式「${core.format}」。`
			: "没有读取到 Obsidian「日记」核心插件的设置（可能未启用），请使用下面的自定义设置。";

		new Setting(parent)
			.setName("跟随 Obsidian「日记」核心插件")
			.setDesc(coreDesc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.useCoreDailyNotes).onChange(async (value) => {
					this.plugin.settings.useCoreDailyNotes = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		const useCore = this.plugin.settings.useCoreDailyNotes;

		new Setting(parent)
			.setName("日记文件夹")
			.setDesc("留空表示放在仓库根目录。跟随核心插件时此项不生效。")
			.addText((text) => {
				text
					.setPlaceholder("日记")
					.setValue(this.plugin.settings.folder)
					.onChange((value) => {
						this.plugin.settings.folder = value;
						this.queueSave();
						refresh();
					});
				text.inputEl.disabled = useCore;
				text.inputEl.addClass("dnt-text-wide");
			});

		new Setting(parent)
			.setName("文件名格式")
			.setDesc("moment 格式，例如 YYYY-MM-DD、YYYY年MM月DD日；写成 YYYY/MM/DD 会自动创建子文件夹。")
			.addText((text) => {
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dateFormat)
					.onChange((value) => {
						this.plugin.settings.dateFormat = value;
						this.queueSave();
						refresh();
					});
				text.inputEl.disabled = useCore;
				text.inputEl.addClass("dnt-text-wide");
			});

		const exampleEl = parent.createEl("p", { cls: "dnt-hint dnt-path-example" });
		const refresh = (): void => {
			exampleEl.setText(`按当前设置，今天的日记会创建在：${this.plugin.pathExample(moment())}`);
		};
		refresh();

		new Setting(parent)
			.setName("额外日记文件夹")
			.setDesc(
				"旧日记归档在别的文件夹时填这里（多个用逗号分隔），它们也会被纳入年/月节点和「补链接」命令；不会在这些文件夹里新建日记。"
			)
			.addText((text) => {
				text
					.setPlaceholder("例如：生活/日记")
					.setValue(this.plugin.settings.extraDailyFolders)
					.onChange((value) => {
						this.plugin.settings.extraDailyFolders = value;
						this.queueSave();
					});
				text.inputEl.addClass("dnt-text-wide");
			});
	}

	// ─────────────────────────── 年 / 月节点 ───────────────────────────

	private renderTimeNotesSection(parent: HTMLElement): void {
		new Setting(parent).setName("年 / 月节点").setHeading();

		parent.createEl("p", {
			cls: "dnt-hint",
			text: "每个月第一次生成日记时会创建月节点，每年第一次创建月节点时会创建年节点；月节点自动挂上年节点，日记创建时末尾自动挂上所属月份链接。月节点里的「## 日记」清单和年节点里的「## 月份」清单会自动补全。",
		});

		new Setting(parent)
			.setName("启用年 / 月节点")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableTimeNotes).onChange(async (value) => {
					this.plugin.settings.enableTimeNotes = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		const disabled = !this.plugin.settings.enableTimeNotes;

		new Setting(parent)
			.setName("月节点文件名格式")
			.setDesc("moment 格式，默认 YYYY-MM，例如 2026-11。")
			.addText((text) => {
				text
					.setPlaceholder("YYYY-MM")
					.setValue(this.plugin.settings.monthNoteFormat)
					.onChange((value) => {
						this.plugin.settings.monthNoteFormat = value;
						this.queueSave();
					});
				text.inputEl.disabled = disabled;
				text.inputEl.addClass("dnt-text-wide");
			});

		new Setting(parent)
			.setName("年节点文件名格式")
			.setDesc("moment 格式，默认 YYYY，例如 2026。")
			.addText((text) => {
				text
					.setPlaceholder("YYYY")
					.setValue(this.plugin.settings.yearNoteFormat)
					.onChange((value) => {
						this.plugin.settings.yearNoteFormat = value;
						this.queueSave();
					});
				text.inputEl.disabled = disabled;
				text.inputEl.addClass("dnt-text-wide");
			});

		new Setting(parent)
			.setName("节点存放文件夹")
			.setDesc("留空表示和日记放在同一个文件夹。")
			.addText((text) => {
				text
					.setPlaceholder("（与日记同目录）")
					.setValue(this.plugin.settings.timeNoteFolder)
					.onChange((value) => {
						this.plugin.settings.timeNoteFolder = value;
						this.queueSave();
					});
				text.inputEl.disabled = disabled;
				text.inputEl.addClass("dnt-text-wide");
			});

		new Setting(parent)
			.setClass("dnt-actions")
			.addButton((button) =>
				button
					.setButtonText("立即生成今年/本月节点")
					.setCta()
					.setDisabled(disabled)
					.onClick(() => void this.syncTimeNotesNow())
			)
			.addButton((button) =>
				button
					.setButtonText("给已有日记补链接")
					.setDisabled(disabled)
					.onClick(() => void this.plugin.linkExistingNow())
			);
	}

	private async syncTimeNotesNow(): Promise<void> {
		await this.plugin.syncTimeNotesNow();
	}

	// ─────────────────────────── 自动套用 ───────────────────────────

	private renderAutomationSection(parent: HTMLElement): void {
		new Setting(parent).setName("自动套用").setHeading();

		new Setting(parent)
			.setName("自动补建缺失的日记")
			.setDesc(
				"启动时以及跨天/休眠唤醒后，会把「上一篇日记」到今天之间漏掉的日子全部按模板补上。哪天没开 Obsidian 也不会缺记录。"
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoCreateDailyNote).onChange(async (value) => {
					this.plugin.settings.autoCreateDailyNote = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		new Setting(parent)
			.setName("最多向前补几天")
			.setDesc("补建时最多往回找多少天，避免第一次启用就把很久以前的日子全都建出来（默认 31 天）。")
			.addText((text) => {
				text.setValue(String(this.plugin.settings.backfillMaxDays));
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = "366";
				text.inputEl.addClass("dnt-number");
				text.inputEl.disabled = !this.plugin.settings.autoCreateDailyNote;
				text.onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.backfillMaxDays =
						Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 366) : 31;
					this.queueSave();
				});
			});

		new Setting(parent)
			.setClass("dnt-actions")
			.addButton((button) =>
				button
					.setButtonText("立即补齐最近 N 天")
					.setCta()
					.onClick(() => void this.fillNow())
			)
			.addButton((button) =>
				button.setButtonText("打开今天的日记").onClick(() => void this.plugin.openDailyNote())
			);

		new Setting(parent)
			.setName("自动打开今天的日记")
			.setDesc(
				"「每天首次启动」会在当天第一次打开 Obsidian 时切到当天的日记；「仅新建时」只在刚补建出来时打开。跨天自动创建不会抢焦点。"
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("off", "不自动打开")
					.addOption("created", "仅新建时打开")
					.addOption("daily", "每天首次启动打开（推荐）")
					.setValue(this.plugin.settings.autoOpenMode)
					.onChange(async (value) => {
						this.plugin.settings.autoOpenMode =
							value === "off" || value === "created" ? value : "daily";
						await this.plugin.saveSettings();
					})
			);

		new Setting(parent)
			.setName("新建日记时自动套用")
			.setDesc(
				"通过双链、其他插件或「日记」核心命令新建出空白日记时，自动写入模板。已在日记文件夹内且文件名符合日期格式的笔记才会生效。"
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoApplyOnCreate).onChange(async (value) => {
					this.plugin.settings.autoApplyOnCreate = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(parent)
			.setName("打开空白日记时自动套用")
			.setDesc("只对正文完全为空的日记生效，绝不会覆盖已经写过的内容。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoApplyOnOpenEmpty)
					.onChange(async (value) => {
						this.plugin.settings.autoApplyOnOpenEmpty = value;
						await this.plugin.saveSettings();
					})
			);

		parent.createEl("p", {
			cls: "dnt-hint",
			text: "想给已经写过的笔记补模板，可以用命令「把日记模板插入当前笔记」或「用模板重建当前笔记」。",
		});
	}

	// ─────────────────────────── 变量说明 ───────────────────────────

	private renderVariablesSection(parent: HTMLElement): void {
		new Setting(parent).setName("可用变量").setHeading();

		const rows: Array<[string, string]> = [
			["{{todo_list}}", "待办列表（跟随今天，勾选状态会还原）"],
			["{{mission_list}}", "任务列表（跟随今天，已完成的会被剔除）"],
			["{{urgent_list}}", "紧急任务（与 Mission 同一套逻辑）"],
			["{{todo_heading}} / {{mission_heading}} / {{urgent_heading}}", "三个区块的标题名（改设置即生效）"],
			["{{date}}", "日期，格式为 2026-11-23"],
			["{{date:YYYY年M月D日}}", "自定义日期格式"],
			["{{time}} / {{time:HH:mm:ss}}", "时间"],
			["{{yesterday}} / {{tomorrow}}", "昨天 / 明天（也支持自定义格式）"],
			["{{weekday}}", "星期几"],
			["{{title}} / {{filename}}", "笔记标题（不含 .md）"],
			["{{folder}}", "笔记所在文件夹"],
			["{{cursor}}", "打开日记后光标停放的位置"],
		];

		const table = parent.createDiv({ cls: "dnt-vars" });
		for (const [code, desc] of rows) {
			const row = table.createDiv({ cls: "dnt-var" });
			row.createEl("code", { text: code });
			row.createSpan({ cls: "dnt-var-desc", text: desc });
		}

		parent.createEl("p", {
			cls: "dnt-hint",
			text: `初始待办默认是：${DEFAULT_TASKS.split("\n").join("、")}，可以在上面随时增删。`,
		});
	}
}
