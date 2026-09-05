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
export declare const CONFIG_DIR: string;
export declare const CONFIG_PATH: string;
export declare const DEFAULT_MODEL = "gpt-transcribe";
export declare const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export declare const DEFAULT_API_KEY_ENV = "OPENAI_API_KEY";
/**
 * Pi's core and editor keymaps claim ctrl+a..z except h/i/j/m/q, and h/i/j/m
 * are the terminal's aliases for Backspace/Tab/LF/Enter — so ctrl+q is the one
 * plain control key left. It is XOFF flow control on terminals that still have
 * software flow control enabled; `stty -ixon` frees it, and `"hotkey": "off"`
 * turns the binding off entirely for anyone who would rather not bother.
 */
export declare const DEFAULT_HOTKEY = "ctrl+q";
/** A segment longer than this is cut and sent even mid-sentence, so a
 *  non-stop talker still sees text land. The API ceiling is 25 MB per file;
 *  at 16 kHz mono 16-bit that is ~13 minutes, so this is a latency choice,
 *  not a size one. */
export declare const DEFAULT_MAX_SEGMENT_SECONDS = 20;
/** Segments shorter than this are almost always a door closing or a keyboard
 *  clack caught by the VAD. Sending them costs a request and returns a
 *  hallucinated word. */
export declare const DEFAULT_MIN_SEGMENT_SECONDS = 0.35;
/** Silero speech probability above which audio counts as speech. */
export declare const DEFAULT_VAD_THRESHOLD = 0.5;
/**
 * Peak level below which a segment is treated as silence and never sent.
 *
 * Only consulted when the voice-activity detector never fired at all for a
 * session — a level threshold is a poor judge of speech, and this one was
 * letting silent tails through: room tone, a breath, or the keystroke that
 * ends the recording all clear -46 dBFS on a mic with any gain on it. The
 * detector's own verdict decides in every normal session.
 */
export declare const DEFAULT_SPEECH_FLOOR = 0.005;
/** How long the VAD waits below threshold before calling it a phrase end.
 *  decibri's own default is 300 ms, which cuts at natural breath pauses;
 *  500 ms is the LiveKit value and covers them without feeling laggy. */
export declare const DEFAULT_SILENCE_HOLDOFF_MS = 500;
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
    readonly speechFloor: number;
    /** Write a decision trace to `debug.log`. */
    readonly debug: boolean;
}
export declare function loadConfig(): TranscribeConfig;
/** The key actually used for requests, or undefined when nothing is set. */
export declare function resolveApiKey(config: TranscribeConfig): string | undefined;
//# sourceMappingURL=config.d.ts.map