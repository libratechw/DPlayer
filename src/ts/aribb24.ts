import * as aribb24js from 'aribb24.js';
import NSZDrcsReplacement from './aribb24-drcs-nsz';

export type Aribb24Options = {
    /** @description Do not create the separate superimposed-text track. @default false */
    disableSuperimposeRenderer?: boolean;
    /** @description Feeder options passed to aribb24.js. DPlayer chooses the caption type for each track. */
    feeder?: Parameters<typeof aribb24js.FeederOption.from>[0];
    /** @description Canvas renderer options passed to aribb24.js. */
    renderer?: aribb24js.PartialCanvasRendererOption;
    /** @description Render in a Worker when true; the main thread is the default so page-loaded Web fonts remain available. */
    renderInWorker?: boolean;
    /** @description Replace known DRCS glyphs using the map previously supplied by aribb24.js v1. @default false */
    drcsReplacement?: boolean;
    /** @description Callback for the superimposed-text track's built-in sound requests. */
    onBuiltinSound?: (index: number) => void;
};

export type Aribb24Snapshot = {
    /** Non-null only while this track is shown and a caption is present. The caller must close the bitmap. */
    image: ImageBitmap | null;
    /** Text for the same visible cue as image when available; null if no text was captured. */
    text: string | null;
    /** Whether a visible caption was captured. */
    present: boolean;
};

type Feeder = aribb24js.MPEGTSFeeder | aribb24js.HLSFeeder;
type CanvasRenderer = aribb24js.CanvasMainThreadRenderer | aribb24js.CanvasWebWorkerRenderer;
type CueState = Parameters<aribb24js.CanvasMainThreadRenderer['render']>[0];
type CueTokens = Parameters<aribb24js.CanvasMainThreadRenderer['render']>[1];
type CueInfo = Parameters<aribb24js.CanvasMainThreadRenderer['render']>[2];

const hasImmediateClear = (state: CueState, data: CueTokens): boolean => {
    let elapsed = state.elapsed_time;
    for (const token of data) {
        if (token.tag === 'TimeControlWait') elapsed += token.seconds;
        if (token.tag === 'ClearScreen' && elapsed === 0) return true;
    }
    return false;
};

/** Retains the cue submitted to the display, not the next cue already buffered by the feeder. */
class DisplayCueObserver {
    private cues: { state: CueState; data: CueTokens; info: CueInfo }[] = [];

    constructor(private readonly resizeTarget: 'video' | 'container') {}

    render(state: CueState, data: CueTokens, info: CueInfo): void {
        if (hasImmediateClear(state, data)) {
            this.clear();
        }
        this.cues.push({ state: structuredClone(state), data, info: structuredClone(info) });
    }

    displayed(): readonly { state: CueState; data: CueTokens; info: CueInfo }[] {
        return this.cues;
    }

    clear(): void {
        for (const cue of this.cues) {
            for (const token of cue.data) {
                if (token.tag === 'Bitmap') {
                    token.normal_bitmap.close();
                    token.flashing_bitmap?.close();
                }
            }
        }
        this.cues = [];
    }

    destroy(): void { this.clear(); }
    hide(): void { /* Visibility is owned by the Controller. */ }
    show(): void { /* Visibility is owned by the Controller. */ }
    onAttach(): void { /* This observer has no DOM node. */ }
    onDetach(): void { /* This observer has no DOM node. */ }
    onContainerResize(): boolean {
        if (this.resizeTarget !== 'container') return false;
        this.clear();
        // Ask the Controller to replay the current cue after the display size changes.
        return true;
    }
    onVideoResize(): boolean {
        if (this.resizeTarget !== 'video') return false;
        this.clear();
        return true;
    }
    onPlay(): void { /* The displayed cue remains visible while playing. */ }
    onPause(): void { /* The displayed cue remains visible while paused. */ }
    onSeeking(): void { this.clear(); }
}

/** Owns one caption type for the lifetime of a DPlayer media backend. */
export default class Aribb24Track {
    private readonly controller: aribb24js.Controller;
    private readonly feeder: Feeder;
    private renderer: CanvasRenderer;
    private readonly displayCue: DisplayCueObserver;
    private readonly rendererOption: aribb24js.PartialCanvasRendererOption | undefined;
    private destroyed = false;

