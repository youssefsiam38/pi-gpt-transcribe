/**
 * Config I/O for pi-gpt-transcribe.
 *
 * Everything is optional: with `OPENAI_API_KEY` exported and no config file at
 * all, `/transcribe` works. The file exists for the knobs that cannot be
 * guessed — a different hotkey, a domain vocabulary, a proxy base URL.
 *
 * Load is crash-resistant. A missing file, unreadable file or malformed JSON
 * resolves to defaults rather than throwing, because the alternative is an
 * extension that fails to load and takes its `/transcribe` command with it.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(
	process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"),
	"pi-gpt-transcribe",
);
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export const DEFAULT_MODEL = "gpt-transcribe";
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_API_KEY_ENV = "OPENAI_API_KEY";

/**
 * Pi's core and editor keymaps claim ctrl+a..z except h/i/j/m/q, and h/i/j/m
 * are the terminal's aliases for Backspace/Tab/LF/Enter — so ctrl+q is the one
 * plain control key left. It is XOFF flow control on terminals that still have
 * software flow control enabled; `stty -ixon` frees it, and `"hotkey": "off"`
 * turns the binding off entirely for anyone who would rather not bother.
 */
export const DEFAULT_HOTKEY = "ctrl+q";

/** A segment longer than this is cut and sent even mid-sentence, so a
 *  non-stop talker still sees text land. The API ceiling is 25 MB per file;
 *  at 16 kHz mono 16-bit that is ~13 minutes, so this is a latency choice,
 *  not a size one. */
export const DEFAULT_MAX_SEGMENT_SECONDS = 20;

/** Segments shorter than this are almost always a door closing or a keyboard
 *  clack caught by the VAD. Sending them costs a request and returns a
 *  hallucinated word. */
export const DEFAULT_MIN_SEGMENT_SECONDS = 0.35;

/** Silero speech probability above which audio counts as speech. */
export const DEFAULT_VAD_THRESHOLD = 0.5;

/** How long the VAD waits below threshold before calling it a phrase end.
 *  decibri's own default is 300 ms, which cuts at natural breath pauses;
 *  500 ms is the LiveKit value and covers them without feeling laggy. */
export const DEFAULT_SILENCE_HOLDOFF_MS = 500;

export interface TranscribeConfig {
	/** Transcription model id. */
	readonly model: string;
	/** API root, no trailing slash. Point it at a gateway or Azure-style proxy. */
	readonly baseUrl: string;
	/** Literal key from the config file, if the user put one there. */
	readonly apiKey: string | undefined;
	/** Environment variable consulted when `apiKey` is absent. */
	readonly apiKeyEnv: string;
	/** Hotkey that opens the overlay, or undefined when disabled. */
	readonly hotkey: string | undefined;
	/** Free-form context about what you dictate — jargon, project names, style. */
	readonly prompt: string | undefined;
	/** Literal terms that may appear in the audio. */
	readonly keywords: readonly string[] | undefined;
	/** Language hints (ISO-639-1). Absent means auto-detect. */
	readonly languages: readonly string[] | undefined;
	readonly maxSegmentSeconds: number;
	readonly minSegmentSeconds: number;
	readonly vadThreshold: number;
	readonly silenceHoldoffMs: number;
}

/** Values that disable the hotkey. Mirrors the spellings people actually try. */
const HOTKEY_OFF = /^(off|none|false|disabled?)$/i;

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function strArray(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value.map(str).filter((v): v is string => v !== undefined);
	return items.length > 0 ? items : undefined;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(value, min), max);
}

function readRaw(): Record<string, unknown> {
	try {
		if (!existsSync(CONFIG_PATH)) return {};
		const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		// Malformed or unreadable config must not take the extension down with
		// it. Defaults keep /transcribe working; the user finds out when the
		// setting they edited has no effect, which is the cheaper failure.
		return {};
	}
}

export function loadConfig(): TranscribeConfig {
	const raw = readRaw();
	const hotkeyRaw = raw.hotkey === undefined ? DEFAULT_HOTKEY : str(raw.hotkey);
	return {
		model: str(raw.model) ?? DEFAULT_MODEL,
		baseUrl: (str(raw.baseUrl) ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
		apiKey: str(raw.apiKey),
		apiKeyEnv: str(raw.apiKeyEnv) ?? DEFAULT_API_KEY_ENV,
		hotkey: hotkeyRaw !== undefined && !HOTKEY_OFF.test(hotkeyRaw) ? hotkeyRaw : undefined,
		prompt: str(raw.prompt),
		keywords: strArray(raw.keywords),
		languages: strArray(raw.languages),
		maxSegmentSeconds: num(raw.maxSegmentSeconds, DEFAULT_MAX_SEGMENT_SECONDS, 2, 600),
		minSegmentSeconds: num(raw.minSegmentSeconds, DEFAULT_MIN_SEGMENT_SECONDS, 0, 10),
		vadThreshold: num(raw.vadThreshold, DEFAULT_VAD_THRESHOLD, 0, 1),
		silenceHoldoffMs: num(raw.silenceHoldoffMs, DEFAULT_SILENCE_HOLDOFF_MS, 0, 5000),
	};
}

/** The key actually used for requests, or undefined when nothing is set. */
export function resolveApiKey(config: TranscribeConfig): string | undefined {
	return config.apiKey ?? str(process.env[config.apiKeyEnv]);
}
