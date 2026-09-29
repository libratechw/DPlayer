import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/ts/aribb24.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

class Feeder {
    destroy() { feederDestroyed++; }
}
let feederDestroyed = 0;
class HLSFeeder extends Feeder {
    attachMedia() {}
}
let rejectMainConstruction = false;
class Renderer {
    static latest;
    constructor() {
        if (rejectMainConstruction) throw new Error('Main renderer construction blocked');
        Renderer.latest = this;
        this.renders = 0;
    }
    onContainerResize(width, height) { this.size = [width, height]; }
    onVideoResize(width, height) { this.size = [width, height]; }
    render() { this.renders++; }
    hide() { this.hidden = true; }
    destroy() {}
}
let workerConstructionAttempts = 0;
let rejectWorkerConstruction = true;
let latestWorkerRenderer;
class BlockedWorkerRenderer {
    constructor(_option, onFailure) {
        workerConstructionAttempts++;
        if (rejectWorkerConstruction) throw new Error('Worker construction blocked');
        this.onFailure = onFailure;
        latestWorkerRenderer = this;
    }
    destroy() {}
}
class Controller {
    attachFeeder() {}
    attachRenderer() {}
    attachMedia() {}
    show() {}
    hide() {}
    detachMedia() {}
    detachRenderer() {}
    detachFeeder() {}
    showing() { return true; }
}

const exports = {};
const context = {
    exports,
    require: (name) => name === 'aribb24.js' ? {
        Controller,
        HLSFeeder,
        MPEGTSFeeder: Feeder,
        CanvasMainThreadRenderer: Renderer,
        CanvasWebWorkerRenderer: BlockedWorkerRenderer,
    } : { default: new Map() },
    HTMLCanvasElement: class {},
    devicePixelRatio: 2,
    structuredClone,
};
runInNewContext(javascript, context);
const Aribb24Track = exports.default;

test('the caption snapshot observer requests current-cue replay after its resize', () => {
    for (const target of ['container', 'video']) {
        const track = new Aribb24Track({}, 'Caption', 'mpegts', {
            renderInWorker: false,
            renderer: { resize: { target } },
        });
        const observer = track.displayCue;
        observer.render({ elapsed_time: 0 }, [{ tag: 'Character' }], {});
        assert.notEqual(observer.current(), null);

        const otherResize = target === 'container' ? observer.onVideoResize() : observer.onContainerResize();
        assert.equal(otherResize, false);
        assert.notEqual(observer.current(), null);

        const ownResize = target === 'container' ? observer.onContainerResize() : observer.onVideoResize();
        assert.equal(ownResize, true);
        assert.equal(observer.current(), null);
        track.destroy();
    }
});

test('an asynchronous Worker failure restores the displayed cue on a sized main-thread renderer', () => {
    context.HTMLCanvasElement.prototype.transferControlToOffscreen = () => {};
    context.OffscreenCanvas = class {};
    context.Worker = class {};
    rejectWorkerConstruction = false;
    try {
        const reports = [];
        const video = {
            parentElement: { getBoundingClientRect: () => ({ width: 100, height: 50 }) },
            videoWidth: 1920, videoHeight: 1080,
        };
        const track = new Aribb24Track(video, 'Caption', 'mpegts', { renderInWorker: true },
            (error, recovered) => reports.push({ message: error.message, recovered }));
        track.displayCue.render({ elapsed_time: 0 }, [{ tag: 'Character' }], {});
        latestWorkerRenderer.onFailure(new Error('Worker script failed'));

        assert.ok(track.renderer instanceof Renderer);
        assert.deepEqual(Renderer.latest.size, [200, 100]);
        assert.equal(Renderer.latest.renders, 1);
        assert.deepEqual(reports, [{ message: 'Worker script failed', recovered: true }]);
        track.destroy();
    } finally {
        rejectWorkerConstruction = true;
        delete context.HTMLCanvasElement.prototype.transferControlToOffscreen;
        delete context.OffscreenCanvas;
        delete context.Worker;
    }
});