    constructor(
        private readonly video: HTMLVideoElement,
        type: 'Caption' | 'Superimpose',
        input: 'hls' | 'mpegts',
        option: Aribb24Options,
        private readonly onRendererFailure?: (error: Error, recovered: boolean) => void,
    ) {
        this.rendererOption = option.drcsReplacement ? {
            ...option.renderer,
            replace: {
                ...option.renderer?.replace,
                drcs: option.renderer?.replace?.drcs ?? NSZDrcsReplacement,
            },
        } : option.renderer;
        this.displayCue = new DisplayCueObserver(option.renderer?.resize?.target ?? 'container');
        const feederOption = {
            ...option.feeder,
            recieve: {
                ...option.feeder?.recieve,
                type,
            },
        };
        const workerAvailable = typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
            && typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined';
        const renderInWorker = option.renderInWorker === true;
        if (renderInWorker && !workerAvailable) {
            throw new Error('ARIB caption Worker rendering is unavailable in this browser.');
        }

        this.feeder = input === 'hls' ? new aribb24js.HLSFeeder(feederOption) : new aribb24js.MPEGTSFeeder(feederOption);
        try {
            if (renderInWorker) {
                this.renderer = new aribb24js.CanvasWebWorkerRenderer(this.rendererOption, (error) => this.recoverWorker(error));
            } else {
                this.renderer = new aribb24js.CanvasMainThreadRenderer(this.rendererOption);
            }
        } catch (error) {
            this.feeder.destroy();
            throw error;
        }

        this.controller = new aribb24js.Controller();
        try {
            this.controller.attachFeeder(this.feeder);
            this.controller.attachRenderer(this.displayCue);
            this.controller.attachRenderer(this.renderer);
            this.controller.attachMedia(video);
            if (this.feeder instanceof aribb24js.HLSFeeder) {
                this.feeder.attachMedia(video);
            }
            if (type === 'Superimpose' && option.onBuiltinSound) {
                this.controller.on(aribb24js.EventType.BuiltinSound, ({ sound }) => option.onBuiltinSound!(sound));
            }
            this.controller.show();
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    private recoverWorker(error: Error): void {
        if (this.destroyed) return;
        let replacement: aribb24js.CanvasMainThreadRenderer | null = null;
        try {
            replacement = new aribb24js.CanvasMainThreadRenderer(this.rendererOption);
            this.controller.detachRenderer(this.renderer);
            this.renderer.destroy();
            this.renderer = replacement;
            this.controller.attachRenderer(replacement);
            if (!this.controller.showing()) {
                replacement.hide();
            }
        } catch (recoveryError) {
            if (replacement && this.renderer !== replacement) replacement.destroy();
            this.destroy();
            this.onRendererFailure?.(recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError)), false);
            return;
        }
        // Reporting is outside the recovery transaction: a consumer event
        // handler must not turn a working replacement into a failed renderer.
        this.onRendererFailure?.(error, true);
    }

    private ensureActive(): void {
        if (this.destroyed) throw new Error('ARIB caption track has been destroyed.');
    }

    feedID3(data: Uint8Array | ArrayBufferLike, pts: number): void {
        this.ensureActive();
        this.feeder.feedID3(data, pts);
    }

    feedB24(data: Uint8Array | ArrayBufferLike, pts: number): void {
        this.ensureActive();
        this.feeder.feedB24(data, pts);
    }

    show(): void {
        this.ensureActive();
        this.controller.show();
    }

    hide(): void {
        this.ensureActive();
        this.controller.hide();
    }

    /** Render a full-resolution still only when a capture is requested. */
    async snapshot(width: number, height: number): Promise<Aribb24Snapshot> {
        this.ensureActive();
        if (!this.controller.showing()) {
            return { image: null, text: null, present: false };
        }
        const cues = this.displayCue.displayed();
        let present = false;
        for (const cue of cues) {
            let elapsed = cue.state.elapsed_time;
            for (const token of cue.data) {
                if (token.tag === 'TimeControlWait') elapsed += token.seconds;
                if (token.tag === 'ClearScreen' && elapsed === 0) present = false;
                if (token.tag === 'Character' || token.tag === 'DRCS' || token.tag === 'Bitmap') present = true;
            }
        }
        if (!present) {
            return { image: null, text: null, present: false };
        }

        const imageRenderer = new aribb24js.CanvasMainThreadRenderer(this.rendererOption);
        const textRenderer = new aribb24js.TextRenderer({ replace: {
            half: this.rendererOption?.replace?.half ?? true,
            drcs: this.rendererOption?.replace?.drcs ?? new Map(),
        } });
        try {
            imageRenderer.resize(width, height);
            for (const cue of cues) {
                imageRenderer.render(structuredClone(cue.state), structuredClone(cue.data), cue.info);
                // TextRenderer ignores Bitmap tokens and must not retain their cloned images.
                textRenderer.render(structuredClone(cue.state),
                    structuredClone(cue.data.filter((token) => token.tag !== 'Bitmap')), cue.info);
            }
            return {
                image: await createImageBitmap(imageRenderer.getPresentationCanvas()),
                text: textRenderer.getText(),
                present: true,
            };
        } finally {
            imageRenderer.destroy();
            textRenderer.destroy();
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.controller.hide();
        this.controller.detachMedia();
        this.controller.detachRenderer(this.renderer);
        this.controller.detachRenderer(this.displayCue);
        this.controller.detachFeeder();
        this.displayCue.destroy();
        this.feeder.destroy();
        this.renderer.destroy();
    }
}
