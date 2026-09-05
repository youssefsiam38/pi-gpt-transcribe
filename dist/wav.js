/**
 * Minimal WAV writer.
 *
 * The transcription endpoint takes a container, not raw PCM, and decibri hands
 * us bare int16 samples. A 44-byte canonical RIFF header in front of the
 * samples is the whole conversion — no dependency, no temp file, no re-encode.
 */
const HEADER_BYTES = 44;
const FORMAT_PCM = 1;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;
/** Wrap mono little-endian int16 PCM in a WAV container. */
export function encodeWav(pcm, sampleRate) {
    const header = Buffer.alloc(HEADER_BYTES);
    const byteRate = (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8;
    const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(HEADER_BYTES - 8 + pcm.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16); // fmt chunk size for PCM
    header.writeUInt16LE(FORMAT_PCM, 20);
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BITS_PER_SAMPLE, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}
/** Normalized [0, 1] RMS of an int16 PCM chunk — drives the level meter. */
export function rmsInt16(pcm) {
    const samples = Math.floor(pcm.length / 2);
    if (samples === 0)
        return 0;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        const value = pcm.readInt16LE(i * 2) / 32768;
        sum += value * value;
    }
    return Math.sqrt(sum / samples);
}
//# sourceMappingURL=wav.js.map