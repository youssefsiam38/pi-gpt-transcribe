/**
 * The half of this package that is not a terminal.
 *
 * `/transcribe` is a terminal front end over a small library: read the config,
 * cut speech into phrases, wrap each one in a WAV container, post it, hand
 * back text. Only the first and last steps of the *presentation* need a TUI —
 * the library underneath needs nothing but Node.
 *
 * Everything exported here is free of `@earendil-works/pi-tui` and of the
 * microphone, so it can be imported by a front end that already has audio: a
 * browser tab, a socket, a file on disk, a test. Import it as
 * `pi-gpt-transcribe/core`.
 *
 * The point is that there is one definition of each of these things. A second
 * front end that re-derives the config format, the request shape, or the
 * session state is a copy that drifts the moment either side changes, and the
 * drift is silent: the config file still parses, it just stops meaning the
 * same thing. Importing the definitions makes a breaking change a build error
 * instead of a support question.
 *
 * Stability: this entry point is public API and follows semver. `index.ts`,
 * the extension itself, is not — it is loaded by Pi, not imported.
 */
export declare const PACKAGE_NAME = "pi-gpt-transcribe";
/** Kept in step with `package.json`. Exported so a host can report which copy
 *  it loaded without reading the manifest. */
export declare const PACKAGE_VERSION = "0.4.0";
export { CONFIG_DIR, CONFIG_DIR_NAME, CONFIG_PATH, configDir, configPath, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_HOTKEY, DEFAULT_MAX_SEGMENT_SECONDS, DEFAULT_MIN_SEGMENT_SECONDS, DEFAULT_MODEL, DEFAULT_SILENCE_HOLDOFF_MS, DEFAULT_SPEECH_FLOOR, DEFAULT_VAD_THRESHOLD, loadConfig, resolveApiKey, type TranscribeConfig, } from "./config.js";
export { transcribe, type TranscribeRequest, TranscriptionError } from "./openai.js";
export { BYTES_PER_SAMPLE, FRAMES_PER_BUFFER, type MicStream, SAMPLE_RATE } from "./audio.js";
export { encodeWav, rmsInt16 } from "./wav.js";
export type { DictationState } from "./state.js";
export { DictationPipeline, type PipelineCallbacks } from "./pipeline.js";
//# sourceMappingURL=core.d.ts.map