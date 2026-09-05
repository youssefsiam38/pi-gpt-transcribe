/**
 * Audio capture constants and the shape of a capture stream.
 *
 * These live apart from `mic.ts` because they describe the *format* rather
 * than the device. A caller that already has audio — from a browser, a file,
 * or a socket — needs the format to feed the pipeline, and must not have to
 * import a module that reaches for a microphone to get it.
 */
/** Delivered capture rate. 16 kHz mono is the standard speech-model input and
 *  keeps a 20-second segment around 640 KB — far under the 25 MB file cap. */
export const SAMPLE_RATE = 16_000;
/** 1600 frames at 16 kHz = one chunk per 100 ms, which is a comfortable
 *  cadence for a level meter without flooding a render loop. */
export const FRAMES_PER_BUFFER = 1600;
/** int16. */
export const BYTES_PER_SAMPLE = 2;
//# sourceMappingURL=audio.js.map