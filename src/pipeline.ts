/**
 * Capture → segment → transcribe, in order.
 *
 * Audio arrives in 100 ms chunks and accumulates into a segment. The VAD's
 * `silence` event closes the segment at a phrase boundary; a length cap closes
 * it anyway if you never pause for breath. Each closed segment becomes one
 * request.
 *
 * Requests are serialized through a promise chain rather than fired in
 * parallel. Two segments in flight at once would race to append their text and
 * silently reorder your sentences whenever the second one came back first —
 * a defect you would only notice by re-reading the paste.
 */

import type { TranscribeConfig } from "./config.js";
import { appendErrorLog, describeError } from "./log.js";
import { BYTES_PER_SAMPLE, type MicStream, SAMPLE_RATE } from "./mic.js";
import { transcribe } from "./openai.js";
import { encodeWav, rmsInt16 } from "./wav.js";

export interface PipelineCallbacks {
	/** Normalized [0, 1] input level, once per captured chunk. */
	onLevel(level: number): void;
	/** Full committed transcript, after each segment lands. */
	onTranscript(text: string): void;
	/** Segments captured but not yet transcribed. */
	onPending(count: number): void;
	/** Human-readable summary of a failure already written to errors.log. */
	onError(message: string): void;
}

function secondsToBytes(seconds: number): number {
	return Math.round(seconds * SAMPLE_RATE) * BYTES_PER_SAMPLE;
}

