import { moment as obsidianMoment } from "obsidian";
import type { Moment, MomentFormatSpecification, MomentInput } from "moment";

export type { Moment };

/**
 * Obsidian 自带的 moment 实例。它的类型声明是 `typeof import('moment')` 命名空间，
 * 在 esModuleInterop 下不能直接当函数调用，这里收窄成可调用签名。
 */
export interface MomentFactory {
	(input?: MomentInput, format?: MomentFormatSpecification, strict?: boolean): Moment;
	(
		input?: MomentInput,
		format?: MomentFormatSpecification,
		language?: string,
		strict?: boolean
	): Moment;
}

export const moment = obsidianMoment as unknown as MomentFactory;
