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
import { type MicStream } from "./audio.js";
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
export declare class DictationPipeline {
    private readonly mic;
    private readonly config;
    private readonly apiKey;
    private readonly signal;
    private readonly callbacks;
    private readonly maxSegmentBytes;
    private readonly minSegmentBytes;
    private chunks;
    private segmentBytes;
    /** Live VAD state: between a `speech` event and its matching `silence`. */
    private inSpeech;
    /** Quietest audio observed this session — the room's own noise floor, which
     *  is what "silence" actually means on this microphone at this gain. */
    private noiseFloor;
    /** Whether the segment being accumulated contains VAD-confirmed speech. */
    private segmentSawSpeech;
    /** Loudest chunk in the segment being accumulated. */
    private segmentPeak;
    private pending;
    private paused;
    private stopped;
    private detached;
    private parts;
    /** Per-slot completion. A slot can be settled and still empty — a segment
     *  that came back blank, or one whose request failed. */
    private settled;
    /** Slots handed to `onSegment` so far; always a prefix of the settled ones. */
    private delivered;
    /** Every request started so far. Awaiting them all is the commit drain. */
    private tasks;
    /** Most recent request failure, kept on the pipeline itself: the error
     *  callback is suppressed once the overlay is detached, and the commit
     *  path still needs to tell the user what actually went wrong. */
    private lastFailure;
    /** Requests currently in flight, against MAX_CONCURRENT_REQUESTS. */
    private active;
    private waiters;
    constructor(mic: MicStream, config: TranscribeConfig, apiKey: string, signal: AbortSignal, callbacks: PipelineCallbacks);
    start(): void;
    /** Everything transcribed so far, in spoken order — what Enter pastes.
     *  Empty slots are segments still in flight, ones that came back blank, or
     *  ones whose request failed; dropping them avoids double spaces. */
    get transcript(): string;
    /** Segments captured but not yet transcribed. Zero means Enter has nothing
     *  to wait for. */
    get pendingCount(): number;
    get lastError(): string | undefined;
    /**
     * Text transcribed but not yet handed to `onSegment` — after a drain, the
     * phrases that finished once the consumer stopped accepting deliveries.
     */
    get undelivered(): string;
    setPaused(paused: boolean): void;
    /**
     * Stop calling back into the UI. The overlay is torn down the moment the
     * user commits or cancels, but requests stay in flight behind it — and a
     * callback that touches a disposed TUI throws from inside the request
     * chain, where nothing on the cancel path is awaiting to catch it.
     */
    detach(): void;
    /** Stop capture and queue whatever is still buffered. */
    stop(): void;
    /**
     * Wait for every queued segment to finish, bounded. A hung request must not
     * park the caller after the overlay has already closed, so on timeout we
     * return the transcript as it stands — which is the text the user was
     * looking at when they pressed Enter.
     */
    drain(timeoutMs: number): Promise<string>;
    /** Resolve once no request is outstanding. The loop re-checks because a
     *  segment can still be cut while an earlier batch is in flight; after
     *  `stop()` nothing new is added and the first pass is the last. */
    private settle;
    private onChunk;
    private flush;
    private enqueue;
    /** Never rejects: every failure is logged and the slot settles empty, so
     *  one bad segment cannot take down the drain or the process. */
    private run;
    /** Hand over every settled slot at the front of the queue, in order. Stops
     *  at the first slot still in flight; nothing after it moves until it
     *  settles, however long ago the later ones finished. */
    private deliverReady;
    private acquire;
    private release;
    /** Run a UI callback unless the overlay is gone, and never let one throw
     *  into the request chain. */
    private notify;
}
//# sourceMappingURL=pipeline.d.ts.map