export class DictationPipeline {
	private readonly maxSegmentBytes: number;
	private readonly minSegmentBytes: number;
	private chunks: Buffer[] = [];
	private segmentBytes = 0;
	/** Set by the VAD's `speech` event for the segment being accumulated. */
	private segmentSawSpeech = false;
	/** Loudest chunk in the segment being accumulated. */
	private segmentPeak = 0;
	private pending = 0;
	private paused = false;
	private stopped = false;
	private detached = false;
	private parts: string[] = [];
	/** Tail of the serialized request chain. Awaiting it awaits every segment
	 *  queued so far, which is exactly what the commit drain needs. */
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly mic: MicStream,
		private readonly config: TranscribeConfig,
		private readonly apiKey: string,
		private readonly signal: AbortSignal,
		private readonly callbacks: PipelineCallbacks,
	) {
		this.maxSegmentBytes = secondsToBytes(config.maxSegmentSeconds);
		this.minSegmentBytes = secondsToBytes(config.minSegmentSeconds);
	}

	start(): void {
		this.mic.on("data", (chunk) => this.onChunk(chunk));
		this.mic.on("speech", () => {
			this.segmentSawSpeech = true;
		});
		this.mic.on("silence", () => this.flush());
		this.mic.once("error", (error) => {
			appendErrorLog("mic", error ?? new Error("microphone error"));
			this.notify(() => this.callbacks.onError(`Microphone error: ${describeError(error)}`));
		});
	}

	get transcript(): string {
		// Empty slots are segments still in flight, or ones that came back
		// blank. Dropping them here keeps the joined text free of double spaces.
		return this.parts.filter((part) => part !== "").join(" ");
	}

	setPaused(paused: boolean): void {
		if (this.paused === paused) return;
		this.paused = paused;
		// Close the open segment on the way into a pause so the words already
		// spoken are transcribed now rather than getting glued to whatever is
		// said after the resume.
		if (paused) this.flush();
	}

	/**
	 * Stop calling back into the UI. The overlay is torn down the moment the
	 * user commits or cancels, but requests stay in flight behind it — and a
	 * callback that touches a disposed TUI throws from inside the request
	 * chain, where nothing on the cancel path is awaiting to catch it.
	 */
	detach(): void {
		this.detached = true;
	}

	/** Stop capture and queue whatever is still buffered. */
	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.flush();
		try {
			this.mic.stop();
		} catch (error) {
			appendErrorLog("mic.stop", error);
		}
	}

	/**
	 * Wait for every queued segment to finish, bounded. A hung request must not
	 * park the caller after the overlay has already closed, so on timeout we
	 * return the transcript as it stands — which is the text the user was
	 * looking at when they pressed Enter.
	 */
	async drain(timeoutMs: number): Promise<string> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(() => {
				appendErrorLog("drain", new Error(`drain timed out after ${timeoutMs}ms`));
				resolve();
			}, timeoutMs);
		});
		try {
			await Promise.race([this.queue, timeout]);
		} finally {
			clearTimeout(timer);
		}
		return this.transcript;
	}

	private onChunk(chunk: Buffer): void {
		if (this.stopped) return;
		const level = rmsInt16(chunk);
		// Guarded like every other callback: this one runs inside the mic's own
		// event handler, so a throw would surface inside the capture stream.
		this.notify(() => this.callbacks.onLevel(level));
		if (this.paused) return;
		this.chunks.push(chunk);
		this.segmentBytes += chunk.length;
		if (level > this.segmentPeak) this.segmentPeak = level;
		// A monologue with no breath pause would otherwise buffer forever and
		// show nothing. Cut it and let the next chunk start a fresh segment.
		if (this.segmentBytes >= this.maxSegmentBytes) this.flush();
	}

	private flush(): void {
		if (this.chunks.length === 0) return;
		const pcm = Buffer.concat(this.chunks);
		const sawSpeech = this.segmentSawSpeech;
		const peak = this.segmentPeak;
		this.chunks = [];
		this.segmentBytes = 0;
		this.segmentSawSpeech = false;
		this.segmentPeak = 0;

		// Sub-threshold segments are door clicks and keyboard clacks the VAD
		// briefly called speech. Sending one costs a request and returns an
		// invented word.
		if (pcm.length < this.minSegmentBytes) return;

		// Two independent reasons to believe there are words in here, because
		// neither alone is enough. The VAD's own verdict is the better signal,
		// but it does not survive a `maxSegmentSeconds` cut: that starts a fresh
		// segment mid-monologue with no new `speech` transition to observe, so
		// the level check is what carries the rest of a long dictation. The
		// level check alone would be a crude gate on a quiet speaker.
		//
		// This is what makes Enter feel instant after a pause. The VAD has
		// already flushed your last phrase by then and the buffer holds nothing
		// but room tone, so the final flush drops it and there is no request to
		// wait on. Press Enter mid-sentence and the tail does hold speech — that
		// one still goes, and the wait is real work, not a re-run.
		if (!sawSpeech && peak < this.config.speechFloor) return;

		this.enqueue(pcm);
	}

	private enqueue(pcm: Buffer): void {
		this.pending += 1;
		this.notify(() => this.callbacks.onPending(this.pending));
		// Index the slot now, fill it when the response lands: the chain is
		// serial, so slots complete in the order they were reserved and the
		// transcript reads in the order it was spoken.
		const slot = this.parts.length;
		this.parts.push("");
		this.queue = this.queue.then(async () => {
			try {
				const text = await transcribe({
					wav: encodeWav(pcm, SAMPLE_RATE),
					apiKey: this.apiKey,
					baseUrl: this.config.baseUrl,
					model: this.config.model,
					prompt: this.config.prompt,
					keywords: this.config.keywords,
					languages: this.config.languages,
					signal: this.signal,
				});
				this.parts[slot] = text.trim();
				this.notify(() => this.callbacks.onTranscript(this.transcript));
			} catch (error) {
				if (this.signal.aborted) return;
				appendErrorLog("transcribe", error);
				this.notify(() => this.callbacks.onError(describeError(error)));
			} finally {
				this.pending -= 1;
				this.notify(() => this.callbacks.onPending(this.pending));
			}
		});
		// The commit path awaits this chain; the cancel path does not. Without a
		// terminal handler an unexpected rejection would be unhandled, and an
		// unhandled rejection ends the Pi process.
		this.queue = this.queue.catch((error) => {
			appendErrorLog("queue", error);
		});
	}

	/** Run a UI callback unless the overlay is gone, and never let one throw
	 *  into the request chain. */
	private notify(emit: () => void): void {
		if (this.detached) return;
		try {
			emit();
		} catch (error) {
			appendErrorLog("callback", error);
		}
	}
}
