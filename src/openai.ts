/**
 * The one network call in this package: POST /v1/audio/transcriptions.
 *
 * Sent as multipart/form-data with a WAV blob, using Node's global fetch,
 * FormData and Blob — no SDK, so `pi install` pulls nothing but the audio
 * capture library.
 *
 * `keywords` and `languages` are gpt-transcribe's context fields (the model
 * supersedes gpt-4o-transcribe, and `languages` replaces whisper's singular
 * `language`). Both are omitted unless configured, so the default request is
 * the two required fields and nothing else.
 */

const ARRAY_FIELD_SUFFIX = "[]";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
/** Body text kept in the thrown error. Enough to see the API's message
 *  without pasting an HTML error page into the log. */
const ERROR_BODY_LIMIT = 400;

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

function buildForm(request: TranscribeRequest): FormData {
	const form = new FormData();
	form.append("file", new Blob([new Uint8Array(request.wav)], { type: "audio/wav" }), "audio.wav");
	form.append("model", request.model);
	if (request.prompt) form.append("prompt", request.prompt);
	for (const keyword of request.keywords ?? []) form.append(`keywords${ARRAY_FIELD_SUFFIX}`, keyword);
	for (const language of request.languages ?? []) form.append(`languages${ARRAY_FIELD_SUFFIX}`, language);
	return form;
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

	const response = await fetch(`${request.baseUrl}/audio/transcriptions`, {
		method: "POST",
		headers: { Authorization: `Bearer ${request.apiKey}` },
		body: buildForm(request),
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
