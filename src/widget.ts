/**
 * The listening indicator above the editor while dictation runs.
 *
 *   ▁▂▃▅▇█▇▅▃▂▁▂▄▆█▆▄▂▁▁▂▃▅▇█▇▅▃▂▁          ← waveform, newest at the right,
 *   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀          ← mirrored below the centre line
 *   ● 0:14  ⠹ transcribing 2…  3 phrases   ctrl+q to stop
 *
 * The lower half hangs from the top of each cell. There is no "lower eighth"
 * glyph set in a font you can rely on, so a bar of k eighths hanging down is
 * drawn as the (8-k) block in reverse video: the glyph's empty top takes the
 * foreground colour and its filled bottom takes the background — exactly the
 * complementary shape, in standard glyphs.
 *
 * Levels are mapped on a decibel scale, not a linear one. Speech sits between
 * roughly -30 and -20 dBFS — 0.03 to 0.1 as normalized RMS — and a linear
 * meter squeezes all of that into the bottom tenth of its range, which is
 * why the previous version looked dead while the user was talking. Sixty dB
 * of range spread over the bar height puts room tone at the floor and
 * conversational speech in the upper half, where movement is visible.
 *
 * The widget drives its own repaints: the TUI only re-renders on input, and
 * nothing about a level meter is input. A ticker requests a render for as
 * long as the widget is mounted and stops in `dispose()`.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

/** Rows above and below the centre line. Total height is 2·HALF + 1 status
 *  row; Pi caps widgets at 10 lines. */
const HALF_ROWS = 2;
/** Eighth-block glyphs, filled from the bottom. Standard Block Elements —
 *  every monospace font has them. */
const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
/** Repaint cadence. Also the sample cadence: one column per tick. */
const TICK_MS = 80;
/** dBFS mapped to the bottom and top of the bar. */
const FLOOR_DB = -60;
const CEIL_DB = -8;
/** Envelope follower: rises almost instantly, falls over a few frames, so a
 *  syllable registers as a spike rather than a flicker. */
const ATTACK = 0.85;
const RELEASE = 0.35;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export interface WidgetState {
	level: number;
	pending: number;
	/** Phrases already inserted into the prompt this session. */
	inserted: number;
	error: string | undefined;
	startedAt: number;
}

function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Normalized RMS → [0, 1] on a dB scale between FLOOR_DB and CEIL_DB. */
function toUnit(rms: number): number {
	if (rms <= 0) return 0;
	const db = 20 * Math.log10(rms);
	return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
}

/** Colour by height: quiet columns recede, loud ones come forward. */
function colourFor(unit: number): ThemeColor {
	if (unit < 0.25) return "dim";
	if (unit < 0.55) return "muted";
	if (unit < 0.8) return "accent";
	return "success";
}

export class DictationWidget implements Component {
	private ticker: ReturnType<typeof setInterval> | undefined;
	/** Smoothed level history, oldest first. Sized to the render width. */
	private history: number[] = [];
	private envelope = 0;
	private frame = 0;

	constructor(
		private readonly tui: Pick<TUI, "requestRender">,
		private readonly theme: Theme,
		private readonly state: WidgetState,
		private readonly hotkeyLabel: string | undefined,
	) {
		this.ticker = setInterval(() => this.tick(), TICK_MS);
	}

	dispose(): void {
		if (this.ticker) clearInterval(this.ticker);
		this.ticker = undefined;
	}

	invalidate(): void {}

	private tick(): void {
		const target = toUnit(this.state.level);
		const rate = target > this.envelope ? ATTACK : RELEASE;
		this.envelope += (target - this.envelope) * rate;
		this.history.push(this.envelope);
		this.frame += 1;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const columns = Math.max(8, width - 2);
		if (this.history.length > columns) this.history.splice(0, this.history.length - columns);
		// Left-pad so the wave enters from the right and scrolls left.
		const values = [...new Array<number>(Math.max(0, columns - this.history.length)).fill(0), ...this.history];

		const rows: string[] = [];
		for (let row = HALF_ROWS - 1; row >= 0; row--) rows.push(this.band(values, row, false));
		for (let row = 0; row < HALF_ROWS; row++) rows.push(this.band(values, row, true));
		rows.push(this.status());
		return rows;
	}

	/** One row of the wave. `row` 0 is nearest the centre line. Each column's
	 *  height in eighths is spread across HALF_ROWS rows; a row draws a full
	 *  block below the height, a partial block at it, a space above. */
	private band(values: readonly number[], row: number, mirrored: boolean): string {
		let line = " ";
		let colour: ThemeColor | undefined;
		let partial = false;
		let run = "";
		const flush = (): void => {
			if (run === "") return;
			const painted = colour ? this.theme.fg(colour, run) : run;
			// Reverse video only on partial glyphs. Full and empty cells look
			// the same either way up, and an inverted run of spaces would paint
			// a solid stripe in the foreground colour.
			line += mirrored && partial ? this.theme.inverse(painted) : painted;
			run = "";
		};
		for (const unit of values) {
			const eighths = Math.round(unit * HALF_ROWS * 8);
			const inRow = Math.max(0, Math.min(8, eighths - row * 8));
			// Hanging bars: k eighths from the top is the (8-k) block, inverted.
			const glyph = mirrored && inRow > 0 && inRow < 8 ? (BLOCKS[8 - inRow] ?? " ") : (BLOCKS[inRow] ?? " ");
			const isPartial = inRow > 0 && inRow < 8;
			const next = colourFor(unit);
			if (next !== colour || isPartial !== partial) {
				flush();
				colour = next;
				partial = isPartial;
			}
			run += glyph;
		}
		flush();
		return line;
	}

	private status(): string {
		const { pending, inserted, error, startedAt } = this.state;
		// The dot breathes: solid on even beats, hollow on odd, so a quiet
		// room still reads as "listening" rather than "hung".
		const beat = Math.floor((this.frame * TICK_MS) / 500) % 2 === 0;
		const parts = [
			`${this.theme.fg("error", beat ? "●" : "○")} ${this.theme.fg("text", formatElapsed(Date.now() - startedAt))}`,
		];
		if (pending > 0) {
			const spin = SPINNER[this.frame % SPINNER.length] ?? SPINNER[0];
			parts.push(this.theme.fg("accent", `${spin} transcribing${pending > 1 ? ` ${pending}` : ""}…`));
		}
		if (inserted > 0) parts.push(this.theme.fg("muted", `${inserted} phrase${inserted === 1 ? "" : "s"}`));
		if (error) parts.push(this.theme.fg("error", error));
		const stop = this.hotkeyLabel ? `${this.hotkeyLabel} to stop` : "/transcribe to stop";
		return ` ${parts.join("  ")}   ${this.theme.fg("dim", stop)}`;
	}
}
