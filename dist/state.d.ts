/**
 * What a dictation session looks like from the outside.
 *
 * The terminal widget renders this; so can anything else. It is deliberately
 * plain data with no methods and no host types, so a front end that is not a
 * terminal can render the same session honestly rather than inventing its own
 * vocabulary for the same five facts.
 */
export interface DictationState {
    /** Normalized [0, 1] RMS of the most recent audio chunk. */
    level: number;
    /** Phrases sent for transcription and not yet returned. */
    pending: number;
    /** Phrases already delivered into the prompt this session. */
    inserted: number;
    /** Last failure, or undefined while healthy. */
    error: string | undefined;
    /** `Date.now()` when the session started. */
    startedAt: number;
}
//# sourceMappingURL=state.d.ts.map