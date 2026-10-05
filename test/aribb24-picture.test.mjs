import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const aribb24 = require('aribb24.js');
const javascript = ts.transpileModule(readFileSync(new URL('../src/ts/aribb24.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('the installed Controller bounds SBTVD display history and snapshot replay', async () => {
    const previous = Object.fromEntries(['ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
        .map(name => [name, globalThis[name]]));
    Object.assign(globalThis, {
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    });
    const cues = Array.from({ length: 200 }, (_, pts) => ({ pts, duration: Infinity,
        state: aribb24.ARIBB24BrazilianInitialParserState,
        data: [aribb24.ARIBB24CharacterToken.from(String(pts))],
        info: { association: 'SBTVD', language: 'por' } }));
    let controller, replayed = 0;
    class Controller extends aribb24.Controller { constructor() { super(); controller = this; } }
    class Feeder {
        prepare() {} clear() {} destroy() {} onAttach() {} onDetach() {} onSeeking() {}
        content(time) { return cues[Math.floor(time)]; }
        contentRange(from, to) { return cues.filter(cue => (from === null || cue.pts > from) && cue.pts <= to); }
    }
    class Renderer {
        render() { replayed++; }
        resize() {} getPresentationCanvas() { return {}; }
        clear() {} show() {} hide() {} destroy() {} onAttach() {} onDetach() {}
        onPlay() {} onPause() {} onSeeking() {}
        onContainerResize() { return false; } onVideoResize() { return false; }
    }
    const exports = {};
    runInNewContext(javascript, {
        exports, structuredClone, createImageBitmap: async () => ({ close() {} }),
        HTMLCanvasElement: class { },
        require: name => name === 'aribb24.js' ? { ...aribb24, Controller,
            MPEGTSFeeder: Feeder, CanvasMainThreadRenderer: Renderer } : { default: new Map() },
    });
    const media = Object.assign(new EventTarget(), { currentTime: 0, paused: false, seeking: false,
        parentElement: {}, buffered: { length: 1, start: () => 0, end: () => 300 } });
    let track;
    try {
        track = new exports.default(media, 'Caption', 'mpegts', { renderInWorker: false });
        for (const cue of cues) { media.currentTime = cue.pts; controller.paint(false); }
        replayed = 0;
        const snapshot = await track.snapshot(1920, 1080);
        assert.equal(snapshot.text, '199');
        assert.equal(snapshot.present, true);
        assert.equal(replayed, 1);
        snapshot.image.close();
    } finally {
        track?.destroy();
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
        }
    }
});
