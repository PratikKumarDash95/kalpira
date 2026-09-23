// ============================================
// deliveryCapture.ts — the browser half of Feature 2
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// WHAT THIS DOES AND, MORE IMPORTANTLY, WHAT IT REFUSES TO DO
//
// This module taps the microphone and camera the interview is already using and
// writes down two raw signals:
//
//   · An RMS envelope — the loudness of the room every 50ms.
//   · Per-frame luminance statistics — brightness, spread, edge sharpness, and how
//     much of the picture is crushed to black or blown to white.
//
// That is the entire job. It measures; it does not judge. No metric, no band, no
// score, no adjustment is computed here, because anything computed in the browser
// is something a candidate can edit before it is sent. Every derived number lives
// on the server, in `backend/server/app/lib/delivery/`, which treats this payload
// as untrusted input and sanitises it field by field.
//
// The payload is therefore small — an RMS number and a timestamp 20 times a second
// — and it is bounded before it is sent, so a long answer cannot post something the
// server has to refuse.
//
// THREE WAYS THIS COULD LIE, AND WHAT IT DOES INSTEAD
//
//   1. The interviewer's own voice. TTS plays out of the speakers and comes straight
//      back in through the microphone. Sampling during it would measure the AI and
//      bill it to the candidate. So nothing is sampled while the interviewer is
//      speaking — and that same boundary is what defines when the answer window
//      opens.
//
//   2. A suspended audio context. Browsers withhold audio processing until the page
//      has had a user gesture. A suspended AnalyserNode returns pure digital silence,
//      which is indistinguishable from a muted microphone — and the server, seeing
//      silence, would tell the candidate their microphone may have been muted. That
//      would be the platform blaming someone for a browser policy, so samples are
//      only taken while the context is actually running.
//
//   3. Automatic gain control. The interview asks for `autoGainControl: true`
//      because it helps speech recognition, but AGC flattens loudness differences —
//      exactly what the vocal-variation metric reads. The applied settings are
//      reported alongside the envelope so the server can say so on the metric
//      itself rather than quietly penalising a candidate for their microphone.
//
// Failure policy: this module never throws and never blocks. A live interview must
// not break because a canvas could not be read. Anything that fails is written into
// `captureNote`, which is shown to the reader and never scored.

// --------------------------------------------
// Sampling constants
// --------------------------------------------

/** Must match ENVELOPE_SAMPLE_INTERVAL_MS on the server, which documents the 50ms choice. */
const ENVELOPE_INTERVAL_MS = 50;

/**
 * Video is sampled far less often than audio, deliberately.
 *
 * Image statistics move slowly — a person's framing and lighting do not change
 * twenty times a second — so a half-second cadence captures everything the video
 * metrics read while costing a small fraction of the work. Audio is where the fast
 * detail is: a pause is a hundred milliseconds wide and would fall between frames.
 */
const FRAME_INTERVAL_MS = 500;

/**
 * Frame size for the analysis canvas: 64×48, which is 1/100th the pixels of a
 * 640×480 stream.
 *
 * This is not a quality compromise. The metrics are luminance mean, spread, edge
 * sharpness and clipping ratios — all of them statistical properties of the whole
 * frame, and all of them stable under downscaling. Reading the full frame would
 * cost a hundred times the work per sample to compute almost exactly the same
 * numbers, on a machine that is simultaneously running speech recognition and
 * video calls.
 */
const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 48;

/** Below/above these luma values a pixel is treated as crushed or blown. */
const CLIP_DARK = 16;
const CLIP_BRIGHT = 239;

/**
 * Client-side caps, matching MAX_ENVELOPE_SAMPLES and MAX_FRAMES in the server's
 * capture.ts.
 *
 * The cap is enforced here as well as there because a payload that has to be
 * truncated on arrival is a payload that was wasteful to send — and because
 * noticing it here is what lets the reader be told the answer was cut short.
 */
const MAX_ENVELOPE_SAMPLES = 20_000;
const MAX_FRAMES = 2_000;

/**
 * A gap longer than this means the sampler did not run when it should have.
 *
 * Background tabs have their timers throttled to roughly once a second, which
 * leaves holes in the envelope that no amount of server-side care can recover.
 * The timing is still reported, but with the caveat attached.
 */
const GAP_WARNING_MS = 250;

