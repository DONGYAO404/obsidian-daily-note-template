import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	TFolder,
	normalizePath,
	type Editor,
	type MarkdownFileInfo,
	type TAbstractFile,
} from "obsidian";
import { appendToSection, countCarryOver, itemsFromLines, parseLists, renderItems, replaceSection } from "./daily-list";
import type { ListItem, SectionNames, SyncedLists } from "./daily-list";
import { DEFAULT_SETTINGS, DailyTemplateSettingTab } from "./settings";
import type { DailyTemplateSettings } from "./settings";
import { matchesDateFormat, normalizeTaskLines, renderTemplate } from "./template";
import type { RenderResult } from "./template";
import { moment, type Moment } from "./time";
import { ConfirmModal, DatePickerModal, PreviewModal } from "./ui";

/** 小工具：等待若干毫秒 */
const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

interface CoreDailyNotesOptions {
	folder: string;
	format: string;
}

export default class DailyNoteTemplatePlugin extends Plugin {
	settings: DailyTemplateSettings = { ...DEFAULT_SETTINGS };

	/** 本插件自己创建的文件，避免 create 事件重复套用模板 */
	private pendingCreates = new Set<string>();
	/** 正在写入模板的文件，避免 open/create 事件互相触发 */
	private applying = new Set<string>();
	/** 模板文件缺失的提示只弹一次 */
	private warnedMissingTemplate = false;
	/** 「今天」的日记被修改后，延迟同步模板列表 */
	private syncTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new DailyTemplateSettingTab(this.app, this));

		this.addRibbonIcon("calendar-plus", "打开今日日记", () => {
			void this.openDailyNote();
		});

		this.addCommand({
			id: "open-today",
			name: "打开今日日记",
			callback: () => void this.openDailyNote(),
		});

		this.addCommand({
			id: "open-date",
			name: "打开指定日期的日记",
			callback: () => this.pickDate(),
		});

		this.addCommand({
			id: "insert-template",
			name: "把日记模板插入当前笔记",
			editorCallback: (editor: Editor, info: MarkdownFileInfo) => {
				void this.insertTemplate(editor, info);
			},
		});

		this.addCommand({
			id: "rebuild-current",
			name: "用模板重建当前笔记（覆盖正文）",
			callback: () => void this.rebuildCurrent(),
		});

		this.addCommand({
			id: "edit-template",
			name: "编辑日记模板",
			callback: () => void this.editTemplate(),
		});

		this.addCommand({
			id: "preview-template",
			name: "预览模板渲染结果",
			callback: () => void this.previewTemplate(),
		});

		this.addCommand({
			id: "sync-lists",
			name: "从今天的日记同步模板列表",
			callback: () => void this.syncListsNow(),
		});

		this.addCommand({
			id: "fill-gaps",
			name: "补齐最近缺失的日记",
			callback: () => void this.fillGapsNow(),
		});

		this.addCommand({
			id: "sync-time-notes",
			name: "生成 / 更新年、月节点",
			callback: () => void this.syncTimeNotesNow(),
		});

		this.addCommand({
			id: "link-existing",
			name: "给已有日记补上月份链接",
			callback: () => void this.linkExistingNow(),
		});

		// 任何来源新建的空白日记（点击双链、核心日记插件、其他插件）都会套用模板
		this.registerEvent(
			this.app.vault.on("create", (file: TAbstractFile) => {
				void this.handleCreated(file);
			})
		);

		// 打开一篇已存在但内容为空的日记时补上模板
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				void this.handleOpened(file);
			})
		);

		// 「今天」的日记一改，模板里的两个列表就跟着更新
		this.registerEvent(
			this.app.vault.on("modify", (file: TAbstractFile) => {
				this.handleModified(file);
			})
		);

		// 每分钟检查一次日期是否变了（跨天/休眠唤醒），变了就把缺的日子补上
		this.registerInterval(
			window.setInterval(() => {
				const key = moment().format("YYYY-MM-DD");
				if (key === this.lastKnownDate) return;
				this.lastKnownDate = key;
				void this.ensureDailyNotes();
			}, 60_000)
		);

		// 启动后：先同步列表，再确保今天的日记存在，按设置决定是否打开
		this.app.workspace.onLayoutReady(() => {
			void this.startupTasks();
		});
	}

	onunload(): void {
		if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
		this.pendingCreates.clear();
		this.applying.clear();
	}

	// ─────────────────────────── 设置读写 ───────────────────────────

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ─────────────────────────── 路径 / 日期 ───────────────────────────

	/** Obsidian「日记」核心插件的配置（用户可能没装或没启用） */
	getCoreDailyNotesOptions(): CoreDailyNotesOptions | null {
		const internal = (
			this.app as unknown as {
				internalPlugins?: {
					getPluginById?: (
						id: string
					) => { instance?: { options?: Record<string, unknown> } } | null;
				};
			}
		).internalPlugins;
		const options = internal?.getPluginById?.("daily-notes")?.instance?.options;
		if (!options) return null;
		const folder = typeof options.folder === "string" ? options.folder : "";
		const format =
			typeof options.format === "string" && options.format.trim() !== ""
				? options.format.trim()
				: "YYYY-MM-DD";
		return { folder, format };
	}

	/** 当前实际使用的日记文件夹（相对仓库根目录，根目录返回空字符串） */
	getFolder(): string {
		const core = this.settings.useCoreDailyNotes ? this.getCoreDailyNotesOptions() : null;
		const raw = core ? core.folder : this.settings.folder;
		const trimmed = (raw ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
		if (!trimmed || trimmed === ".") return "";
		return normalizePath(trimmed).replace(/^\/+|\/+$/g, "");
	}

	getDateFormat(): string {
		const core = this.settings.useCoreDailyNotes ? this.getCoreDailyNotesOptions() : null;
		const format = core ? core.format : this.settings.dateFormat;
		return format && format.trim() !== "" ? format.trim() : "YYYY-MM-DD";
	}

	/** 某一天的日记路径（可能包含子文件夹，例如 YYYY/MM/DD） */
	getNotePath(day?: Moment): string {
		const target = day ?? moment();
		const folder = this.getFolder();
		const name = target.format(this.getDateFormat());
		const relative = folder ? `${folder}/${name}.md` : `${name}.md`;
		return normalizePath(relative);
	}

	/** 给设置页展示用的路径示例 */
	pathExample(day?: Moment): string {
		try {
			return this.getNotePath(day);
		} catch {
			return "（格式有误）";
		}
	}

	/** 所有日记文件夹：主文件夹 + 额外归档文件夹 */
	dailyFolders(): string[] {
		const folders: string[] = [this.getFolder()];
		const raw = this.settings.extraDailyFolders ?? "";
		for (const part of raw.split(/[,，\n]/)) {
			const trimmed = part.trim().replace(/^\/+/, "").replace(/\/+$/, "");
			if (!trimmed) continue;
			const normalized = normalizePath(trimmed).replace(/^\/+|\/+$/g, "");
			if (normalized && !folders.includes(normalized)) folders.push(normalized);
		}
		return folders;
	}

	/** 某个文件相对某个日记文件夹的路径；不在该文件夹下返回 null */
	private relativeTo(file: TFile, folder: string): string | null {
		if (!folder) return file.path;
		if (file.path === folder) return null;
		if (!file.path.startsWith(`${folder}/`)) return null;
		return file.path.slice(folder.length + 1);
	}

	/** 判断文件是否位于任一日记文件夹内并符合日期文件名格式 */
	isDailyNotePath(file: TFile | null): boolean {
		if (!file || file.extension.toLowerCase() !== "md") return false;
		const format = this.getDateFormat();
		for (const folder of this.dailyFolders()) {
			const relative = this.relativeTo(file, folder);
			if (relative === null) continue;
			if (matchesDateFormat(relative.replace(/\.md$/i, ""), format)) return true;
		}
		return false;
	}

	/** 只认主日记文件夹（自动套用、自动补建只在这里发生） */
	isManagedDailyNote(file: TFile | null): boolean {
		if (!file || file.extension.toLowerCase() !== "md") return false;
		const relative = this.relativeTo(file, this.getFolder());
		if (relative === null) return false;
		return matchesDateFormat(relative.replace(/\.md$/i, ""), this.getDateFormat());
	}

	/** 从文件名反推出这篇日记对应的日期 */
	dateFromFile(file: TFile | null): Moment | null {
		if (!file) return null;
		const format = this.getDateFormat();
		for (const folder of this.dailyFolders()) {
			const relative = this.relativeTo(file, folder);
			if (relative === null) continue;
			const parsed = moment(relative.replace(/\.md$/i, ""), format, true);
			if (parsed.isValid()) return parsed;
		}
		return null;
	}

	// ─────────────────────────── 模板读取与渲染 ───────────────────────────

	/** 读取模板正文：优先模板文件，读不到时退回内置文本 */
	async getTemplateText(): Promise<string> {
		if (this.settings.templateSource === "file") {
			const path = this.settings.templateFile.trim();
			if (path) {
				const target = this.app.vault.getAbstractFileByPath(normalizePath(path));
				if (target instanceof TFile) {
					try {
						return await this.app.vault.cachedRead(target);
					} catch (error) {
						console.error("[日记模板] 读取模板文件失败", error);
						new Notice("读取模板文件失败，这次使用内置模板。");
					}
				} else if (!this.warnedMissingTemplate) {
					this.warnedMissingTemplate = true;
					new Notice(`模板文件不存在：${path}，暂时使用内置模板。`);
				}
			}
		}
		return this.settings.templateContent;
	}

	async renderFor(day: Moment, notePath: string): Promise<RenderResult> {
		const template = await this.getTemplateText();
		const folder = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
		const title = notePath.slice(notePath.lastIndexOf("/") + 1).replace(/\.md$/i, "");

		const lists = await this.resolveLists(day);
		// 待办：完整镜像，复选框统一还原成未勾选
		const todoItems = this.settings.syncTodo
			? lists.todo
			: itemsFromLines(normalizeTaskLines(this.settings.recurringTasks));
		// 紧急任务：只带未完成的，已打勾的从模板里消失
		const missionItems = this.settings.syncMission ? lists.mission : [];

		const timeNotes = this.settings.enableTimeNotes;
		return renderTemplate(template, {
			date: day.toDate(),
			title,
			folder,
			todoText: renderItems(todoItems),
			missionText: renderItems(missionItems, { dropChecked: true }),
			todoHeading: this.settings.todoHeading || "To-do list",
			missionHeading: this.settings.missionHeading || "Urgent mission",
			monthLink: timeNotes ? `[[${this.linkTarget(this.getMonthNotePath(day))}]]` : "",
			yearLink: timeNotes ? `[[${this.linkTarget(this.getYearNotePath(day))}]]` : "",
			injectLists: this.settings.injectTasksWithoutPlaceholder,
			format: (date: Date, pattern: string) => moment(date).format(pattern),
		});
	}

	// ─────────────────────────── 列表同步 ───────────────────────────

	sectionNames(): SectionNames {
		return {
			todo: this.settings.todoHeading.trim() || "To-do list",
			mission: this.settings.missionHeading.trim() || "Urgent mission",
		};
	}

	/** 给设置页用：当前同步状态摘要 */
	syncSummary(): { source: string; date: string; counts: { todo: number; mission: number } } | null {
		const synced = this.settings.synced;
		if (!synced) return null;
		return {
			source: synced.sourcePath,
			date: synced.sourceDate,
			counts: countCarryOver(synced),
		};
	}

	/** 生成某天的日记时，列表从哪里来：优先读「这一天之前最近的一篇日记」 */
	private async resolveLists(day: Moment): Promise<{ todo: ListItem[]; mission: ListItem[] }> {
		const fromNote = await this.readListsBefore(day);
		if (fromNote) return fromNote;

		const synced: SyncedLists | null = this.settings.synced;
		if (synced) return { todo: synced.todo, mission: synced.mission };

		return {
			todo: itemsFromLines(normalizeTaskLines(this.settings.recurringTasks)),
			mission: [],
		};
	}

	private async readListsBefore(
		day: Moment
	): Promise<{ todo: ListItem[]; mission: ListItem[] } | null> {
		const names = this.sectionNames();
		const candidates: Array<{ file: TFile; date: Moment }> = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.isDailyNotePath(file)) continue;
			const date = this.dateFromFile(file);
			if (!date || !date.isBefore(day, "day")) continue;
			candidates.push({ file, date });
		}
		candidates.sort((a, b) => b.date.valueOf() - a.date.valueOf());

		for (const candidate of candidates.slice(0, 3)) {
			try {
				const parsed = parseLists(await this.app.vault.cachedRead(candidate.file), names);
				if (parsed.found.todo || parsed.found.mission) {
					return { todo: parsed.todo, mission: parsed.mission };
				}
			} catch (error) {
				console.error("[日记模板] 读取上一篇日记失败", candidate.file.path, error);
			}
		}
		return null;
	}

	/** 从今天的日记同步两个列表（启动、打开、手动命令时调用） */
	async syncFromToday(force = false): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(this.getNotePath(moment()));
		if (!(file instanceof TFile)) return false;
		return this.syncFromFile(file, force);
	}

	async syncFromFile(file: TFile, force = false): Promise<boolean> {
		const date = this.dateFromFile(file);
		if (!date) return false;

		const key = date.format("YYYY-MM-DD");
		const stored = this.settings.synced;
		// 只接受「不比已有状态更旧」的来源，避免旧笔记覆盖新状态
		if (!force && stored && key < stored.sourceDate) return false;

		try {
			const parsed = parseLists(await this.app.vault.cachedRead(file), this.sectionNames());
			// 这篇日记里没有目标区块（例如刚剪掉标题）时，不覆盖已有状态
			if (!force && !parsed.found.todo && !parsed.found.mission) return false;

			this.settings.synced = {
				todo: parsed.todo,
				mission: parsed.mission,
				sourcePath: file.path,
				sourceDate: key,
				updatedAt: Date.now(),
			};
			await this.saveSettings();
			return true;
		} catch (error) {
			console.error("[日记模板] 同步列表失败", error);
			return false;
		}
	}

	private handleModified(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		if (this.applying.has(file.path)) return;
		if (!this.isManagedDailyNote(file)) return;

		const date = this.dateFromFile(file);
		if (!date || !date.isSame(moment(), "day")) return; // 只跟「今天」的日记同步

		if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
		this.syncTimer = window.setTimeout(() => {
			this.syncTimer = null;
			void this.syncFromFile(file);
		}, 700);
	}

	private async syncListsNow(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.getNotePath(moment()));
		if (!(file instanceof TFile)) {
			new Notice(`还没有今天的日记（${this.getNotePath(moment())}）。`);
			return;
		}
		const ok = await this.syncFromToday(true);
		new Notice(
			ok ? "已从今天的日记同步待办与紧急任务。" : "同步失败，请查看开发者控制台。"
		);
	}

	// ─────────────────────────── 年 / 月节点 ───────────────────────────

	/** 链接目标：取文件名（不含 .md），Obsidian 会按最短路径解析 */
	private linkTarget(path: string): string {
		return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
	}

	private timeNoteFolder(): string {
		const raw = (this.settings.timeNoteFolder ?? "").trim().replace(/^\/+|\/+$/g, "");
		if (!raw) return this.getFolder();
		return normalizePath(raw).replace(/^\/+|\/+$/g, "");
	}

	getMonthNotePath(day: Moment): string {
		const folder = this.timeNoteFolder();
		const name = day.format(this.settings.monthNoteFormat.trim() || "YYYY-MM");
		return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
	}

	getYearNotePath(day: Moment): string {
		const folder = this.timeNoteFolder();
		const name = day.format(this.settings.yearNoteFormat.trim() || "YYYY");
		return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
	}

	async syncTimeNotesNow(): Promise<void> {
		if (!this.settings.enableTimeNotes) {
			new Notice("年/月节点功能已关闭。");
			return;
		}
		await this.ensureTimeNotes(moment());
		new Notice(
			`已更新年/月节点：${this.getYearNotePath(moment())}、${this.getMonthNotePath(moment())}`
		);
	}

	/** 给所有已有日记补上「所属月份」链接，并把年/月节点的清单整理成有序的 */
	async linkExistingNotes(): Promise<{ total: number; linked: number }> {
		if (!this.settings.enableTimeNotes) return { total: 0, linked: 0 };

		const entries: Array<{ file: TFile; date: Moment }> = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.isDailyNotePath(file)) continue;
			const date = this.dateFromFile(file);
			if (date) entries.push({ file, date });
		}
		entries.sort((a, b) => a.date.valueOf() - b.date.valueOf());

		// 1) 每篇日记补上「所属月份」
		let linked = 0;
		for (const entry of entries) {
			const monthLink = `[[${this.linkTarget(this.getMonthNotePath(entry.date))}]]`;
			if (await this.appendToNote(entry.file.path, `所属月份：${monthLink}`)) linked += 1;
		}

		// 2) 按月重建「## 日记」清单（升序、含所有文件夹里的日记）
		const byMonth = new Map<string, Array<{ file: TFile; date: Moment }>>();
		for (const entry of entries) {
			const key = entry.date.format("YYYY-MM");
			const list = byMonth.get(key);
			if (list) list.push(entry);
			else byMonth.set(key, [entry]);
		}

		const monthsByYear = new Map<string, string[]>();

		for (const [key, list] of byMonth) {
			list.sort((a, b) => a.date.valueOf() - b.date.valueOf());
			const first = list[0];
			if (!first) continue;
			await this.ensureTimeNotes(first.date);

			const monthPath = this.getMonthNotePath(first.date);
			const monthFile = this.app.vault.getAbstractFileByPath(monthPath);
			if (monthFile instanceof TFile) {
				const lines = list.map((entry) => `- [[${this.linkTarget(entry.file.path)}]]`);
				await this.app.vault.process(monthFile, (data) =>
					replaceSection(data, "日记", lines)
				);
			}

			const year = first.date.format("YYYY");
			const months = monthsByYear.get(year) ?? [];
			if (!months.includes(key)) months.push(key);
			monthsByYear.set(year, months);
		}

		// 3) 年节点的「## 月份」清单也重排一次
		for (const [year, months] of monthsByYear) {
			const yearPath = this.getYearNotePath(moment(`${year}-01-01`, "YYYY-MM-DD"));
			const yearFile = this.app.vault.getAbstractFileByPath(yearPath);
			if (!(yearFile instanceof TFile)) continue;
			months.sort();
			await this.app.vault.process(yearFile, (data) =>
				replaceSection(
					data,
					"月份",
					months.map((monthKey) => `- [[${monthKey}]]`)
				)
			);
		}

		return { total: entries.length, linked };
	}

	async linkExistingNow(): Promise<void> {
		if (!this.settings.enableTimeNotes) {
			new Notice("年/月节点功能已关闭。");
			return;
		}
		new Notice("正在为已有日记补月份链接…");
		const { total, linked } = await this.linkExistingNotes();
		new Notice(`已检查 ${total} 篇日记，补上 ${linked} 个「所属月份」链接。`);
	}

	/** 确保这一天所属的年节点、月节点存在，并接好链接 */
	async ensureTimeNotes(day: Moment): Promise<void> {
		if (!this.settings.enableTimeNotes) return;

		try {
			const yearPath = this.getYearNotePath(day);
			const monthPath = this.getMonthNotePath(day);
			const yearLink = `[[${this.linkTarget(yearPath)}]]`;
			const monthLink = `[[${this.linkTarget(monthPath)}]]`;

			await this.ensureNoteExists(yearPath, () => this.buildYearNote(day));
			await this.ensureNoteExists(monthPath, () => this.buildMonthNote(day, yearLink));

			// 月节点 → 年节点
			await this.appendToNote(monthPath, `所属年份：${yearLink}`);
			// 年节点 → 月节点
			await this.appendToSectionOf(yearPath, "月份", `- ${monthLink}`);
			// 月节点 → 当月每一篇日记
			for (const file of this.daysInMonth(day)) {
				await this.appendToSectionOf(monthPath, "日记", `- [[${this.linkTarget(file.path)}]]`);
			}
		} catch (error) {
			console.error("[日记模板] 生成年/月节点失败", error);
		}
	}

	private buildYearNote(day: Moment): string {
		return `# ${day.format("YYYY年")}\n\n## 月份\n`;
	}

	private buildMonthNote(day: Moment, yearLink: string): string {
		return `# ${day.format("YYYY年M月")}\n\n所属年份：${yearLink}\n\n## 日记\n`;
	}

	private async ensureNoteExists(path: string, build: () => string): Promise<TFile | null> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		if (existing) return null;

		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		try {
			if (dir) await this.ensureFolder(dir);
			return await this.app.vault.create(path, build());
		} catch (error) {
			console.error("[日记模板] 创建节点失败", path, error);
			return null;
		}
	}

	/** 在文件末尾补一行（已存在则跳过），返回是否改动 */
	private async appendToNote(path: string, line: string): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return false;

		let changed = false;
		await this.app.vault.process(file, (data) => {
			if (data.includes(line)) return data;
			changed = true;
			const base = data.replace(/\s*$/, "");
			return base ? `${base}\n\n${line}\n` : `${line}\n`;
		});
		return changed;
	}

	/** 在某个标题区块末尾补一行（已存在则跳过） */
	private async appendToSectionOf(path: string, heading: string, line: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		await this.app.vault.process(file, (data) => appendToSection(data, heading, line));
	}

	/** 当月已有的日记，按日期升序 */
	private daysInMonth(day: Moment): TFile[] {
		const target = day.format("YYYY-MM");
		const found: Array<{ file: TFile; date: Moment }> = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.isDailyNotePath(file)) continue;
			const date = this.dateFromFile(file);
			if (!date || date.format("YYYY-MM") !== target) continue;
			found.push({ file, date });
		}
		found.sort((a, b) => a.date.valueOf() - b.date.valueOf());
		return found.map((entry) => entry.file);
	}

	// ─────────────────────────── 自动补建 ───────────────────────────

	/** 当前已知的日期，用来发现跨天/休眠唤醒 */
	private lastKnownDate = moment().format("YYYY-MM-DD");

	private async startupTasks(): Promise<void> {
		await this.syncFromToday();
		const result = await this.ensureDailyNotes();

		const mode = this.settings.autoOpenMode;
		if (mode === "off") return;
		if (mode === "created" && !result.todayCreated) return;

		const key = moment().format("YYYY-MM-DD");
		if (mode === "daily" && this.settings.lastOpenDate === key) return;

		await this.openDailyNote();
		await this.markAutoOpened(key);
	}

	/**
	 * 自动补建：把「上一篇日记」到今天之间缺的日子补上（含今天）。
	 * 只向前补，不翻旧账——历史空档需要手动「补齐」，删掉的旧日记也不会被重建。
	 * 往回最多补 backfillMaxDays 天。
	 */
	async ensureDailyNotes(): Promise<{ total: number; todayCreated: boolean }> {
		const result = { total: 0, todayCreated: false };
		if (!this.settings.autoCreateDailyNote) return result;

		const today = moment().startOf("day");
		const existing = this.collectDailyDates(today);

		if (existing.length === 0) {
			// 还没有任何日记：只建今天，不往回追溯
			await this.createIfMissing(today.clone(), result);
		} else {
			const last = existing[existing.length - 1] as Moment;
			const floor = today.clone().subtract(this.backfillLimit() - 1, "days");
			let cursor = last.clone().add(1, "day");
			if (cursor.isBefore(floor, "day")) cursor = floor.clone();
			while (cursor.isSameOrBefore(today, "day")) {
				await this.createIfMissing(cursor.clone(), result);
				cursor.add(1, "day");
			}
		}

		await this.finishBackfill(today, result);
		return result;
	}

	/** 手动补齐：把最近 N 天内所有空档（包括更早的历史缺口）一次补上 */
	async fillGapsInWindow(): Promise<number> {
		const result = { total: 0, todayCreated: false };
		const today = moment().startOf("day");
		const existing = this.collectDailyDates(today);
		if (existing.length === 0) return 0;

		const floor = today.clone().subtract(this.backfillLimit() - 1, "days");
		const earliest = existing[0] as Moment;
		const start = earliest.isAfter(floor, "day") ? earliest.clone() : floor.clone();

		for (const day = start.clone(); day.isSameOrBefore(today, "day"); day.add(1, "day")) {
			await this.createIfMissing(day.clone(), result);
		}
		await this.finishBackfill(today, result);
		return result.total;
	}

	private backfillLimit(): number {
		return Math.max(1, Math.min(366, Math.floor(this.settings.backfillMaxDays) || 1));
	}

	private async createIfMissing(
		day: Moment,
		result: { total: number; todayCreated: boolean }
	): Promise<boolean> {
		const key = day.format("YYYY-MM-DD");
		const todayKey = moment().format("YYYY-MM-DD");

		// 今天被主动删掉后，当天不再反复重建
		if (key === todayKey && this.settings.lastAutoCreateDate === key) return false;

		const path = this.getNotePath(day);
		if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) return false;

		try {
			await this.createDailyNote(day.clone(), path);
			result.total += 1;
			if (key === todayKey) result.todayCreated = true;
			return true;
		} catch (error) {
			console.error("[日记模板] 自动补建日记失败", path, error);
			return false;
		}
	}

	private async finishBackfill(today: Moment, result: { total: number }): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(this.getNotePath(today)) instanceof TFile) {
			await this.markAutoCreated(today.format("YYYY-MM-DD"));
		}
		if (result.total > 0) {
			new Notice(`已按模板补建 ${result.total} 篇日记。`);
		}
	}

	private async fillGapsNow(): Promise<void> {
		const count = await this.fillGapsInWindow();
		if (count === 0) new Notice("最近的日子没有缺口。");
	}

	/** 仓库里已有的日记日期（只算今天及以前），升序 */
	private collectDailyDates(today: Moment): Moment[] {
		const dates: Moment[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.isDailyNotePath(file)) continue;
			const date = this.dateFromFile(file);
			if (!date || date.isAfter(today, "day")) continue;
			dates.push(date);
		}
		dates.sort((a, b) => a.valueOf() - b.valueOf());
		return dates;
	}

	private async markAutoCreated(key: string): Promise<void> {
		if (this.settings.lastAutoCreateDate === key) return;
		this.settings.lastAutoCreateDate = key;
		await this.saveSettings();
	}

	private async markAutoOpened(key: string): Promise<void> {
		if (this.settings.lastOpenDate === key) return;
		this.settings.lastOpenDate = key;
		await this.saveSettings();
	}

	// ─────────────────────────── 打开 / 创建日记 ───────────────────────────

	async openDailyNote(day?: Moment): Promise<void> {
		const target = (day ?? moment()).clone();
		const path = this.getNotePath(target);
		const existing = this.app.vault.getAbstractFileByPath(path);

		let file: TFile;
		let cursor: number | null = null;

		if (existing instanceof TFile) {
			file = existing;
		} else if (existing) {
			new Notice(`无法创建日记：${path} 已被同名文件夹占用。`);
			return;
		} else {
			try {
				const created = await this.createDailyNote(target, path);
				file = created.file;
				cursor = created.cursor;
			} catch (error) {
				console.error("[日记模板] 创建日记失败", error);
				new Notice(`创建日记失败：${path}`);
				return;
			}
		}

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		if (cursor !== null) {
			this.placeCursor(file, cursor);
		} else if (this.settings.autoApplyOnOpenEmpty) {
			await this.applyTemplateIfEmpty(file, target);
		}
	}

	private async createDailyNote(
		day: Moment,
		path: string
	): Promise<{ file: TFile; cursor: number | null }> {
		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (dir) await this.ensureFolder(dir);

		const rendered = await this.renderFor(day, path);
		this.pendingCreates.add(path);
		try {
			const file = await this.app.vault.create(path, rendered.content);
			await this.ensureTimeNotes(day);
			return { file, cursor: rendered.cursorOffset };
		} finally {
			// 留一点时间给 create 事件，避免事件处理器抢在前面重复写入
			window.setTimeout(() => this.pendingCreates.delete(path), 1000);
		}
	}

	async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path).replace(/^\/+|\/+$/g, "");
		if (!normalized) return;
		let current = "";
		for (const segment of normalized.split("/")) {
			current = current ? `${current}/${segment}` : segment;
			const node = this.app.vault.getAbstractFileByPath(current);
			if (node instanceof TFolder) continue;
			if (node) throw new Error(`路径已被文件占用：${current}`);
			await this.app.vault.createFolder(current);
		}
	}

	/** 文件内容为空时套用模板，返回是否写入成功 */
	async applyTemplateIfEmpty(file: TFile, day?: Moment): Promise<boolean> {
		if (this.applying.has(file.path)) return false;

		let current = "";
		try {
			current = await this.app.vault.cachedRead(file);
		} catch {
			return false;
		}
		if (current.trim() !== "") return false;

		const target = day ?? this.dateFromFile(file) ?? moment();
		this.applying.add(file.path);
		try {
			const rendered = await this.renderFor(target, file.path);
			await this.app.vault.modify(file, rendered.content);
			await this.ensureTimeNotes(target);
			this.placeCursor(file, rendered.cursorOffset);
			return true;
		} catch (error) {
			console.error("[日记模板] 套用模板失败", error);
			new Notice("套用日记模板失败，请查看开发者控制台。");
			return false;
		} finally {
			this.applying.delete(file.path);
		}
	}

	private async handleCreated(file: TAbstractFile): Promise<void> {
		if (!this.settings.autoApplyOnCreate) return;
		if (!(file instanceof TFile)) return;
		if (this.pendingCreates.has(file.path)) return;
		// 只在主日记文件夹里新建时才套模板，归档文件夹里的空笔记不动
		if (!this.isManagedDailyNote(file)) return;

		try {
			// 等 Obsidian 把新建文件的内容写完，避免误判为空
			await sleep(50);
			if (this.pendingCreates.has(file.path)) return;
			await this.applyTemplateIfEmpty(file);
		} catch (error) {
			console.error("[日记模板] 新建日记自动套用失败", error);
		}
	}

	private async handleOpened(file: TFile | null): Promise<void> {
		if (!file || !(file instanceof TFile)) return;
		if (!this.isManagedDailyNote(file)) return;

		// 打开「今天」的日记时先对齐一次列表
		const date = this.dateFromFile(file);
		if (date && date.isSame(moment(), "day") && !this.applying.has(file.path)) {
			void this.syncFromFile(file);
			void this.markAutoOpened(date.format("YYYY-MM-DD"));
		}

		if (!this.settings.autoApplyOnOpenEmpty) return;
		if (this.applying.has(file.path) || this.pendingCreates.has(file.path)) return;

		try {
			await this.applyTemplateIfEmpty(file);
		} catch (error) {
			console.error("[日记模板] 打开日记自动套用失败", error);
		}
	}

	/** 把光标放到 {{cursor}} 的位置（编辑器可能还没就绪，所以重试几次） */
	private placeCursor(file: TFile, offset: number | null, attempt = 0): void {
		if (offset === null) return;
		window.setTimeout(
			() => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || view.file?.path !== file.path) {
					if (attempt < 4) this.placeCursor(file, offset, attempt + 1);
					return;
				}
				const value = view.editor.getValue();
				if (!value) {
					if (attempt < 4) this.placeCursor(file, offset, attempt + 1);
					return;
				}
				const end = Math.min(offset, value.length);
				const before = value.slice(0, end);
				const line = before.split("\n").length - 1;
				const ch = end - (before.lastIndexOf("\n") + 1);
				view.editor.setCursor({ line, ch });
				view.editor.focus();
			},
			attempt === 0 ? 30 : 80
		);
	}

	// ─────────────────────────── 命令实现 ───────────────────────────

	private pickDate(): void {
		const day = this.dateFromFile(this.app.workspace.getActiveFile()) ?? moment();
		new DatePickerModal(
			this.app,
			"打开指定日期的日记",
			day.format("YYYY-MM-DD"),
			(value) => {
				if (!value) return;
				const parsed = moment(value, "YYYY-MM-DD", true);
				if (!parsed.isValid()) {
					new Notice("日期格式不正确。");
					return;
				}
				void this.openDailyNote(parsed);
			}
		).open();
	}

	private async insertTemplate(editor: Editor, info: MarkdownFileInfo): Promise<void> {
		const file = info.file ?? this.app.workspace.getActiveFile();
		const day = this.dateFromFile(file) ?? moment();
		const rendered = await this.renderFor(day, file?.path ?? "未命名.md");
		const base = editor.posToOffset(editor.getCursor());
		editor.replaceSelection(rendered.content);
		if (rendered.cursorOffset !== null) {
			const offset = Math.min(base + rendered.cursorOffset, base + rendered.content.length);
			editor.setCursor(editor.offsetToPos(offset));
		}
		editor.focus();
	}

	private async rebuildCurrent(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension.toLowerCase() !== "md") {
			new Notice("请先打开一篇 Markdown 笔记。");
			return;
		}
		const confirmed = await new Promise<boolean>((resolve) => {
			new ConfirmModal(
				this.app,
				"用模板重建这篇笔记？",
				`「${file.basename}」的全部正文会被模板内容覆盖，且无法撤销。`,
				"覆盖",
				resolve
			).open();
		});
		if (!confirmed) return;

		const day = this.dateFromFile(file) ?? moment();
		const rendered = await this.renderFor(day, file.path);
		await this.app.vault.modify(file, rendered.content);
		this.placeCursor(file, rendered.cursorOffset);
		new Notice("已用模板重建这篇笔记。");
	}

	private async previewTemplate(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		const day = this.dateFromFile(file) ?? moment();
		const rendered = await this.renderFor(day, file?.path ?? this.getNotePath(day));
		new PreviewModal(this.app, "模板预览", rendered.content).open();
	}

	// ─────────────────────────── 模板文件 ───────────────────────────

	/** 模板文件不存在时按内置模板创建，然后返回该文件 */
	async ensureTemplateFile(): Promise<TFile | null> {
		const raw = this.settings.templateFile.trim() || "模板/日记模板.md";
		const path = normalizePath(raw.endsWith(".md") ? raw : `${raw}.md`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		if (existing) {
			new Notice(`模板路径已被文件夹占用：${path}`);
			return null;
		}
		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		try {
			if (dir) await this.ensureFolder(dir);
			const body = this.settings.templateContent || "";
			return await this.app.vault.create(path, body);
		} catch (error) {
			console.error("[日记模板] 创建模板文件失败", error);
			new Notice(`创建模板文件失败：${path}`);
			return null;
		}
	}

	async editTemplate(): Promise<void> {
		if (this.settings.templateSource !== "file") {
			this.openSettingsTab();
			new Notice("当前使用「内置文本」模板，已打开设置页。");
			return;
		}
		const file = await this.ensureTemplateFile();
		if (file) {
			await this.app.workspace.getLeaf(false).openFile(file);
		}
	}

	openSettingsTab(): void {
		const appSetting = (
			this.app as unknown as {
				setting?: { open: () => void; openTabById: (id: string) => void };
			}
		).setting;
		if (appSetting) {
			appSetting.open();
			appSetting.openTabById(this.manifest.id);
		}
	}
}
