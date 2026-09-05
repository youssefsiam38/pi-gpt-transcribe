/**
 * Microphone capture.
 *
 * decibri opens the device at whatever rate it actually supports and resamples
 * to the rate we ask for, so there is no fallback ladder here: a built-in mic
 * locked to 48 kHz and a USB headset at 16 kHz both arrive as 16 kHz mono
 * int16, which is what the transcription endpoint wants.
 *
 * Silero VAD runs inside decibri and gives us the `silence` event that ends a
 * phrase. That event, not a timer, is what decides where one request stops and
 * the next begins.
 */

import { BYTES_PER_SAMPLE, FRAMES_PER_BUFFER, type MicStream, SAMPLE_RATE } from "./audio.js";
import type { TranscribeConfig } from "./config.js";

// The format and the stream shape describe audio, not devices, so they live in
// `audio.js` where a caller can reach them without opening a microphone. Kept
// re-exported here because this is where they have always been imported from.
export { BYTES_PER_SAMPLE, FRAMES_PER_BUFFER, type MicStream, SAMPLE_RATE };

interface DecibriModule {
	Microphone: {
		open(options: Record<string, unknown>): Promise<MicStream>;
	};
}

/** decibri is CommonJS; under ESM the named exports may land on the namespace
 *  or behind `.default` depending on Node's interop analysis. Check both. */
function resolveMicrophone(mod: unknown): DecibriModule["Microphone"] {
	const namespace = mod as Partial<DecibriModule> & { default?: Partial<DecibriModule> };
	const microphone = namespace.Microphone ?? namespace.default?.Microphone;
	if (!microphone) throw new Error("decibri did not export Microphone");
	return microphone;
}

/**
 * decibri is an optional dependency: it carries prebuilt native audio bindings
 * for every platform, and nothing but this function needs them. It is installed
 * by default, so a normal `pi install` is unaffected — but a consumer of
 * `pi-gpt-transcribe/core` that already has audio can skip it, and an install
 * on a platform with no prebuild degrades to "no microphone" instead of a
 * failed install.
 *
 * The failure has to say so out loud. A bare ERR_MODULE_NOT_FOUND from a
 * dynamic import tells the person nothing they can act on.
 */
async function loadDecibri(): Promise<unknown> {
	try {
		return await import("decibri");
	} catch (error) {
		const code = (error as { code?: unknown }).code;
		if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
			throw new Error(
				"Microphone capture needs the optional `decibri` package, which is not installed. " +
					"Install it in the same place as pi-gpt-transcribe (`npm install decibri`), " +
					"or reinstall this package without `--no-optional`.",
				{ cause: error },
			);
		}
		throw error;
	}
}

export async function openMic(config: TranscribeConfig): Promise<MicStream> {
	const microphone = resolveMicrophone(await loadDecibri());
	return microphone.open({
		sampleRate: SAMPLE_RATE,
		channels: 1,
		framesPerBuffer: FRAMES_PER_BUFFER,
		dtype: "int16",
		vad: {
			model: "silero",
			threshold: config.vadThreshold,
			holdoffMs: config.silenceHoldoffMs,
		},
	});
}
