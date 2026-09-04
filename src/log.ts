/**
 * Error breadcrumbs for pi-gpt-transcribe.
 *
 * The overlay owns the terminal while dictation is live, so anything written
 * to stderr lands in the middle of the transcript and corrupts the render.
 * Failures go to a log file instead, and the overlay shows a one-line summary
 * pointing here.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";

export const LOG_PATH = join(CONFIG_DIR, "errors.log");
export const DEBUG_LOG_PATH = join(CONFIG_DIR, "debug.log");

let debugEnabled = false;

/** Enabled by `"debug": true` in config.json. Off, `debugLog` is a no-op. */
export function setDebugEnabled(enabled: boolean): void {
	debugEnabled = enabled;
}

/**
 * A timestamped trace of what the pipeline decided and when — VAD transitions,
 * every flush with the reason it fired and whether it was sent or dropped, and
 * each request's duration. This is the record that answers "why did Enter make
 * me wait", which is otherwise invisible: the overlay owns the terminal and
 * cannot print it.
 */
export function debugLog(scope: string, message: string): void {
	if (!debugEnabled) return;
	try {
		mkdirSync(CONFIG_DIR, { recursive: true });
		appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} [${scope}] ${message}\n`);
	} catch {
		// Same best-effort contract as the error log.
	}
}

export function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function appendErrorLog(scope: string, error: unknown): void {
	try {
		mkdirSync(CONFIG_DIR, { recursive: true });
		const stack = error instanceof Error && error.stack ? `\n${error.stack}` : "";
		appendFileSync(LOG_PATH, `${new Date().toISOString()} [${scope}] ${describeError(error)}${stack}\n`);
	} catch {
		// Logging is best-effort. A read-only home directory must not turn a
		// recoverable transcription error into a crashed overlay.
	}
}
