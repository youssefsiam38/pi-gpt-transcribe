/**
 * Minimal WAV writer.
 *
 * The transcription endpoint takes a container, not raw PCM, and decibri hands
 * us bare int16 samples. A 44-byte canonical RIFF header in front of the
 * samples is the whole conversion — no dependency, no temp file, no re-encode.
 */
/** Wrap mono little-endian int16 PCM in a WAV container. */
export declare function encodeWav(pcm: Buffer, sampleRate: number): Buffer;
/** Normalized [0, 1] RMS of an int16 PCM chunk — drives the level meter. */
export declare function rmsInt16(pcm: Buffer): number;
//# sourceMappingURL=wav.d.ts.map