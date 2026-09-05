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

import { randomBytes } from "node:crypto";

const ARRAY_FIELD_SUFFIX = "[]";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
/** Body text kept in the thrown error. Enough to see the API's message
 *  without pasting an HTML error page into the log. */
const ERROR_BODY_LIMIT = 400;

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

export class TranscriptionError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "TranscriptionError";
	}
}

/** 429 and 5xx are worth another try; a 400 or 401 will fail identically. */
function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

const CRLF = "\r\n";

/** Field values come from the user's config file. A bare CR or LF in one would
 *  end the part early and corrupt the message, so they collapse to spaces. The
 *  boundary itself is random, so no value can collide with it. */
function sanitize(value: string): string {
	return value.replace(/[\r\n]+/g, " ");
}

interface MultipartBody {
	/** A plain Uint8Array, not a Buffer: `BodyInit` does not accept Node's
	 *  Buffer type, and the point of this whole function is to hand fetch a
	 *  body it treats as a flat source rather than a stream. */
	readonly body: Uint8Array<ArrayBuffer>;
	readonly contentType: string;
}

const DEFAULT_FILENAME = "audio.wav";
const DEFAULT_CONTENT_TYPE = "audio/wav";

/** `audio` is the field; `wav` is what it used to be called. Exactly one has
 *  to be there, and saying which is missing beats a 400 from the API. */
function audioOf(request: TranscribeRequest): Uint8Array {
	const audio = request.audio ?? request.wav;
	if (audio === undefined) throw new TypeError("transcribe() needs `audio` (a Uint8Array of encoded audio).");
	return audio;
}

function buildMultipart(request: TranscribeRequest): MultipartBody {
	const boundary = `----pi-gpt-transcribe-${randomBytes(16).toString("hex")}`;
	const parts: Buffer[] = [];

	const field = (name: string, value: string): void => {
		parts.push(
			Buffer.from(
				`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${sanitize(value)}${CRLF}`,
			),
		);
	};

	const filename = sanitize(request.filename ?? DEFAULT_FILENAME).replace(/"/g, "");
	const contentType = sanitize(request.contentType ?? DEFAULT_CONTENT_TYPE);
	parts.push(
		Buffer.from(
			`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}Content-Type: ${contentType}${CRLF}${CRLF}`,
		),
		Buffer.from(audioOf(request)),
		Buffer.from(CRLF),
	);
	field("model", request.model);
	if (request.prompt) field("prompt", request.prompt);
	for (const keyword of request.keywords ?? []) field(`keywords${ARRAY_FIELD_SUFFIX}`, keyword);
	for (const language of request.languages ?? []) field(`languages${ARRAY_FIELD_SUFFIX}`, language);
	parts.push(Buffer.from(`--${boundary}--${CRLF}`));

	// Copied into a plain ArrayBuffer rather than handed over as the Buffer
	// itself: Node's Buffer is pool-backed and is not a `BodyInit`.
	const joined = Buffer.concat(parts);
	const body = new Uint8Array(new ArrayBuffer(joined.byteLength));
	body.set(joined);
	return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function readErrorMessage(response: Response): Promise<string> {
	let body = "";
	try {
		body = await response.text();
	} catch {
		// A body we cannot read is not worth a second failure mode; the status
		// line alone still identifies the problem.
	}
	try {
		const parsed = JSON.parse(body) as { error?: { message?: unknown } };
		const message = parsed.error?.message;
		if (typeof message === "string" && message !== "") return message;
	} catch {
		// Not JSON — fall through to the truncated raw body.
	}
	return body.slice(0, ERROR_BODY_LIMIT) || response.statusText;
}

async function postOnce(request: TranscribeRequest): Promise<string> {
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
		throw new TranscriptionError(
			`${request.model} returned ${response.status}: ${await readErrorMessage(response)}`,
			response.status,
		);
	}

	const payload = (await response.json()) as { text?: unknown };
	return typeof payload.text === "string" ? payload.text : "";
}

/** Transcribe one WAV segment, retrying transient failures. Resolves to the
 *  transcript text, which is legitimately empty for a segment of silence. */
export async function transcribe(request: TranscribeRequest): Promise<string> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return await postOnce(request);
		} catch (error) {
			lastError = error;
			// A closed overlay is a decision, not a hiccup — stop immediately
			// rather than burning the remaining attempts on a dead session.
			if (request.signal?.aborted) throw error;
			const retryable = !(error instanceof TranscriptionError) || (error.status !== undefined && isRetryableStatus(error.status));
			if (!retryable || attempt === MAX_ATTEMPTS) throw error;
			await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
		}
	}
	throw lastError;
}
