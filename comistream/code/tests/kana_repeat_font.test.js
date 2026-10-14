const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const font = fs.readFileSync(require.resolve('../../theme/fonts/kana-repeat/ComistreamKanaRepeat-v2.ttf'));
const previousFont = fs.readFileSync(require.resolve('../../theme/fonts/kana-repeat/ComistreamKanaRepeat-v1.ttf'));

function tables(data) {
    const result = new Map();
    for (let index = 0; index < data.readUInt16BE(4); index++) {
        const entry = 12 + index * 16;
        const tag = data.toString('ascii', entry, entry + 4);
        const offset = data.readUInt32BE(entry + 8);
        result.set(tag, data.subarray(offset, offset + data.readUInt32BE(entry + 12)));
    }
    return result;
}

test('kana repeat font does not enlarge the em box used for WebKit ruby placement', () => {
    const data = tables(font);
    const units = data.get('head').readUInt16BE(18);
    const header = data.get('hhea');
    assert.equal(header.readInt16BE(4) - header.readInt16BE(6), units,
        'Primary fallback font metrics must fit one em, even for text outside its unicode-range');
    assert.equal(header.readInt16BE(8), 0, 'Supplement must not add line leading');
});

test('ruby spacing repair preserves the repeat glyphs and their two-em vertical advances', () => {
    const data = tables(font);
    const previous = tables(previousFont);
    // 輪郭・対応文字・縦横の字送りを変えず、行寸法だけを修正するルン。
    for (const tag of ['glyf', 'loca', 'cmap', 'hmtx', 'vhea', 'vmtx', 'OS/2']) {
        assert.deepEqual(data.get(tag), previous.get(tag), `${tag} changed`);
    }
    const units = data.get('head').readUInt16BE(18);
    const metrics = data.get('vmtx');
    assert.equal(metrics.readUInt16BE(4 * 4), units * 2);
    assert.equal(metrics.readUInt16BE(5 * 4), units * 2);
    let sum = 0;
    for (let offset = 0; offset < font.length; offset += 4) sum = (sum + font.readUInt32BE(offset)) >>> 0;
    assert.equal(sum, 0xb1b0afba, 'Invalid TrueType checksum');
});
