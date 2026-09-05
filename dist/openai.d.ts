/**
 * The one network call in this package: POST /v1/audio/transcriptions.
 *
 * Sent as multipart/form-data using the global fetch — no SDK, so `pi install`
 * pulls nothing but the audio capture library.
 *
 * The multipart body is assembled by hand into one Buffer rather than handed
 * to `FormData`. Pi replaces the global fetch with its own bundled undici, and
 * that build serializes a FormData body through an async loop that enqueues
 * into a ReadableStream it does not re-check for closure:
 *
 *     for await (const bytes of iterator) {
 *       if (isErrored(stream)) break;          // closed is not errored
 *       controller.enqueue(new Uint8Array(bytes));
 *     }
 *
 * Aborting a request mid-upload closes that stream, the next enqueue throws
 * ERR_INVALID_STATE, and because the loop is a floating async IIFE the throw
 * surfaces as an unhandled rejection that takes the whole Pi process down —
 * uncatchable from the call site. A Buffer body skips that path entirely: it
 * is passed through as a plain source with no stream and no enqueue.
 *
 * The container is the caller's choice. The endpoint decides how to decode
 * from the part's filename and content type, so both are parameters rather
 * than the constant `audio.wav` they used to be: a caller that already has
 * Opus from a browser should not have to transcode it to send it.
 *
 * `keywords` and `languages` are gpt-transcribe's context fields (the model
 * supersedes gpt-4o-transcribe, and `languages` replaces whisper's singular
 * `language`). Both are omitted unless configured, so the default request is
 * the two required fields and nothing else.
 */
export interface TranscribeRequest {
    /**
     * The audio payload, in any container the endpoint accepts — wav, mp3, m4a,
     * webm, ogg, flac. Give {@link filename} and {@link contentType} to match;
     * they default to WAV, which is what {@link encodeWav} produces.
     */
    readonly audio?: Uint8Array;
    /** @deprecated Use {@link audio}. Kept so 0.3 callers keep working. */
    readonly wav?: Buffer;
    /**
     * Sent as the part filename. The endpoint decides how to decode from the
     * extension, so it has to match the bytes: `speech.webm` for Opus in WebM.
     */
    readonly filename?: string | undefined;
    /** MIME type of {@link audio}. Defaults to `audio/wav`. */
    readonly contentType?: string | undefined;
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly model: string;
    readonly prompt?: string | undefined;
    readonly keywords?: readonly string[] | undefined;
    readonly languages?: readonly string[] | undefined;
    readonly signal?: AbortSignal | undefined;
}
export declare class TranscriptionError extends Error {
    readonly status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
/** Transcribe one WAV segment, retrying transient failures. Resolves to the
 *  transcript text, which is legitimately empty for a segment of silence. */
export declare function transcribe(request: TranscribeRequest): Promise<string>;
//# sourceMappingURL=openai.d.ts.map