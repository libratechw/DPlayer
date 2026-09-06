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

const initVideo = source.slice(
    source.indexOf('    initVideo('),
    source.indexOf('    initVideoEvents(', source.indexOf('    initVideo(')),
);
assert.ok(initVideo.indexOf('this.videoGeneration++') < initVideo.indexOf('this.initMSE('));

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
    /const completedSwitch = this\.activeQualitySwitch;[\s\S]+qualitySwitchGeneration: completedSwitch\?\.generation/,
);
assert.ok(
    switchQuality.indexOf("'dplayer-quality-switch-end'") <
        switchQuality.indexOf('this.resolveMpeg2ToH264Lifecycle('),
);
assert.ok(
    switchQuality.indexOf('this.resolveMpeg2ToH264Lifecycle(') <
        switchQuality.indexOf("this.events.trigger('quality_end')"),
);
assert.match(
    switchQuality,
    /this\.resolveMpeg2ToH264Lifecycle\(\s*completedSwitch\.criticalOwner,\s*completedSwitch\.criticalToken,\s*\)/,
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
