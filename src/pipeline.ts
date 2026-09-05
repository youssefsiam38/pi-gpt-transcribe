/**
 * Capture → segment → transcribe, in order.
 *
 * Audio arrives in 100 ms chunks and accumulates into a segment. The VAD's
 * `silence` event closes the segment at a phrase boundary; a length cap closes
 * it anyway if you never pause for breath. Each closed segment becomes one
 * request.
 *
 * Requests run concurrently. Ordering does not depend on them completing in
 * order: cutting a segment reserves its slot in `parts` synchronously, and the
 * response only ever fills that slot, so the transcript reads in spoken order
 * whatever sequence the API answers in. Serializing the requests instead would
 * make every segment wait out all the ones before it, and the backlog would be
 * sitting there to drain when you press Enter.
 *
 * Concurrency is capped so a long dictation cannot open an unbounded number of
 * sockets at once, and segments are handed to the consumer only as the
 * contiguous settled prefix advances — otherwise a late-finishing early
 * segment would land in the editor after text that was spoken later.
 */

import type { TranscribeConfig } from "./config.js";
import { appendErrorLog, debugLog, describeError } from "./log.js";
import { BYTES_PER_SAMPLE, type MicStream, SAMPLE_RATE } from "./audio.js";
import { transcribe } from "./openai.js";
import { encodeWav, rmsInt16 } from "./wav.js";

export interface PipelineCallbacks {
	/** Normalized [0, 1] input level, once per captured chunk. */
	onLevel(level: number): void;
	/**
	 * One transcribed phrase, delivered strictly in spoken order. A later
	 * segment that finishes first is held until every earlier one has settled,
	 * because the consumer inserts these into the editor at the cursor and
	 * text already inserted cannot be reordered afterwards.
	 */
	onSegment(text: string): void;
	/** Segments captured but not yet transcribed. */
	onPending(count: number): void;
	/** Human-readable summary of a failure already written to errors.log. */
	onError(message: string): void;
}

/** Ceiling on requests in flight at once. Segments are cut at speech pauses,
 *  so this is generous in normal use; it exists so a very long dictation over a
 *  slow link cannot open sockets without bound. Well under the model's 500
 *  requests-per-minute tier-1 limit. */
const MAX_CONCURRENT_REQUESTS = 4;

/** How far over the room's noise floor a segment's peak must reach to count as
 *  speech. 3x is about 10 dB — speech clears it, room tone does not. */
const NOISE_FLOOR_MARGIN = 3;

/**
 * Ceiling on the computed threshold, about -34 dBFS. Audio this loud is treated
 * as speech no matter what the floor estimate says, which bounds two ways the
 * estimate can be wrong: a session that opens mid-sentence seeds the floor from
 * speech itself, and a genuinely loud room would otherwise scale the threshold
 * up past a quiet speaker. Erring toward sending costs a fraction of a cent;
 * erring the other way loses words.
 */
const MAX_SPEECH_THRESHOLD = 0.02;

/** Per-chunk rate at which the noise floor drifts back up. Deliberately tiny:
 *  at 10 chunks a second it takes minutes to follow a genuinely louder room,
 *  and a single loud chunk moves it almost not at all. */
const NOISE_FLOOR_RISE = 0.0005;

/** Why a segment was closed. Only `max` continues an utterance. */
type FlushReason = "silence" | "max" | "pause" | "stop";

function secondsToBytes(seconds: number): number {
	return Math.round(seconds * SAMPLE_RATE) * BYTES_PER_SAMPLE;
}

