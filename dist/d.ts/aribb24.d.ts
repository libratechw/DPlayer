import * as aribb24js from 'aribb24.js';
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
/** Owns one caption type for the lifetime of a DPlayer media backend. */
export default class Aribb24Track {
    private readonly video;
    private readonly onRendererFailure?;
    private readonly controller;
    private readonly feeder;
    private renderer;
    private readonly displayCue;
    private readonly rendererOption;
    private destroyed;
    constructor(video: HTMLVideoElement, type: 'Caption' | 'Superimpose', input: 'hls' | 'mpegts', option: Aribb24Options, onRendererFailure?: ((error: Error, recovered: boolean) => void) | undefined);
    private recoverWorker;
    private ensureActive;
    feedID3(data: Uint8Array | ArrayBufferLike, pts: number): void;
    feedB24(data: Uint8Array | ArrayBufferLike, pts: number): void;
    show(): void;
    hide(): void;
    /** Render a full-resolution still only when a capture is requested. */
    snapshot(width: number, height: number): Promise<Aribb24Snapshot>;
    destroy(): void;
}
//# sourceMappingURL=aribb24.d.ts.map