/**
 * How long to wait for a spoken question to begin before giving up on it.
 *
 * The window opens the moment the question is shown, and speech synthesis starts a
 * beat later. If it has not started by now it is not going to — the voice is missing
 * or the browser refused to speak — and waiting longer would cost the candidate the
 * audio record of their entire answer in exchange for a latency figure that was
 * never going to arrive.
 */
const QUESTION_SPEAK_GRACE_MS = 2000;

// --------------------------------------------
// The wire format — kept in step with the server's DeliveryCapturePayload
// --------------------------------------------

export interface CaptureEnvelopeSample {
    tMs: number;
    rms: number;
}

export interface CaptureFrameStats {
    tMs: number;
    meanLuma: number;
    stdLuma: number;
    laplacianVariance: number;
    clippedDarkRatio: number;
    clippedBrightRatio: number;
}

/** The audio constraints actually in force, as reported by the track. */
export interface CaptureAudioSettings {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
}

/**
 * What gets posted with an answer.
 *
 * Declared here rather than imported from the backend because the two apps are
 * separate packages — the backend is the authority, and this type exists to match
 * it. The server parses every field defensively anyway, so a drift between the two
 * degrades into an unmeasured metric rather than an error.
 */
export interface DeliveryCapturePayload {
    envelope: CaptureEnvelopeSample[];
    frames: CaptureFrameStats[];
    /**
     * Milliseconds from the start of the capture window to the moment the question
     * finished being read aloud. Null when there was no spoken question, which makes
     * the latency metric unmeasured rather than wrong — see `beginAnswer`.
     */
    questionEndedAtMs: number | null;
    answerDurationMs: number;
    captureNote?: string;
    audio?: CaptureAudioSettings;
}

export interface DeliveryCapture {
    /**
     * Opens a capture window for the answer about to be given.
     *
     * `latencyMeasurable` says whether this interview reads its questions aloud. It
     * is the difference between two honest behaviours:
     *
     *   · true  — the question is spoken, so "the question ended" is an event this
     *     module can observe, and the time until the candidate starts speaking is a
     *     real measurement of response latency.
     *
     *   · false — the question is displayed as text. The candidate reads it, and
     *     reading time is not response latency. Rather than measure a blend of the
     *     two and call it latency, the field is left null and the server reports the
     *     metric as unmeasured.
     */
    beginAnswer(options?: { latencyMeasurable?: boolean }): void;

    /** Closes the window and returns the payload, or null when nothing was captured. */
    endAnswer(): DeliveryCapturePayload | null;

    /** True when audio is actually being sampled, for a UI that wants to show it. */
    isCapturingAudio(): boolean;

    /** Releases the audio graph and the sampler. Safe to call more than once. */
    dispose(): void;
}

/** A handle that does nothing, for server rendering and unsupported browsers. */
function inertCapture(): DeliveryCapture {
    return {
        beginAnswer() { /* no capture available */ },
        endAnswer() { return null; },
        isCapturingAudio() { return false; },
        dispose() { /* nothing to release */ },
    };
}

/**
 * Builds a capture bound to the interview's existing camera and microphone stream.
 *
 * The stream is fetched through `getStream` rather than passed in because it arrives
 * asynchronously — `getUserMedia` resolves after the component mounts — and because
 * the candidate can toggle the camera or microphone at any point. Reading it at each
 * use keeps this module correct through all of that without a re-subscription.
 */