export class DictationPipeline {
	private readonly maxSegmentBytes: number;
	private readonly minSegmentBytes: number;
	private chunks: Buffer[] = [];
	private segmentBytes = 0;
	/** Live VAD state: between a `speech` event and its matching `silence`. */
	private inSpeech = false;
	/** Quietest audio observed this session — the room's own noise floor, which
	 *  is what "silence" actually means on this microphone at this gain. */
	private noiseFloor = Number.POSITIVE_INFINITY;
	/** Whether the segment being accumulated contains VAD-confirmed speech. */
	private segmentSawSpeech = false;
	/** Loudest chunk in the segment being accumulated. */
	private segmentPeak = 0;
	private pending = 0;
	private paused = false;
	private stopped = false;
	private detached = false;
	private parts: string[] = [];
	/** Per-slot completion. A slot can be settled and still empty — a segment
	 *  that came back blank, or one whose request failed. */
	private settled: boolean[] = [];
	/** Slots handed to `onSegment` so far; always a prefix of the settled ones. */
	private delivered = 0;
	/** Every request started so far. Awaiting them all is the commit drain. */
	private tasks: Promise<void>[] = [];
	/** Most recent request failure, kept on the pipeline itself: the error
	 *  callback is suppressed once the overlay is detached, and the commit
	 *  path still needs to tell the user what actually went wrong. */
	private lastFailure: string | undefined;
	/** Requests currently in flight, against MAX_CONCURRENT_REQUESTS. */
	private active = 0;
	private waiters: Array<() => void> = [];

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
			this.inSpeech = true;
			this.segmentSawSpeech = true;
			debugLog("vad", "speech");
		});
		this.mic.on("silence", () => {
			this.inSpeech = false;
			debugLog("vad", "silence");
			this.flush("silence");
		});
		this.mic.once("error", (error) => {
			appendErrorLog("mic", error ?? new Error("microphone error"));
			this.notify(() => this.callbacks.onError(`Microphone error: ${describeError(error)}`));
		});
	}

	/** Everything transcribed so far, in spoken order — what Enter pastes.
	 *  Empty slots are segments still in flight, ones that came back blank, or
	 *  ones whose request failed; dropping them avoids double spaces. */
	get transcript(): string {
		return this.parts.filter((part) => part !== "").join(" ");
	}

	/** Segments captured but not yet transcribed. Zero means Enter has nothing
	 *  to wait for. */
	get pendingCount(): number {
		return this.pending;
	}

	get lastError(): string | undefined {
		return this.lastFailure;
	}

	/**
	 * Text transcribed but not yet handed to `onSegment` — after a drain, the
	 * phrases that finished once the consumer stopped accepting deliveries.
	 */
	get undelivered(): string {
		return this.parts
			.slice(this.delivered)
			.filter((part) => part !== "")
			.join(" ");
	}

	setPaused(paused: boolean): void {
		if (this.paused === paused) return;
		this.paused = paused;
		// Close the open segment on the way into a pause so the words already
		// spoken are transcribed now rather than getting glued to whatever is
		// said after the resume.
		if (paused) this.flush("pause");
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
		this.flush("stop");
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
			await Promise.race([this.settle(), timeout]);
		} finally {
			clearTimeout(timer);
		}
		return this.transcript;
	}

	/** Resolve once no request is outstanding. The loop re-checks because a
	 *  segment can still be cut while an earlier batch is in flight; after
	 *  `stop()` nothing new is added and the first pass is the last. */
	private async settle(): Promise<void> {
		let started = -1;
		while (this.tasks.length !== started) {
			started = this.tasks.length;
			await Promise.all(this.tasks);
		}
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
		// Drops to a new minimum at once and creeps back up slowly, so a room
		// that gets noisier is tracked while one loud moment does not raise the
		// floor for the rest of the session.
		this.noiseFloor =
			level < this.noiseFloor ? level : this.noiseFloor + (level - this.noiseFloor) * NOISE_FLOOR_RISE;
		// A monologue with no breath pause would otherwise buffer forever and
		// show nothing. Cut it and let the next chunk start a fresh segment.
		if (this.segmentBytes >= this.maxSegmentBytes) this.flush("max");
	}

	private flush(reason: FlushReason): void {
		if (this.chunks.length === 0) return;
		const pcm = Buffer.concat(this.chunks);
		const sawSpeech = this.segmentSawSpeech;
		const peak = this.segmentPeak;
		const seconds = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
		this.chunks = [];
		this.segmentBytes = 0;
		this.segmentPeak = 0;
		// A length cut lands mid-utterance, so the segment it opens continues
		// the same speech run and inherits the flag. Every other reason ends the
		// run — after a `silence` the next audio is room tone until the detector
		// says otherwise.
		this.segmentSawSpeech = reason === "max" ? this.inSpeech : false;

		const drop = (why: string): void => {
			debugLog("flush", `${reason} ${seconds.toFixed(2)}s dropped (${why})`);
		};

		if (pcm.length < this.minSegmentBytes) {
			drop("shorter than minSegmentSeconds");
			return;
		}

		// Judged against the room rather than an absolute level. A fixed
		// threshold cannot tell room tone from speech across microphones: 0.005
		// was under the room tone on a mic with gain on it, which put a request
		// of pure silence in front of every Enter. Speech runs an order of
		// magnitude over the floor the room settles at; room tone sits on it.
		//
		// The detector can only ever ADD confidence here, never remove it.
		// Gating on it directly was a mistake: if it fires once early and never
		// re-arms, every later segment looks speechless and the whole dictation
		// is silently thrown away. Wrongly sending a segment costs a fraction of
		// a cent; wrongly dropping one loses words the user already spoke.
		const floor = Number.isFinite(this.noiseFloor) ? this.noiseFloor : 0;
		const threshold = Math.min(MAX_SPEECH_THRESHOLD, Math.max(this.config.speechFloor, floor * NOISE_FLOOR_MARGIN));
		const hasSpeech = sawSpeech || peak >= threshold;
		if (!hasSpeech) {
			drop(`peak ${peak.toFixed(4)} under ${threshold.toFixed(4)} (floor ${floor.toFixed(4)})`);
			return;
		}

		debugLog(
			"flush",
			`${reason} ${seconds.toFixed(2)}s sent (peak ${peak.toFixed(4)}, floor ${floor.toFixed(4)}, vad ${sawSpeech})`,
		);
		this.enqueue(pcm);
	}

	private enqueue(pcm: Buffer): void {
		this.pending += 1;
		this.notify(() => this.callbacks.onPending(this.pending));
		// Reserve the slot now, fill it whenever the response lands. This — not
		// the order the requests finish in — is what keeps the transcript in
		// spoken order, which is why the requests can safely run concurrently.
		const slot = this.parts.length;
		this.parts.push("");
		this.settled.push(false);
		this.tasks.push(this.run(slot, pcm));
	}

	/** Never rejects: every failure is logged and the slot settles empty, so
	 *  one bad segment cannot take down the drain or the process. */
	private async run(slot: number, pcm: Buffer): Promise<void> {
		const startedAt = Date.now();
		try {
			await this.acquire();
			try {
				const text = await transcribe({
					audio: encodeWav(pcm, SAMPLE_RATE),
					apiKey: this.apiKey,
					baseUrl: this.config.baseUrl,
					model: this.config.model,
					prompt: this.config.prompt,
					keywords: this.config.keywords,
					languages: this.config.languages,
					signal: this.signal,
				});
				this.parts[slot] = text.trim();
				debugLog("request", `slot ${slot} ok in ${Date.now() - startedAt}ms`);
			} finally {
				this.release();
			}
		} catch (error) {
			if (!this.signal.aborted) {
				debugLog("request", `slot ${slot} failed in ${Date.now() - startedAt}ms: ${describeError(error)}`);
				appendErrorLog("transcribe", error);
				this.lastFailure = describeError(error);
				this.notify(() => this.callbacks.onError(this.lastFailure ?? ""));
			}
		} finally {
			// Settle before rendering: a failed slot must stop blocking the
			// visible prefix, or one error would freeze the on-screen transcript
			// for the rest of the session.
			this.settled[slot] = true;
			this.pending -= 1;
			this.deliverReady();
			this.notify(() => this.callbacks.onPending(this.pending));
		}
	}

	/** Hand over every settled slot at the front of the queue, in order. Stops
	 *  at the first slot still in flight; nothing after it moves until it
	 *  settles, however long ago the later ones finished. */
	private deliverReady(): void {
		// After detach the consumer is no longer inserting, so nothing is
		// consumed: whatever settles from here on stays in `undelivered` for
		// the caller that ends the session to place — appended to a submitted
		// prompt, or pasted after a manual stop.
		if (this.detached) return;
		while (this.delivered < this.parts.length && this.settled[this.delivered]) {
			const slot = this.delivered;
			this.delivered += 1;
			const text = this.parts[slot];
			if (text) this.notify(() => this.callbacks.onSegment(text));
		}
	}

	private async acquire(): Promise<void> {
		// Re-checked in a loop rather than assumed: several waiters can be woken
		// by successive releases before any of them runs.
		while (this.active >= MAX_CONCURRENT_REQUESTS) {
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		}
		this.active += 1;
	}

	private release(): void {
		this.active -= 1;
		this.waiters.shift()?.();
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
