/**
 * `/transcribe` and its hotkey.
 *
 * Both entry points run the same body: open the mic, show the overlay, and on
 * commit paste the transcript into Pi's editor. Nothing is submitted for you —
 * the text lands in the prompt so a misheard word gets caught before it reaches
 * the model.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { CONFIG_PATH, loadConfig, resolveApiKey, type TranscribeConfig } from "./config.js";
import { appendErrorLog, describeError, LOG_PATH } from "./log.js";
import { openMic } from "./mic.js";
import { DictationOverlay, type OverlayIntent, type OverlayState } from "./overlay.js";
import { DictationPipeline } from "./pipeline.js";

export const COMMAND_NAME = "transcribe";
const COMMAND_DESCRIPTION = "Dictate with your voice — transcribed by OpenAI gpt-transcribe";

/** Redraw cadence while the overlay is open. Fast enough for a smooth level
 *  meter, slow enough that the render loop is not the busiest thing running. */
const TICK_MS = 100;

/** Ceiling on the post-commit wait for in-flight segments. Normally only the
 *  last phrase is outstanding and this resolves in a second or two. */
const DRAIN_TIMEOUT_MS = 30_000;

const STATUS_KEY = "gpt-transcribe";

export function registerTranscribe(pi: ExtensionAPI, config: TranscribeConfig): void {
	pi.registerCommand(COMMAND_NAME, {
		description: COMMAND_DESCRIPTION,
		handler: (_args: string, ctx: ExtensionContext) => runDictation(ctx, config),
	});

	if (config.hotkey === undefined) return;
	try {
		pi.registerShortcut(config.hotkey as KeyId, {
			description: COMMAND_DESCRIPTION,
			handler: (ctx) => runDictation(ctx, config),
		});
	} catch (error) {
		// An unparseable key in config.json is a typo, not a reason to lose the
		// command. Log it and leave /transcribe registered.
		appendErrorLog("shortcut", error);
	}
}

/** Re-read config.json so a hand edit applies on the next run, with the
 *  registration-time config as the fallback for a file that has since broken. */
function currentConfig(fallback: TranscribeConfig): TranscribeConfig {
	try {
		return loadConfig();
	} catch {
		return fallback;
	}
}

/**
 * Key resolution, in order: the config file, the environment, then whatever Pi
 * already holds for the `openai` provider — so someone who authenticated Pi
 * with a platform API key does not have to export it a second time.
 *
 * The provider id is deliberately `openai` and not the active model's: an
 * OAuth-backed provider such as `openai-codex` hands back a bearer token that
 * the audio endpoint rejects, and a confusing 401 is worse than a clear
 * "no API key".
 */
async function resolveKey(ctx: ExtensionContext, config: TranscribeConfig): Promise<string | undefined> {
	const configured = resolveApiKey(config);
	if (configured) return configured;
	try {
		return await ctx.modelRegistry.getApiKeyForProvider("openai");
	} catch (error) {
		appendErrorLog("apiKey", error);
		return undefined;
	}
}

export async function runDictation(ctx: ExtensionContext, registered: TranscribeConfig): Promise<void> {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		ctx.ui.notify(`/${COMMAND_NAME} draws an overlay and needs an interactive session`, "error");
		return;
	}

	const config = currentConfig(registered);
	const apiKey = await resolveKey(ctx, config);
	if (!apiKey) {
		ctx.ui.notify(
			`No API key. Export ${config.apiKeyEnv}, or set "apiKey" in ${CONFIG_PATH}`,
			"error",
		);
		return;
	}

	let mic: Awaited<ReturnType<typeof openMic>>;
	try {
		mic = await openMic(config);
	} catch (error) {
		appendErrorLog("mic.open", error);
		ctx.ui.notify(
			`Microphone unavailable: ${describeError(error)}. Check an input device is connected and this terminal has microphone permission.`,
			"error",
		);
		return;
	}

	const controller = new AbortController();
	const startedAt = Date.now();
	const state: OverlayState = {
		transcript: "",
		level: 0,
		pending: 0,
		paused: false,
		error: undefined,
		elapsedMs: 0,
	};

	let pipeline: DictationPipeline | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;

	const intent = await ctx.ui.custom<OverlayIntent>((tui, theme, keybindings, done) => {
		const overlay = new DictationOverlay(theme, keybindings, tui.terminal, {
			onIntent: (result) => done(result),
			onTogglePause: () => {
				state.paused = !state.paused;
				pipeline?.setPaused(state.paused);
			},
		});

		const refresh = (): void => {
			state.elapsedMs = Date.now() - startedAt;
			overlay.setState(state);
			tui.requestRender();
		};

		pipeline = new DictationPipeline(mic, config, apiKey, controller.signal, {
			onLevel: (level) => {
				state.level = level;
			},
			onTranscript: (text) => {
				state.transcript = text;
				refresh();
			},
			onPending: (count) => {
				state.pending = count;
				refresh();
			},
			onError: (message) => {
				state.error = message;
				refresh();
			},
		});
		pipeline.start();

		// The clock and the level meter change without any pipeline event, so
		// the overlay needs a heartbeat of its own to stay live.
		ticker = setInterval(refresh, TICK_MS);
		refresh();
		return overlay;
	});

	if (ticker) clearInterval(ticker);
	pipeline?.stop();

	if (intent !== "commit") {
		// Cancel aborts first: the in-flight requests are for text nobody will
		// read, and the pipeline suppresses errors once the signal is down.
		controller.abort();
		return;
	}

	// Stop happens before abort on this path — the final segment's request is
	// the one whose result the user is waiting for.
	ctx.ui.setStatus(STATUS_KEY, "transcribing…");
	let transcript = "";
	try {
		transcript = await pipeline!.drain(DRAIN_TIMEOUT_MS);
	} finally {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		controller.abort();
	}

	if (transcript !== "") {
		ctx.ui.pasteToEditor(transcript);
	} else if (state.error) {
		ctx.ui.notify(`Nothing transcribed — ${state.error}. See ${LOG_PATH}`, "error");
	}
}
