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
/** Directory name under the XDG config root. */
export const CONFIG_DIR_NAME = "pi-gpt-transcribe";
/**
 * Where the config file lives for a given environment.
 *
 * Takes the environment rather than reading `process.env` so a host that runs
 * with its own `XDG_CONFIG_HOME` — or a test that must not depend on the
 * machine it runs on — can ask where the file would be without mutating the
 * process. `CONFIG_DIR` and `CONFIG_PATH` are this function applied to the
 * environment at load, which is what every direct user of them wants.
 */
export function configDir(env = process.env) {
    return join(env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"), CONFIG_DIR_NAME);
}
export function configPath(env = process.env) {
    return join(configDir(env), "config.json");
}
export const CONFIG_DIR = configDir();
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
/**
 * Peak level below which a segment is treated as silence and never sent.
 *
 * Only consulted when the voice-activity detector never fired at all for a
 * session — a level threshold is a poor judge of speech, and this one was
 * letting silent tails through: room tone, a breath, or the keystroke that
 * ends the recording all clear -46 dBFS on a mic with any gain on it. The
 * detector's own verdict decides in every normal session.
 */
export const DEFAULT_SPEECH_FLOOR = 0.005;
/** How long the VAD waits below threshold before calling it a phrase end.
 *  decibri's own default is 300 ms, which cuts at natural breath pauses;
 *  500 ms is the LiveKit value and covers them without feeling laggy. */
export const DEFAULT_SILENCE_HOLDOFF_MS = 500;
/** Values that disable the hotkey. Mirrors the spellings people actually try. */
const HOTKEY_OFF = /^(off|none|false|disabled?)$/i;
function str(value) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
function strArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const items = value.map(str).filter((v) => v !== undefined);
    return items.length > 0 ? items : undefined;
}
function num(value, fallback, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return fallback;
    return Math.min(Math.max(value, min), max);
}
function readRaw(env) {
    try {
        const path = configPath(env);
        if (!existsSync(path))
            return {};
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        // Malformed or unreadable config must not take the extension down with
        // it. Defaults keep /transcribe working; the user finds out when the
        // setting they edited has no effect, which is the cheaper failure.
        return {};
    }
}
export function loadConfig(env = process.env) {
    const raw = readRaw(env);
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
        speechFloor: num(raw.speechFloor, DEFAULT_SPEECH_FLOOR, 0, 1),
        debug: raw.debug === true,
    };
}
/** The key actually used for requests, or undefined when nothing is set. */
export function resolveApiKey(config, env = process.env) {
    return config.apiKey ?? str(env[config.apiKeyEnv]);
}
//# sourceMappingURL=config.js.map