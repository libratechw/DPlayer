import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('src/ts/player.ts', 'utf8');

assert.match(
    source,
    /function diagnosticNow\(\): number \{\s*return performance\.timeOrigin \+ performance\.now\(\);\s*\}/,
);

const recordMethod = source.slice(
    source.indexOf('    private recordMpeg2ToH264Lifecycle('),
    source.indexOf('    initMSE(', source.indexOf('    private recordMpeg2ToH264Lifecycle(')),
);
assert.ok(recordMethod.indexOf('try {') < recordMethod.indexOf('record.call('));
assert.ok(recordMethod.indexOf('record.call(') < recordMethod.indexOf('} catch {'));
assert.match(recordMethod, /criticalToken[\s\S]+owner/);

const finishMethod = source.slice(
    source.indexOf('    private finishDiagnosticQualitySwitch('),
    source.indexOf('    private cancelDiagnosticQualitySwitch('),
);
const finishRecord = finishMethod.indexOf('this.recordMpeg2ToH264Lifecycle(');
const finishResolve = finishMethod.indexOf('this.resolveMpeg2ToH264Lifecycle(');
const finishClear = finishMethod.indexOf('this.activeQualitySwitch = null');
assert.match(
    finishMethod,
    /const owner = this\.plugins\.mpeg2toh264 \?\? qualitySwitch\?\.criticalOwner;/,
);
assert.match(finishMethod, /qualitySwitchGeneration: qualitySwitch\.generation/);
assert.equal(finishMethod.includes('{ critical: true }'), false);
assert.ok(finishRecord >= 0);
assert.ok(finishRecord < finishResolve);
assert.ok(finishResolve < finishClear);
assert.match(
    finishMethod,
    /this\.resolveMpeg2ToH264Lifecycle\(\s*qualitySwitch\.criticalOwner,\s*qualitySwitch\.criticalToken,\s*\)/,
);
assert.match(
    finishMethod,
    /if \(this\.activeQualitySwitch === qualitySwitch\) \{\s*this\.activeQualitySwitch = null;/,
);

const initVideo = source.slice(
    source.indexOf('    initVideo('),
    source.indexOf('    initVideoEvents(', source.indexOf('    initVideo(')),
);
assert.ok(initVideo.indexOf('this.videoGeneration++') < initVideo.indexOf('this.initMSE('));

const videoEvents = source.slice(
    source.indexOf('    private initVideoEvents('),
    source.indexOf('    initVideo(', source.indexOf('    private initVideoEvents(')),
);
const switchFailure = videoEvents.slice(
    videoEvents.indexOf('            // quality switching failed'),
    videoEvents.indexOf('            if (this.tran && this.notice'),
);
const failureRecord = switchFailure.indexOf("'dplayer-quality-switch-error'");
assert.match(
    switchFailure,
    /const failedSwitch = this\.activeQualitySwitch;\s*const failureLifecycleOwner = this\.finishDiagnosticQualitySwitch\(\s*failedSwitch,\s*'dplayer-quality-switch-error'/,
);
assert.match(switchFailure, /qualitySwitchGeneration: failedSwitch\?\.generation \?\? 0/);
assert.equal(switchFailure.includes('{ critical: true }'), false);
assert.ok(failureRecord >= 0);
assert.match(
    switchFailure,
    /this\.recordMpeg2ToH264Lifecycle\(\s*failureLifecycleOwner,\s*'dplayer-previous-video-remove'/,
);
assert.ok(
    failureRecord < switchFailure.indexOf("this.events.trigger('quality_end')"),
);
assert.equal(switchFailure.includes('this.activeQualitySwitch = null'), false);

const switchQuality = source.slice(
    source.indexOf('    switchQuality('),
    source.indexOf('    notice(', source.indexOf('    switchQuality(')),
);
const switchStart = switchQuality.indexOf("'dplayer-quality-switch-start'");
assert.ok(switchStart >= 0);
assert.ok(switchStart < switchQuality.indexOf('this.qualityIndex = index'));
assert.ok(switchStart < switchQuality.indexOf('this.prevVideo = this.video'));
assert.match(
    switchQuality,
    /qualitySwitch\.criticalToken = switchStartRecord\.criticalToken;\s*qualitySwitch\.criticalOwner = switchStartRecord\.owner;/,
);
assert.ok(
    switchQuality.indexOf("'dplayer-previous-video-remove'") <
        switchQuality.indexOf('removeChild(this.prevVideo)'),
);
assert.ok(switchQuality.indexOf("'dplayer-quality-switch-end'") >= 0);
assert.match(
    switchQuality,
    /const completedSwitch = this\.activeQualitySwitch;\s*this\.finishDiagnosticQualitySwitch\(\s*completedSwitch,\s*'dplayer-quality-switch-end'/,
);
assert.ok(
    switchQuality.indexOf("'dplayer-quality-switch-end'") <
        switchQuality.indexOf("this.events.trigger('quality_end')"),
);
assert.equal(
    switchQuality
        .slice(switchQuality.indexOf("this.events.trigger('quality_end')"))
        .includes('this.activeQualitySwitch = null'),
    false,
);
assert.match(switchQuality, /this\.cancelDiagnosticQualitySwitch\('quality-switch-init-error'\)/);

const switchVideo = source.slice(
    source.indexOf('    switchVideo('),
    source.indexOf('    initDanmaku(', source.indexOf('    switchVideo(')),
);
assert.ok(
    switchVideo.indexOf("this.cancelDiagnosticQualitySwitch('switch-video')") <
        switchVideo.indexOf('this.initMSE('),
);

const initMse = source.slice(
    source.indexOf('    initMSE('),
    source.indexOf('    private initVideoEvents(', source.indexOf('    initMSE(')),
);
assert.match(
    initMse,
    /if \(!isActiveQualityReplacement\) \{\s*this\.cancelDiagnosticQualitySwitch\('media-backend-replacement'\);/,
);
assert.match(initMse, /this\.releaseMediaBackend\(\)/);

const backendRelease = source.slice(
    source.indexOf('    destroyMediaBackend('),
    source.indexOf('    static get version', source.indexOf('    destroyMediaBackend(')),
);
assert.match(
    backendRelease,
    /destroyMediaBackend\(\): void \{\s*this\.cancelDiagnosticQualitySwitch\('media-backend-abandon'\);\s*this\.releaseMediaBackend\(\);/,
);
assert.ok(
    backendRelease.indexOf("this.cancelDiagnosticQualitySwitch('player-destroy')") <
        backendRelease.indexOf('this.destroyMediaBackend()'),
);

const mpegBackend = source.slice(
    source.indexOf("                case 'mpeg2toh264':"),
    source.indexOf("                case 'flv':"),
);
assert.ok(
    mpegBackend.indexOf("'dplayer-backend-created'") <
        mpegBackend.indexOf('mpeg2toh264Player.load('),
);
assert.ok(
    mpegBackend.indexOf("'dplayer-backend-destroy'") <
        mpegBackend.indexOf('mpeg2toh264Player.destroy()'),
);
assert.match(
    mpegBackend,
    /qualitySwitch\.criticalToken = backendRecord\.criticalToken;\s*qualitySwitch\.criticalOwner = backendRecord\.owner;/,
);
assert.match(
    mpegBackend,
    /this\.notice\(`Error: \$\{event\.detail\.error\.message\}`,[^;]+;/,
);
assert.equal(source.includes('mpeg2toh264_error'), false);
