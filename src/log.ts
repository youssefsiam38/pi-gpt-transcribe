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
