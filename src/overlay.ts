/**
 * The `/transcribe` overlay: transcript on top, a divider, a status row.
 *
 * One component renders the whole thing. The transcript is the only part that
 * grows, so there is no layout to negotiate between children — the status row
 * is always the last line, and the caller sees a stable block above the prompt.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type KeybindingsManager, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** How the overlay ended. `commit` pastes, `cancel` throws the audio away. */
export type OverlayIntent = "commit" | "cancel";

export interface OverlayCallbacks {
	onIntent(intent: OverlayIntent): void;
	onTogglePause(): void;
}

const KEYBIND_CONFIRM = "tui.select.confirm";
const KEYBIND_CANCEL = "tui.select.cancel";
const SPACE = " ";

/** Level-meter geometry. Eight cells is enough to read speech vs. silence at a
 *  glance and still fits beside the timer on an 80-column terminal. */
const METER_CELLS = 8;
const METER_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
/** Speech peaks around -20 dBFS; scaling by 3 puts normal talking near the top
 *  of the meter instead of leaving it flat at one block. */
const METER_GAIN = 3;

/** Fraction of the terminal the transcript may fill before it starts scrolling
 *  its own tail. Leaves room for the prompt and recent chat underneath. */
const MAX_HEIGHT_RATIO = 0.6;
const FALLBACK_TERMINAL_ROWS = 24;

export interface OverlayState {
	transcript: string;
	level: number;
	pending: number;
	paused: boolean;
	error: string | undefined;
	elapsedMs: number;
}

function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function meter(level: number, paused: boolean): string {
	if (paused) return METER_BLOCKS[0].repeat(METER_CELLS);
	const scaled = Math.min(1, level * METER_GAIN);
	const lit = Math.round(scaled * METER_CELLS);
	let bar = "";
	for (let cell = 0; cell < METER_CELLS; cell++) {
		// Each lit cell is taller than the last, so the bar reads as a ramp
		// rather than a row of identical blocks.
		bar += cell < lit ? METER_BLOCKS[Math.min(METER_BLOCKS.length - 1, cell)] : METER_BLOCKS[0];
	}
	return bar;
}

export class DictationOverlay implements Component {
	private state: OverlayState = {
		transcript: "",
		level: 0,
		pending: 0,
		paused: false,
		error: undefined,
		elapsedMs: 0,
	};

	constructor(
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly terminal: { rows?: number },
		private readonly callbacks: OverlayCallbacks,
	) {}

	setState(state: OverlayState): void {
		this.state = state;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		// Confirm and cancel go through the user's own bindings rather than a
		// hardcoded Enter/Esc, so a remapped keyboard still commits.
		if (this.keybindings.matches(data, KEYBIND_CANCEL)) {
			this.callbacks.onIntent("cancel");
			return;
		}
		if (this.keybindings.matches(data, KEYBIND_CONFIRM)) {
			this.callbacks.onIntent("commit");
			return;
		}
		if (data === SPACE) this.callbacks.onTogglePause();
	}

	render(width: number): string[] {
		const lines = [...this.transcriptLines(width), this.divider(width), this.statusLine()];
		return lines;
	}

	private transcriptLines(width: number): string[] {
		const { transcript } = this.state;
		if (transcript === "") {
			const placeholder = this.state.paused ? "Paused." : "Listening — start talking.";
			return [this.theme.fg("muted", placeholder)];
		}
		const wrapped: string[] = [];
		for (const paragraph of transcript.split("\n")) {
			wrapped.push(...wrapTextWithAnsi(paragraph === "" ? " " : paragraph, width));
		}
		// Keep the tail visible when a long dictation outgrows its budget: the
		// words you just said matter more than the ones you already reviewed.
		const rows = this.terminal.rows ?? FALLBACK_TERMINAL_ROWS;
		const budget = Math.max(1, Math.floor(rows * MAX_HEIGHT_RATIO) - 2);
		return wrapped.length > budget ? wrapped.slice(wrapped.length - budget) : wrapped;
	}

	private divider(width: number): string {
		return this.theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
	}

	private statusLine(): string {
		const { paused, pending, error, elapsedMs, level } = this.state;

		const dot = paused ? this.theme.fg("warning", "⏸") : this.theme.fg("error", "●");
		const clock = this.theme.fg("muted", formatElapsed(elapsedMs));
		const bar = this.theme.fg(paused ? "dim" : "accent", meter(level, paused));

		const parts = [`${dot} ${clock}`, bar];
		if (pending > 0) {
			parts.push(this.theme.fg("muted", pending === 1 ? "transcribing…" : `transcribing ${pending}…`));
		}
		if (error) parts.push(this.theme.fg("error", error));

		const hints = this.theme.fg(
			"dim",
			`⏎ paste · esc discard · space ${paused ? "resume" : "pause"}`,
		);
		return `${parts.join("  ")}   ${hints}`;
	}
}
