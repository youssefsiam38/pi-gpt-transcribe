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
import { randomBytes } from "node:crypto";
const ARRAY_FIELD_SUFFIX = "[]";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
/** Body text kept in the thrown error. Enough to see the API's message
 *  without pasting an HTML error page into the log. */
const ERROR_BODY_LIMIT = 400;
export class TranscriptionError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = "TranscriptionError";
    }
}
/** 429 and 5xx are worth another try; a 400 or 401 will fail identically. */
function isRetryableStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}
const CRLF = "\r\n";
/** Field values come from the user's config file. A bare CR or LF in one would
 *  end the part early and corrupt the message, so they collapse to spaces. The
 *  boundary itself is random, so no value can collide with it. */
function sanitize(value) {
    return value.replace(/[\r\n]+/g, " ");
}
function buildMultipart(request) {
    const boundary = `----pi-gpt-transcribe-${randomBytes(16).toString("hex")}`;
    const parts = [];
    const field = (name, value) => {
        parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${sanitize(value)}${CRLF}`));
    };
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="audio.wav"${CRLF}Content-Type: audio/wav${CRLF}${CRLF}`), request.wav, Buffer.from(CRLF));
    field("model", request.model);
    if (request.prompt)
        field("prompt", request.prompt);
    for (const keyword of request.keywords ?? [])
        field(`keywords${ARRAY_FIELD_SUFFIX}`, keyword);
    for (const language of request.languages ?? [])
        field(`languages${ARRAY_FIELD_SUFFIX}`, language);
    parts.push(Buffer.from(`--${boundary}--${CRLF}`));
    // Copied into a plain ArrayBuffer rather than handed over as the Buffer
    // itself: Node's Buffer is pool-backed and is not a `BodyInit`.
    const joined = Buffer.concat(parts);
    const body = new Uint8Array(new ArrayBuffer(joined.byteLength));
    body.set(joined);
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
async function readErrorMessage(response) {
    let body = "";
    try {
        body = await response.text();
    }
    catch {
        // A body we cannot read is not worth a second failure mode; the status
        // line alone still identifies the problem.
    }
    try {
        const parsed = JSON.parse(body);
        const message = parsed.error?.message;
        if (typeof message === "string" && message !== "")
            return message;
    }
    catch {
        // Not JSON — fall through to the truncated raw body.
    }
    return body.slice(0, ERROR_BODY_LIMIT) || response.statusText;
}
async function postOnce(request) {
    // Two independent reasons to give up: the caller closed the overlay, and
    // the request outlived its budget. AbortSignal.any folds them into the one
    // signal fetch takes.
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const { body, contentType } = buildMultipart(request);
    const response = await fetch(`${request.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": contentType },
        body,
        signal,
    });
    if (!response.ok) {
        throw new TranscriptionError(`${request.model} returned ${response.status}: ${await readErrorMessage(response)}`, response.status);
    }
    const payload = (await response.json());
    return typeof payload.text === "string" ? payload.text : "";
}
/** Transcribe one WAV segment, retrying transient failures. Resolves to the
 *  transcript text, which is legitimately empty for a segment of silence. */
export async function transcribe(request) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await postOnce(request);
        }
        catch (error) {
            lastError = error;
            // A closed overlay is a decision, not a hiccup — stop immediately
            // rather than burning the remaining attempts on a dead session.
            if (request.signal?.aborted)
                throw error;
            const retryable = !(error instanceof TranscriptionError) || (error.status !== undefined && isRetryableStatus(error.status));
            if (!retryable || attempt === MAX_ATTEMPTS)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
        }
    }
    throw lastError;
}
//# sourceMappingURL=openai.js.map