test('Worker recovery waits for a nonzero video or container size before replaying', () => {
    context.HTMLCanvasElement.prototype.transferControlToOffscreen = () => {};
    context.OffscreenCanvas = class {};
    context.Worker = class {};
    rejectWorkerConstruction = false;
    try {
        for (const target of ['container', 'video']) {
            const video = {
                parentElement: { getBoundingClientRect: () => ({ width: 0, height: 0 }) },
                videoWidth: 0, videoHeight: 0,
            };
            const reports = [];
            const track = new Aribb24Track(video, 'Caption', 'mpegts', {
                renderInWorker: true, renderer: { resize: { target } },
            }, (_error, recovered) => reports.push(recovered));
            track.displayCue.render({ elapsed_time: 0 }, [{ tag: 'Character' }], {});
            latestWorkerRenderer.onFailure(new Error('Worker script failed'));
            assert.ok(track.renderer instanceof Renderer);
            assert.equal(Renderer.latest.size, undefined);
            assert.equal(Renderer.latest.renders, 0);
            assert.equal(track.destroyed, false);
            assert.deepEqual(reports, [true]);
            track.destroy();
        }
    } finally {
        rejectWorkerConstruction = true;
        delete context.HTMLCanvasElement.prototype.transferControlToOffscreen;
        delete context.OffscreenCanvas;
        delete context.Worker;
    }
});

test('a failed Worker recovery reports a fatal subtitle error and releases the track', () => {
    context.HTMLCanvasElement.prototype.transferControlToOffscreen = () => {};
    context.OffscreenCanvas = class {};
    context.Worker = class {};
    rejectWorkerConstruction = false;
    try {
        const reports = [];
        const track = new Aribb24Track({}, 'Caption', 'mpegts', { renderInWorker: true },
            (error, recovered) => reports.push({ message: error.message, recovered }));
        const destroyedBeforeFailure = feederDestroyed;
        rejectMainConstruction = true;
        latestWorkerRenderer.onFailure(new Error('Worker script failed'));
        assert.equal(track.destroyed, true);
        assert.equal(feederDestroyed, destroyedBeforeFailure + 1);
        assert.equal(reports[0].recovered, false);
        assert.match(reports[0].message, /Main renderer construction blocked/);
        track.destroy();
        assert.equal(feederDestroyed, destroyedBeforeFailure + 1);
    } finally {
        rejectMainConstruction = false;
        rejectWorkerConstruction = true;
        delete context.HTMLCanvasElement.prototype.transferControlToOffscreen;
        delete context.OffscreenCanvas;
        delete context.Worker;
    }
});

test('a throwing recovery notification does not destroy the restored renderer', () => {
    context.HTMLCanvasElement.prototype.transferControlToOffscreen = () => {};
    context.OffscreenCanvas = class {};
    context.Worker = class {};
    rejectWorkerConstruction = false;
    try {
        const track = new Aribb24Track({}, 'Caption', 'mpegts', { renderInWorker: true }, () => {
            throw new Error('application listener failed');
        });
        assert.throws(() => latestWorkerRenderer.onFailure(new Error('Worker script failed')),
            /application listener failed/);
        assert.equal(track.destroyed, false);
        assert.ok(track.renderer instanceof Renderer);
        track.destroy();
    } finally {
        rejectWorkerConstruction = true;
        delete context.HTMLCanvasElement.prototype.transferControlToOffscreen;
        delete context.OffscreenCanvas;
        delete context.Worker;
    }
});

test('an external reference cannot restart a destroyed caption track', async () => {
    const track = new Aribb24Track({}, 'Caption', 'mpegts', {});
    track.destroy();
    assert.equal(track.destroyed, true);
    assert.throws(() => track.show(), /destroyed/);
    assert.throws(() => track.hide(), /destroyed/);
    assert.throws(() => track.feedB24(new Uint8Array(), 0), /destroyed/);
    assert.throws(() => track.feedID3(new Uint8Array(), 0), /destroyed/);
    await assert.rejects(track.snapshot(100, 100), /destroyed/);
});

test('the main thread is the default even when Worker APIs exist; explicit Worker failures remain visible', () => {
    context.HTMLCanvasElement.prototype.transferControlToOffscreen = () => {};
    context.OffscreenCanvas = class {};
    context.Worker = class {};
    try {
        const attemptsBefore = workerConstructionAttempts;
        const automatic = new Aribb24Track({}, 'Caption', 'mpegts', {});
        assert.ok(automatic.renderer instanceof Renderer);
        assert.equal(workerConstructionAttempts, attemptsBefore);
        automatic.destroy();

        const destroyedBeforeFailure = feederDestroyed;
        assert.throws(() => new Aribb24Track({}, 'Caption', 'mpegts', { renderInWorker: true }),
            /Worker construction blocked/);
        assert.equal(workerConstructionAttempts, attemptsBefore + 1);
        assert.equal(feederDestroyed, destroyedBeforeFailure + 1);
    } finally {
        delete context.HTMLCanvasElement.prototype.transferControlToOffscreen;
        delete context.OffscreenCanvas;
        delete context.Worker;
    }
});
