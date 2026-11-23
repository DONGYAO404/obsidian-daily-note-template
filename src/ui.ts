import { Modal, type App } from "obsidian";

/** 选择日期的小弹窗 */
export class DatePickerModal extends Modal {
	private readonly heading: string;
	private readonly initial: string;
	private readonly onSubmit: (value: string | null) => void;
	private inputEl!: HTMLInputElement;
	private submitted = false;

	constructor(app: App, heading: string, initial: string, onSubmit: (value: string | null) => void) {
		super(app);
		this.heading = heading;
		this.initial = initial;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.heading);
		contentEl.addClass("dnt-modal");

		const row = contentEl.createDiv({ cls: "dnt-date-row" });
		this.inputEl = row.createEl("input", { attr: { type: "date" }, cls: "dnt-date-input" });
		this.inputEl.value = this.initial;

		const quick = contentEl.createDiv({ cls: "dnt-quick-dates" });
		const quickButtons: Array<[string, number]> = [
			["昨天", -1],
			["今天", 0],
			["明天", 1],
		];
		for (const [label, offset] of quickButtons) {
			quick
				.createEl("button", { text: label, cls: "dnt-quick-button" })
				.addEventListener("click", () => {
					const d = new Date();
					d.setDate(d.getDate() + offset);
					this.inputEl.value = formatDateInput(d);
				});
		}

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		buttons
			.createEl("button", { text: "打开", cls: "mod-cta" })
			.addEventListener("click", () => this.submit());
		buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());

		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.submit();
			}
		});
		window.setTimeout(() => this.inputEl.focus(), 0);
	}

	private submit(): void {
		const value = this.inputEl.value.trim();
		if (!value) {
			this.close();
			return;
		}
		this.submitted = true;
		this.close();
		this.onSubmit(value);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.submitted) this.onSubmit(null);
	}
}

function formatDateInput(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 通用确认弹窗（Obsidian 没有内置的 confirm） */
export class ConfirmModal extends Modal {
	private readonly heading: string;
	private readonly message: string;
	private readonly confirmText: string;
	private readonly onResult: (confirmed: boolean) => void;
	private answered = false;

	constructor(
		app: App,
		heading: string,
		message: string,
		confirmText: string,
		onResult: (confirmed: boolean) => void
	) {
		super(app);
		this.heading = heading;
		this.message = message;
		this.confirmText = confirmText;
		this.onResult = onResult;
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.addClass("dnt-modal");
		this.contentEl.createEl("p", { text: this.message });

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const confirmButton = buttons.createEl("button", {
			text: this.confirmText,
			cls: "mod-warning",
		});
		confirmButton.addEventListener("click", () => {
			this.answered = true;
			this.close();
			this.onResult(true);
		});
		buttons.createEl("button", { text: "取消" }).addEventListener("click", () => {
			this.answered = true;
			this.close();
			this.onResult(false);
		});
		window.setTimeout(() => confirmButton.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.onResult(false);
	}
}

/** 预览渲染结果 */
export class PreviewModal extends Modal {
	private readonly heading: string;
	private readonly text: string;

	constructor(app: App, heading: string, text: string) {
		super(app);
		this.heading = heading;
		this.text = text;
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.addClass("dnt-modal");
		this.contentEl.createEl("p", {
			cls: "dnt-hint",
			text: "下面是按当前设置渲染出的日记内容（变量已替换）。确认无误后关闭即可。",
		});
		const pre = this.contentEl.createEl("pre", { cls: "dnt-preview" });
		pre.setText(this.text);

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "复制" }).addEventListener("click", () => {
			void navigator.clipboard.writeText(this.text);
		});
		buttons.createEl("button", { text: "关闭", cls: "mod-cta" }).addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
