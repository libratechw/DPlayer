import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/ts/player.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const translationSource = readFileSync(new URL('../src/ts/i18n.ts', import.meta.url), 'utf8');
const translationExports = {};
runInNewContext(ts.transpileModule(translationSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: translationExports });

const calls = [];
let failType = null;
class CaptionTrack {
    constructor(video, type, input, options, onRendererFailure) {
        if (type === failType) throw new Error('renderer unavailable');
        calls.push({ kind: 'create', video, type, input, options, onRendererFailure });
    }
    hide() { calls.push({ kind: 'hide' }); }
    destroy() { calls.push({ kind: 'destroy' }); }
    feedID3(data, pts) { calls.push({ kind: 'id3', data, pts }); }
    feedB24(data, pts) { calls.push({ kind: 'b24', data, pts }); }
}

const exports = {};
runInNewContext(javascript, {
    exports,
    require: (name) => ({ default: name === './aribb24' ? CaptionTrack : class {} }),
});
const DPlayer = exports.default;

function playerFor(options = {}) {
    const player = Object.create(DPlayer.prototype);
    player.options = {
        subtitle: { type: 'aribb24' },
        pluginOptions: { aribb24: options },
    };
    player.plugins = {};
    player.user = { get: () => true };
    player.events = { trigger: (...args) => calls.push({ kind: 'event', args }) };
    player.notice = (text) => calls.push({ kind: 'notice', text });
    translationExports.default.call(player, 'ja-jp');
    return player;
}

test('HLS captions and superimpose share backend lifetime and metadata feed', () => {
    calls.length = 0;
    failType = null;
    const player = playerFor();
    const video = {};
    player.initAribb24(video, 'hls');
    assert.deepEqual(calls.filter((call) => call.kind === 'create').map((call) => [call.video, call.type, call.input]), [
        [video, 'Caption', 'hls'],
        [video, 'Superimpose', 'hls'],
    ]);
    player.feedAribb24ID3(new Uint8Array([1]), 3);
    assert.equal(calls.filter((call) => call.kind === 'id3').length, 2);
    player.destroyAribb24();
    assert.equal(calls.filter((call) => call.kind === 'destroy').length, 2);
    assert.equal(player.plugins.aribb24Caption, undefined);
    assert.equal(player.plugins.aribb24Superimpose, undefined);
});

test('MPEGTS caption respects subtitle and superimpose settings', () => {
    calls.length = 0;
    failType = null;
    const player = playerFor({ disableSuperimposeRenderer: true });
    player.user.get = () => false;
    player.initAribb24({}, 'mpegts');
    assert.deepEqual(calls.filter((call) => call.kind === 'create').map((call) => [call.type, call.input]), [
        ['Caption', 'mpegts'],
    ]);
    assert.equal(calls.filter((call) => call.kind === 'hide').length, 1);
    player.feedAribb24B24(new Uint8Array([2]), 4);
    assert.equal(calls.filter((call) => call.kind === 'b24').length, 1);
    player.destroyAribb24();

    calls.length = 0;
    player.options.subtitle = null;
    player.initAribb24({}, 'hls');
    assert.equal(calls.length, 0);
});

test('partial initialization failure releases the first track and reports the error', () => {
    calls.length = 0;
    failType = 'Superimpose';
    try {
        const player = playerFor();
        player.initAribb24({}, 'hls');
        assert.equal(calls.filter((call) => call.kind === 'destroy').length, 1);
        assert.equal(calls.filter((call) => call.kind === 'event').length, 1);
        assert.equal(calls.filter((call) => call.kind === 'notice').length, 1);
        assert.equal(player.plugins.aribb24Caption, undefined);
        assert.equal(player.plugins.aribb24Superimpose, undefined);
    } finally {
        failType = null;
    }
});

test('legacy flat caption options fail visibly instead of silently losing display settings', () => {
    calls.length = 0;
    const player = playerFor({ normalFont: 'Example Font', usePUA: true });
    player.initAribb24({}, 'hls');
    assert.equal(calls.filter((call) => call.kind === 'create').length, 0);
    const error = calls.find((call) => call.kind === 'event' && call.args[0] === 'subtitle_error')?.args[1];
    assert.match(error?.message ?? '', /normalFont, usePUA/);
    assert.equal(calls.filter((call) => call.kind === 'notice').length, 1);
});

test('legacy sound callback is rejected only when configured', () => {
    calls.length = 0;
    playerFor({ PRACallback: () => {} }).initAribb24({}, 'hls');
    const error = calls.find((call) => call.kind === 'event' && call.args[0] === 'subtitle_error')?.args[1];
    assert.match(error?.message ?? '', /PRACallback/);
    assert.equal(calls.filter((call) => call.kind === 'create').length, 0);

    calls.length = 0;
    const player = playerFor({ PRACallback: undefined });
    player.initAribb24({}, 'hls');
    assert.equal(calls.filter((call) => call.kind === 'create').length, 2);
    player.destroyAribb24();
});

test('other v1-only renderer and feeder options are rejected rather than ignored', () => {
    calls.length = 0;
    playerFor({ data_identifier: 0x81, drcsReplaceMapping: {} }).initAribb24({}, 'mpegts');
    const error = calls.find((call) => call.kind === 'event' && call.args[0] === 'subtitle_error')?.args[1];
    assert.match(error?.message ?? '', /data_identifier, drcsReplaceMapping/);
    assert.equal(calls.filter((call) => call.kind === 'create').length, 0);
});

test('caption failure and recovery notices use the player language', () => {
    calls.length = 0;
    failType = null;
    const player = playerFor({ disableSuperimposeRenderer: true });
    player.initAribb24({}, 'mpegts');
    const report = calls.find((call) => call.kind === 'create').onRendererFailure;
    report(new Error('Worker failed'), true);
    assert.equal(calls.find((call) => call.kind === 'notice').text,
        '字幕の Worker 描画が停止したため、メインスレッドで再開しました。');
    calls.length = 0;
    report(new Error('Recovery failed'), false);
    assert.equal(calls.find((call) => call.kind === 'notice').text, 'エラー: 字幕を復元できませんでした。');
    calls.length = 0;
    playerFor({ normalFont: 'Legacy font' }).initAribb24({}, 'hls');
    assert.equal(calls.find((call) => call.kind === 'notice').text, 'エラー: 字幕を初期化できませんでした。');
});
