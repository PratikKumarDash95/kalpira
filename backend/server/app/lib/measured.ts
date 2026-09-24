// ============================================
// measured.ts — the platform's rule for a quantity that may not exist
// ============================================
// One definition, shared by every feature that produces a number about a person.
//
// Feature 4 introduced this shape for cohort statistics; Feature 5 needs the same
// refusal for a trend with too few points and a benchmark below its publication
// floor. Two definitions of the rule the platform runs on would be one definition
// too many, and the drift between them would be invisible — each would still
// compile, and only a reader comparing them side by side would notice that one had
// grown a way to return a value it could not compute.
//
// The rule itself: a quantity that was not measured is NULL and carries its reason.
// It is never a zero. A zero is a measurement — "nobody cleared the bar" — and
// rendering an absent measurement as one is the single failure this type exists to
// make unrepresentable.

/** A quantity that was computed. */
export interface Computed<T> {
    state: 'computed';
    value: T;
}

/** A quantity that was NOT computed, and why. Carries no value at all. */
export interface Refused {
    state: 'refused';
    reason: string;
}

/**
 * The result of a measurement that may have been refused.
 *
 * THE DISCRIMINANT IS A STRING, AND THAT IS NOT A STYLE CHOICE
 *
 * `backend/tsconfig.json` sets `strict: false`, and with `strictNullChecks` off TypeScript
 * does not narrow a union on a boolean literal — a `{ computable: true } | { computable:
 * false }` pair collapses to `{ computable: boolean }` at every use site, so the refusal
 * branch below every call would be dead code the compiler could not see. String literals
 * survive, so `state` is what the compiler can branch on. The same constraint is recorded
 * in `sessionAccess.ts`, and the boolean `computable` column on the database table is a
 * separate matter — the column stores a flag, this type has to narrow.
 */
export type Measured<T> = Computed<T> | Refused;

export function computed<T>(value: T): Computed<T> {
    return { state: 'computed', value };
}

export function refused<T>(reason: string): Refused {
    return { state: 'refused', reason };
}

/** `Measured<T>` where T is a double — the shape most callers want. */
export type MeasuredNumber = Measured<number>;

/**
 * The value of a computed measurement, or null. For the read path that has to turn a
 * refusal back into the column it came from — a nullable column with a reason
 * beside it — and never for a caller that could act on the refusal instead.
 */
export function valueOrNull<T>(measured: Measured<T>): T | null {
    return measured.state === 'computed' ? measured.value : null;
}

/**
 * The reason a measurement was refused, or null if it was computed. The companion to
 * `valueOrNull`: together they are how a `Measured` becomes the
 * `value` + `notComputableReason` column pair the tables store.
 */
export function reasonOrNull(measured: Measured<unknown>): string | null {
    return measured.state === 'refused' ? measured.reason : null;
}

/** The `value` + `notComputableReason` pair the tables store, as one object. */
export interface Presented<T> {
    value: T | null;
    notComputableReason: string | null;
}

/**
 * A `Measured` as the two columns it becomes.
 *
 * The single place the pairing rule lives: a computed measurement carries its value and no
 * reason, a refusal carries its reason and NO value. Spelled once because a row that got this
 * backwards — a reason beside a value, or a value with no reason — is exactly the shape the
 * database's biconditional CHECK rejects, and the rejection would arrive as a 500 from an
 * insert rather than as a bug anyone could read.
 */
export function present<T>(measured: Measured<T>): Presented<T> {
    return measured.state === 'computed'
        ? { value: measured.value, notComputableReason: null }
        : { value: null, notComputableReason: measured.reason };
}
