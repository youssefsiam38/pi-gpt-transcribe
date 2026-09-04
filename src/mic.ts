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

import type { TranscribeConfig } from "./config.js";

/** Delivered capture rate. 16 kHz mono is the standard speech-model input and
 *  keeps a 20-second segment around 640 KB — far under the 25 MB file cap. */
export const SAMPLE_RATE = 16_000;

/** 1600 frames at 16 kHz = one chunk per 100 ms, which is a comfortable
 *  cadence for the level meter without flooding the render loop. */
export const FRAMES_PER_BUFFER = 1600;

export const BYTES_PER_SAMPLE = 2;

/** The slice of decibri's Microphone this package uses. Declared structurally
 *  so the pipeline can be exercised with a plain EventEmitter. */
export interface MicStream {
	on(event: "data", listener: (chunk: Buffer) => void): unknown;
	on(event: "speech" | "silence", listener: () => void): unknown;
	once(event: "end" | "error" | "close", listener: (error?: Error) => void): unknown;
	stop(): void;
}

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

export async function openMic(config: TranscribeConfig): Promise<MicStream> {
	const microphone = resolveMicrophone(await import("decibri"));
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
