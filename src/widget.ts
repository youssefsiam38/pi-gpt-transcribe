/**
 * The listening indicator: one line above the editor while dictation runs.
 *
 *     ● 0:14 ▂▅▇▃  transcribing…  Ctrl-Q stop
 *
 * It drives its own repaints. Nothing else in the TUI re-renders on a timer,
 * and the level meter and clock change without any keystroke, so the widget
 * ticks `requestRender` itself for as long as it is mounted and stops in
 * `dispose()` when Pi unmounts it.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

const METER_CELLS = 8;
const METER_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
/** Speech peaks around -20 dBFS; scaling by 3 puts normal talking near the top
 *  of the meter instead of leaving it flat at one block. */
const METER_GAIN = 3;
/** Repaint cadence: smooth for the meter, cheap for the render loop. */
const TICK_MS = 100;

export interface WidgetState {
	level: number;
	pending: number;
	error: string | undefined;
	startedAt: number;
}

function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function meter(level: number): string {
	const lit = Math.round(Math.min(1, level * METER_GAIN) * METER_CELLS);
	let bar = "";
	for (let cell = 0; cell < METER_CELLS; cell++) {
		// Each lit cell is taller than the last, so the bar reads as a ramp
		// rather than a row of identical blocks.
		bar += cell < lit ? METER_BLOCKS[Math.min(METER_BLOCKS.length - 1, cell)] : METER_BLOCKS[0];
	}
	return bar;
}

export class DictationWidget implements Component {
	private ticker: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly tui: Pick<TUI, "requestRender">,
		private readonly theme: Theme,
		private readonly state: WidgetState,
		private readonly hotkeyLabel: string | undefined,
	) {
		this.ticker = setInterval(() => this.tui.requestRender(), TICK_MS);
	}

	dispose(): void {
		if (this.ticker) clearInterval(this.ticker);
		this.ticker = undefined;
	}

	invalidate(): void {}

	render(_width: number): string[] {
		const { level, pending, error, startedAt } = this.state;
		const parts = [
			`${this.theme.fg("error", "●")} ${this.theme.fg("muted", formatElapsed(Date.now() - startedAt))}`,
			this.theme.fg("accent", meter(level)),
		];
		if (pending > 0) {
			parts.push(this.theme.fg("muted", pending === 1 ? "transcribing…" : `transcribing ${pending}…`));
		}
		if (error) parts.push(this.theme.fg("error", error));
		const stop = this.hotkeyLabel ? `${this.hotkeyLabel} or /transcribe to stop` : "/transcribe to stop";
		return [`${parts.join("  ")}   ${this.theme.fg("dim", stop)}`];
	}
}
