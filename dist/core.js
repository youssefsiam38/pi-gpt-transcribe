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
export const PACKAGE_NAME = "pi-gpt-transcribe";
/** Kept in step with `package.json`. Exported so a host can report which copy
 *  it loaded without reading the manifest. */
export const PACKAGE_VERSION = "0.3.1";
// -------------------------------------------------------------- configuration
// The config file is the contract between this package and whoever edits it.
// One parse, one set of defaults, one place a new key is added.
export { CONFIG_DIR, CONFIG_PATH, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_HOTKEY, DEFAULT_MAX_SEGMENT_SECONDS, DEFAULT_MIN_SEGMENT_SECONDS, DEFAULT_MODEL, DEFAULT_SILENCE_HOLDOFF_MS, DEFAULT_SPEECH_FLOOR, DEFAULT_VAD_THRESHOLD, loadConfig, resolveApiKey, } from "./config.js";
// ------------------------------------------------------------------ the request
// The one network call, with its retry policy and its error type.
export { transcribe, TranscriptionError } from "./openai.js";
// -------------------------------------------------------------------- the audio
// Format, not device: what the endpoint expects and how to produce it.
export { BYTES_PER_SAMPLE, FRAMES_PER_BUFFER, SAMPLE_RATE } from "./audio.js";
export { encodeWav, rmsInt16 } from "./wav.js";
// ----------------------------------------------------------------- segmentation
// The phrase cutter. Takes any `MicStream`, so a caller that already has audio
// can drive it without a microphone; see `PipelineCallbacks` for what it emits.
export { DictationPipeline } from "./pipeline.js";
//# sourceMappingURL=core.js.map