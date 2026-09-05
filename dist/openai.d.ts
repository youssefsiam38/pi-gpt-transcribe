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
 * `keywords` and `languages` are gpt-transcribe's context fields (the model
 * supersedes gpt-4o-transcribe, and `languages` replaces whisper's singular
 * `language`). Both are omitted unless configured, so the default request is
 * the two required fields and nothing else.
 */
export interface TranscribeRequest {
    readonly wav: Buffer;
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