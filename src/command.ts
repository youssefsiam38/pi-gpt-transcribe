/**
 * `/transcribe` and its hotkey — both toggle a dictation session.
 *
 * There is no overlay. Dictation runs behind the prompt: each phrase you
 * finish is transcribed and inserted into the editor at the cursor, while the
 * editor keeps focus, so you can type and correct with the keyboard at the
 * same time. A one-line widget above the editor shows the meter and clock.
 * Submitting the prompt ends the session, and a phrase still in flight at
 * that moment is appended to what was submitted rather than left behind for
 * the next prompt.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId, TUI } from "@earendil-works/pi-tui";
import { CONFIG_PATH, loadConfig, resolveApiKey, type TranscribeConfig } from "./config.js";
import { appendErrorLog, debugLog, describeError, LOG_PATH, setDebugEnabled } from "./log.js";
import { openMic } from "./mic.js";
import { DictationPipeline } from "./pipeline.js";
import { DictationWidget, type WidgetState } from "./widget.js";

export const COMMAND_NAME = "transcribe";
const COMMAND_DESCRIPTION = "Start or stop dictation — transcribed by OpenAI gpt-transcribe into the prompt";

const WIDGET_KEY = "gpt-transcribe";

/** Ceiling on the wait for in-flight phrases when a session ends. Normally
 *  only the last phrase is outstanding and this resolves in a second or two. */
const DRAIN_TIMEOUT_MS = 30_000;

interface Session {
	/** Captured at start: `finish` runs from the `input` hook too, which has
	 *  no UI context of its own, and it must take the widget down. */
	readonly ui: ExtensionContext["ui"];
	readonly pipeline: DictationPipeline;
	readonly controller: AbortController;
	readonly state: WidgetState;
	/** The app TUI, captured from the widget factory, for repaints after a paste. */
	tui: Pick<TUI, "requestRender"> | undefined;
	/** Once false, transcribed phrases stop going into the editor and collect
	 *  in `pipeline.undelivered` instead — set when the prompt is submitted. */
	inserting: boolean;
}

/** One session per process. The hotkey and the command both toggle it. */
let session: Session | undefined;

export function registerTranscribe(pi: ExtensionAPI, config: TranscribeConfig): void {
	pi.registerCommand(COMMAND_NAME, {
		description: COMMAND_DESCRIPTION,
		handler: (_args: string, ctx: ExtensionContext) => toggle(ctx, config),
	});

	// Submitting the prompt ends dictation. Nothing keeps recording — or
	// spending API minutes — while the agent works. Whatever was still being
	// transcribed at that instant belongs to the prompt being sent, so it is
	// appended to the submitted text rather than pasted into the next one.
	pi.on("input", async (event) => {
		if (!session) return { action: "continue" as const };
		const tail = await finish(session);
		if (tail === "") return { action: "continue" as const };
		return { action: "transform" as const, text: joinWithSpace(event.text, tail) };
	});

	pi.on("session_shutdown", async () => {
		if (session) await finish(session);
	});

	if (config.hotkey === undefined) return;
	try {
		pi.registerShortcut(config.hotkey as KeyId, {
			description: COMMAND_DESCRIPTION,
			handler: (ctx) => toggle(ctx, config),
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

/** "already typed" + "new phrase" with exactly one space between, and none
 *  when the editor is empty or already ends in whitespace. */
function joinWithSpace(existing: string, addition: string): string {
	if (existing === "" || /\s$/.test(existing)) return `${existing}${addition}`;
	return `${existing} ${addition}`;
}

export async function toggle(ctx: ExtensionContext, registered: TranscribeConfig): Promise<void> {
	if (session) {
		const tail = await finish(session);
		// Stopping by hand keeps the last phrase where it belongs: in the
		// prompt, after whatever is already there.
		if (tail !== "") insert(ctx, session?.tui, tail);
		return;
	}
	await start(ctx, registered);
}

async function start(ctx: ExtensionContext, registered: TranscribeConfig): Promise<void> {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		ctx.ui.notify(`/${COMMAND_NAME} dictates into the prompt and needs an interactive session`, "error");
		return;
	}

	const config = currentConfig(registered);
	setDebugEnabled(config.debug);
	const apiKey = await resolveKey(ctx, config);
	if (!apiKey) {
		ctx.ui.notify(`No API key. Export ${config.apiKeyEnv}, or set "apiKey" in ${CONFIG_PATH}`, "error");
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
	const state: WidgetState = { level: 0, pending: 0, error: undefined, startedAt: Date.now() };
	const current: Session = {
		ui: ctx.ui,
		controller,
		state,
		tui: undefined,
		inserting: true,
		pipeline: new DictationPipeline(mic, config, apiKey, controller.signal, {
			onLevel: (level) => {
				state.level = level;
			},
			onSegment: (text) => {
				// Deliveries arrive in spoken order (the pipeline holds later
				// phrases until earlier ones settle), so inserting each at the
				// cursor as it lands keeps the prompt in the order it was said.
				if (current.inserting) insert(ctx, current.tui, text);
			},
			onPending: (count) => {
				state.pending = count;
			},
			onError: (message) => {
				state.error = message;
			},
		}),
	};
	session = current;

	ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
		current.tui = tui;
		return new DictationWidget(tui, theme, state, config.hotkey);
	});
	current.pipeline.start();
	debugLog("session", "started");
}

/**
 * Insert a phrase into the editor at the cursor, continuing whatever is
 * already there. pasteToEditor writes straight into the editor component and
 * bypasses the TUI's input path — the only thing that repaints after a
 * keystroke — so the repaint is requested explicitly, or the text sits in the
 * editor unseen until the next key.
 */
function insert(ctx: ExtensionContext, tui: Pick<TUI, "requestRender"> | undefined, text: string): void {
	const existing = ctx.ui.getEditorText();
	const prefix = existing === "" || /\s$/.test(existing) ? "" : " ";
	ctx.ui.pasteToEditor(`${prefix}${text}`);
	tui?.requestRender();
}

/**
 * End the session: stop capture, wait (bounded) for phrases still in flight,
 * take down the widget, and return the text that finished after insertion
 * stopped — the caller decides where that goes.
 */
async function finish(current: Session): Promise<string> {
	if (session !== current) return "";
	session = undefined;
	current.inserting = false;
	current.pipeline.detach();
	current.pipeline.stop();

	const outstanding = current.pipeline.pendingCount;
	debugLog("session", `stopping, pending: ${outstanding}`);
	if (outstanding > 0) {
		// Only now is there anything to wait for. Showing a status with
		// nothing in flight made ending on a pause look like a re-transcribe.
		const label = outstanding === 1 ? "final phrase" : `${outstanding} phrases`;
		const startedAt = Date.now();
		try {
			await current.pipeline.drain(DRAIN_TIMEOUT_MS);
		} finally {
			debugLog("session", `drained in ${Date.now() - startedAt}ms (${label})`);
		}
	}
	current.controller.abort();
	current.ui.setWidget(WIDGET_KEY, undefined);
	// Per-phrase failures showed in the widget while it was up; once it is
	// gone the last one still needs saying, or a dead key fails silently.
	const failure = current.pipeline.lastError;
	if (failure) current.ui.notify(`Transcription failed — ${failure}. See ${LOG_PATH}`, "error");
	return current.pipeline.undelivered;
}
