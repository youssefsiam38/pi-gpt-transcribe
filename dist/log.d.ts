/**
 * Error breadcrumbs for pi-gpt-transcribe.
 *
 * The overlay owns the terminal while dictation is live, so anything written
 * to stderr lands in the middle of the transcript and corrupts the render.
 * Failures go to a log file instead, and the overlay shows a one-line summary
 * pointing here.
 */
export declare const LOG_PATH: string;
export declare const DEBUG_LOG_PATH: string;
/** Enabled by `"debug": true` in config.json. Off, `debugLog` is a no-op. */
export declare function setDebugEnabled(enabled: boolean): void;
/**
 * A timestamped trace of what the pipeline decided and when — VAD transitions,
 * every flush with the reason it fired and whether it was sent or dropped, and
 * each request's duration. This is the record that answers "why did Enter make
 * me wait", which is otherwise invisible: the overlay owns the terminal and
 * cannot print it.
 */
export declare function debugLog(scope: string, message: string): void;
export declare function describeError(error: unknown): string;
export declare function appendErrorLog(scope: string, error: unknown): void;
//# sourceMappingURL=log.d.ts.map