export function createDeliveryCapture(options: {
    getStream: () => MediaStream | null;
    getVideoElement: () => HTMLVideoElement | null;
    isAiSpeaking: () => boolean;
}): DeliveryCapture {
    if (typeof window === 'undefined') return inertCapture();

    // ── Audio graph ──────────────────────────────────────────────────────────
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    // Zero-length rather than null: `getFloatTimeDomainData` is typed against a
    // buffer backed by a plain ArrayBuffer, and inference from the constructor is
    // what keeps that type — an explicit `Float32Array` annotation widens it to one
    // backed by a SharedArrayBuffer, which the analyser will not accept.
    let audioSamples = new Float32Array(0);
    let audioSetupFailed = false;

    // ── Video canvas ─────────────────────────────────────────────────────────
    let canvas: HTMLCanvasElement | null = null;
    let canvasContext: CanvasRenderingContext2D | null = null;
    let luma: Float32Array | null = null;
    let videoSetupFailed = false;

    // ── Capture state ────────────────────────────────────────────────────────
    let timer: number | null = null;
    let disposed = false;
    let startedAt: number | null = null;
    let latencyMeasurable = false;
    let latencyAbandoned = false;
    let sawQuestionSpoken = false;
    let questionEndedAtMs: number | null = null;
    let envelope: CaptureEnvelopeSample[] = [];
    let frames: CaptureFrameStats[] = [];
    /**
     * A condition of the browser or the device that will not change between answers.
     *
     * Kept apart from the per-window note because it SHOULD persist: a browser that
     * cannot analyse audio will not be able to for the next question either, and
     * re-learning that on every answer would bury the reason it is missing.
     */
    let conditionNote: string | null = null;
    /**
     * Something about this answer's own recording — a gap, a truncation, an
     * unmeasurable latency. Cleared with the window, because carrying it forward
     * would make a statement about the previous answer that is false of this one.
     */
    let windowNote: string | null = null;
    let truncationNoted = false;
    let lastSampleAt: number | null = null;
    let lastFrameAt = 0;
    let audioSettings: CaptureAudioSettings | undefined;

    function addConditionNote(message: string): void {
        // The first wins: it is invariably the cause, and the ones that follow are
        // its consequences — a failed audio graph produces a note on every tick.
        if (conditionNote === null) conditionNote = message;
    }

    function addWindowNote(message: string): void {
        if (windowNote === null) windowNote = message;
    }

    /** The two notes in the order a reader wants them: this answer, then the setup. */
    function combinedNote(): string | null {
        const parts = [windowNote, conditionNote].filter((part): part is string => Boolean(part));
        return parts.length > 0 ? parts.join(' ') : null;
    }

    // ── Setup ────────────────────────────────────────────────────────────────

    function setupAudio(): void {
        if (analyser !== null || audioSetupFailed) return;
        const stream = options.getStream();
        if (!stream || stream.getAudioTracks().length === 0) return;

        try {
            const Ctor =
                window.AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) {
                audioSetupFailed = true;
                addConditionNote('This browser cannot analyse microphone audio, so nothing about how the answer was spoken could be measured.');
                return;
            }

            audioContext = new Ctor();
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            // 1024 samples is ~21ms at a typical 48kHz rate: fine-grained enough to
            // catch the shape of a syllable, coarse enough that the reading is a
            // level rather than a single oscillation.
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0;
            // Connected to the analyser and nowhere else. Routing a microphone to
            // the speakers would be a feedback loop, and the analyser needs no sink
            // to be read.
            source.connect(analyser);
            audioSamples = new Float32Array(analyser.fftSize);

            // Chrome starts the context suspended until the page has been interacted
            // with. The candidate has clicked by now, so this normally succeeds
            // immediately; the promise is ignored because a failure is handled by
            // the state check on every sample.
            void audioContext.resume().catch(() => { /* handled by the running check */ });

            readAudioSettings(stream);
        } catch {
            audioSetupFailed = true;
            addConditionNote('The microphone could not be analysed, so nothing about how the answer was spoken could be measured.');
        }
    }

    /**
     * Records the audio constraints the browser actually applied.
     *
     * `getSettings` reports what is in force, not what was requested — a browser is
     * free to ignore a constraint, and the difference is exactly what decides whether
     * the vocal-variation figure is trustworthy.
     */
    function readAudioSettings(stream: MediaStream): void {
        try {
            const track = stream.getAudioTracks()[0];
            if (!track || typeof track.getSettings !== 'function') return;
            const settings = track.getSettings() as MediaTrackSettings;
            audioSettings = {
                echoCancellation: settings.echoCancellation === true,
                noiseSuppression: settings.noiseSuppression === true,
                autoGainControl: settings.autoGainControl === true,
            };
        } catch {
            // Absent settings are reported as absent — the server then treats the
            // audio as unqualified rather than assuming the best case.
        }
    }

    function setupVideo(): void {
        if (canvasContext !== null || videoSetupFailed) return;
        try {
            canvas = document.createElement('canvas');
            canvas.width = FRAME_WIDTH;
            canvas.height = FRAME_HEIGHT;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) {
                videoSetupFailed = true;
                addConditionNote('This browser could not provide an image reading, so the picture signals are absent.');
                return;
            }
            canvasContext = context;
            luma = new Float32Array(FRAME_WIDTH * FRAME_HEIGHT);
        } catch {
            videoSetupFailed = true;
            addConditionNote('This browser could not provide an image reading, so the picture signals are absent.');
        }
    }

    // ── Sampling ─────────────────────────────────────────────────────────────

    /** True when the audio graph exists and is actually processing sound. */
    function audioIsLive(): boolean {
        return analyser !== null && audioSamples.length > 0 && audioContext?.state === 'running';
    }

    function sampleAudio(elapsed: number): void {
        if (!audioIsLive() || !analyser) return;

        // getFloatTimeDomainData returns the raw waveform, so this is a true RMS —
        // unlike the byte-scaled alternative, which would make loudness depend on
        // where the browser put its dynamic range.
        analyser.getFloatTimeDomainData(audioSamples);
        let sumSquares = 0;
        for (let i = 0; i < audioSamples.length; i += 1) {
            sumSquares += audioSamples[i] * audioSamples[i];
        }
        const rms = Math.sqrt(sumSquares / audioSamples.length);

        if (envelope.length >= MAX_ENVELOPE_SAMPLES) {
            if (!truncationNoted) {
                truncationNoted = true;
                addWindowNote('This answer was long enough that the audio record was cut off partway through.');
            }
            return;
        }

        envelope.push({ tMs: elapsed, rms });
    }

    function sampleFrame(elapsed: number): void {
        if (!canvasContext || !canvas || !luma) return;

        const video = options.getVideoElement();
        // readyState 2 means there is a current frame to read; videoWidth is 0 until
        // metadata has arrived, and drawImage would throw on an empty source.
        if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
            return;
        }

        // A disabled track keeps showing the last frame it received. Sampling that
        // would report a perfectly still, perfectly sharp image — the candidate's
        // camera being switched off would look like excellent video quality.
        const track = options.getStream()?.getVideoTracks()[0];
        if (track && !track.enabled) return;

        if (frames.length >= MAX_FRAMES) return;

        try {
            canvasContext.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
            const { data } = canvasContext.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

            const count = luma.length;
            let sum = 0;
            let sumSquares = 0;
            let dark = 0;
            let bright = 0;

            for (let i = 0, p = 0; i < count; i += 1, p += 4) {
                const r = data[p];
                const g = data[p + 1];
                const b = data[p + 2];
                // Rec. 709 luma: green carries most of the perceived brightness,
                // which is why a green screen reads so much lighter than a blue one.
                const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                luma[i] = value;
                sum += value;
                sumSquares += value * value;
                if (r <= CLIP_DARK && g <= CLIP_DARK && b <= CLIP_DARK) dark += 1;
                if (r >= CLIP_BRIGHT || g >= CLIP_BRIGHT || b >= CLIP_BRIGHT) bright += 1;
            }

            const mean = sum / count;
            const variance = Math.max(0, sumSquares / count - mean * mean);

            frames.push({
                tMs: elapsed,
                meanLuma: mean,
                stdLuma: Math.sqrt(variance),
                laplacianVariance: laplacianVariance(),
                clippedDarkRatio: dark / count,
                clippedBrightRatio: bright / count,
            });
        } catch {
            // Reading the canvas can fail while the tab is being torn down. One
            // failed frame is not worth a note, and a run of them produces no frames
            // at all — which the server reports as video signals simply absent.
        }
    }

    /**
     * Variance of the Laplacian over the luma plane — the standard focus measure.
     *
     * The Laplacian responds to edges, so a sharp frame has many strong ones and
     * their variance is high; blur spreads those edges into gentle ramps and the
     * variance collapses. Computed on the interior only, because the kernel needs
     * four neighbours and inventing them at the border would manufacture edges that
     * are not in the picture.
     */
    function laplacianVariance(): number {
        if (!luma) return 0;
        let sum = 0;
        let sumSquares = 0;
        let count = 0;

        for (let y = 1; y < FRAME_HEIGHT - 1; y += 1) {
            for (let x = 1; x < FRAME_WIDTH - 1; x += 1) {
                const i = y * FRAME_WIDTH + x;
                const value =
                    4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - FRAME_WIDTH] - luma[i + FRAME_WIDTH];
                sum += value;
                sumSquares += value * value;
                count += 1;
            }
        }

        if (count === 0) return 0;
        const mean = sum / count;
        return Math.max(0, sumSquares / count - mean * mean);
    }

    function tick(): void {
        if (disposed || startedAt === null) return;

        const now = performance.now();
        const elapsed = Math.round(now - startedAt);

        // A gap means the sampler was starved — almost always a backgrounded tab,
        // where browsers throttle timers to about once a second. The record is still
        // usable, but the timing figures over it are approximate and saying so is
        // cheaper than pretending.
        if (lastSampleAt !== null && elapsed - lastSampleAt > GAP_WARNING_MS) {
            addWindowNote('Part of this answer was recorded with interruptions, so the timing figures for it are approximate.');
        }
        lastSampleAt = elapsed;

        if (options.isAiSpeaking()) {
            // The interviewer is talking. What the microphone hears now is their
            // voice coming back through the speakers, so it is neither the
            // candidate's speech nor the candidate's silence — it is not evidence
            // about them at all, and it is never sampled. The last moment we saw
            // this is when the question ended.
            if (latencyMeasurable && !latencyAbandoned) {
                sawQuestionSpoken = true;
                questionEndedAtMs = elapsed;
            }
            return;
        }

        if (latencyMeasurable && !latencyAbandoned && !sawQuestionSpoken) {
            // The window has been open for a while and the question has still not
            // been read aloud. Fall back to capturing the answer without a latency
            // figure rather than throwing the whole recording away.
            if (elapsed < QUESTION_SPEAK_GRACE_MS) return;
            latencyAbandoned = true;
            addWindowNote('The question was not read aloud, so the time taken to start answering could not be measured.');
        }

        sampleAudio(elapsed);

        if (now - lastFrameAt >= FRAME_INTERVAL_MS) {
            lastFrameAt = now;
            sampleFrame(elapsed);
        }
    }

    // ── The public handle ────────────────────────────────────────────────────

    function beginAnswer(beginOptions?: { latencyMeasurable?: boolean }): void {
        if (disposed) return;

        // A previous window that was never closed would otherwise bleed into this
        // one, attributing the last answer's audio to this question.
        resetWindow();

        latencyMeasurable = beginOptions?.latencyMeasurable === true;
        startedAt = performance.now();

        setupAudio();
        setupVideo();

        timer = window.setInterval(tick, ENVELOPE_INTERVAL_MS);
    }

    function resetWindow(): void {
        if (timer !== null) {
            window.clearInterval(timer);
            timer = null;
        }
        startedAt = null;
        latencyAbandoned = false;
        sawQuestionSpoken = false;
        questionEndedAtMs = null;
        envelope = [];
        frames = [];
        truncationNoted = false;
        lastSampleAt = null;
        lastFrameAt = 0;
        // This window's own note goes with the window. What this answer's recording
        // looked like is not a fact about the next answer, and reporting it as one
        // would put a sentence about the previous question beside the new one.
        windowNote = null;
        // `conditionNote` and the setup flags deliberately survive: a browser that
        // cannot analyse audio will not be able to do so for the next question
        // either, and re-learning that on every answer would bury the reason.
    }

    function endAnswer(): DeliveryCapturePayload | null {
        if (startedAt === null) return null;

        const durationMs = Math.round(performance.now() - startedAt);

        const captureNote = combinedNote();
        const hasAnything = envelope.length > 0 || frames.length > 0 || captureNote !== null;
        const payload: DeliveryCapturePayload | null = hasAnything
            ? {
                  envelope,
                  frames,
                  // Null unless a spoken question actually ended during this window:
                  // an unmeasured latency is a gap in the record, an invented one is
                  // a wrong statement about the candidate.
                  questionEndedAtMs: latencyMeasurable ? questionEndedAtMs : null,
                  answerDurationMs: durationMs,
                  ...(captureNote ? { captureNote } : {}),
                  ...(audioSettings ? { audio: audioSettings } : {}),
              }
            : null;

        resetWindow();
        return payload;
    }

    return {
        beginAnswer,
        endAnswer,
        isCapturingAudio: audioIsLive,
        dispose() {
            if (disposed) return;
            disposed = true;
            resetWindow();
            try {
                analyser?.disconnect();
                void audioContext?.close().catch(() => { /* already closing */ });
            } catch {
                // Closing an already-closed context is not a problem worth reporting.
            }
            audioContext = null;
            analyser = null;
            audioSamples = new Float32Array(0);
            canvas = null;
            canvasContext = null;
            luma = null;
        },
    };
}
