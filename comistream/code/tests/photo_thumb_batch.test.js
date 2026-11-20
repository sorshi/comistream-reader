const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const available = ['magick', 'sqlite3', 'flock'].every(command => spawnSync('bash', ['-c', 'command -v "$1"', '_', command]).status === 0);
const source = path.resolve(__dirname, '..');

test('写真バッチの差分更新・ロック・シンボリックリンク境界', { skip: !available }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-photo-batch-'));
  const tool = path.join(root, 'tool');
  const share = path.join(root, 'share');
  const album = 'Family Photos';
  const dir = path.join(share, album);
  const thumbRoot = path.join(tool, 'data/theme/thumbs');
  const output = path.join(thumbRoot, album);
  const database = path.join(tool, 'data/db/comistream.sqlite');
  const script = path.join(tool, 'code/make_photo_thumb_run.sh');
  const initialMtime = 1731990000;
  const run = (...args) => execFileSync('bash', [script, ...args]);

  try {
    for (const directory of [dir, path.dirname(database), path.join(tool, 'code/lib')]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    for (const file of ['make_photo_thumb_run.sh', 'lib/lib_photo.php', 'lib/lib_hls_paths.php']) {
      fs.copyFileSync(path.join(source, file), path.join(tool, 'code', file));
    }
    execFileSync('sqlite3', [database, `
      CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO system_config VALUES ('sharePath', '${share}'), ('comistream_tool_dir', '${tool}');
    `]);

    const files = ['same.JPG', 'same.tif', 'photo [50%]+.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg'];
    const jpg = path.join(dir, files[0]);
    execFileSync('magick', ['-size', '640x384', 'xc:red', jpg]);
    for (const file of files.slice(2)) fs.copyFileSync(jpg, path.join(dir, file));
    execFileSync('magick', ['-size', '140x80', 'xc:blue', path.join(dir, 'same.tif')]);
    const formats = execFileSync('magick', ['-list', 'format'], { encoding: 'utf8' });
    if (/^\s*HEIC\*?\s+HEIC\s+r/m.test(formats)) {
      files.splice(2, 0, 'same.HEIC');
      fs.copyFileSync(path.join(__dirname, 'fixtures/photo-probe.heic'), path.join(dir, 'same.HEIC'));
    }
    for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(dir, i + '.MOV'), '');
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(dir, i + '.txt'), '');
    for (const file of fs.readdirSync(dir)) {
      fs.chmodSync(path.join(dir, file), 0o444);
      fs.utimesSync(path.join(dir, file), initialMtime, initialMtime);
    }
    fs.chmodSync(dir, 0o555);

    run();
    assert.equal(fs.existsSync(thumbRoot), false);
    execFileSync('sqlite3', [database, `INSERT INTO system_config VALUES ('photo_subDir', '"${album}"');`]);

    fs.mkdirSync(path.join(tool, 'data/runtime'), { recursive: true });
    const lockPath = path.join(tool, 'data/runtime/photo-thumbs.lock');
    execFileSync('bash', ['-c', 'exec 9>>"$1"; flock -n -E 75 9 && bash "$2"', '_', lockPath, script]);
    assert.equal(fs.existsSync(output), false);
    run();
    assert.deepEqual(fs.readdirSync(output).sort(), files.map(file => file + '.' + initialMtime + '.256.webp').sort());
    const thumbPath = name => path.join(output, name + '.' + initialMtime + '.256.webp');
    const identify = name => execFileSync('magick', ['identify', '-format', '%wx%h', thumbPath(name)], { encoding: 'utf8' });
    assert.equal(identify(files[0]), '256x256');
    assert.equal(identify(files[1]), '80x80');
    if (files.includes('same.HEIC')) assert.equal(identify('same.HEIC'), '8x8');
    const first = fs.statSync(thumbPath(files[0]));
    run();
    assert.equal(fs.statSync(thumbPath(files[0])).ino, first.ino);

    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const marker = path.join(outside, 'keep.jpg.1.256.webp');
    fs.writeFileSync(marker, 'keep');
    fs.symlinkSync(outside, path.join(thumbRoot, 'linked-cache'));
    fs.symlinkSync(outside, path.join(share, 'linked-source'));
    const orphan = path.join(thumbRoot, 'removed-directory', 'nested');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'removed.jpg.1.256.webp'), '');

    fs.chmodSync(dir, 0o755);
    fs.utimesSync(jpg, initialMtime + 1, initialMtime + 1);
    fs.unlinkSync(path.join(dir, files.at(-1)));
    fs.unlinkSync(path.join(dir, '0.txt'));
    fs.unlinkSync(path.join(dir, '1.txt'));
    run(album);
    assert.equal(fs.existsSync(thumbPath(files[0])), false);
    assert.equal(fs.existsSync(path.join(output, files[0] + '.' + (initialMtime + 1) + '.256.webp')), true);
    assert.equal(fs.existsSync(thumbPath(files.at(-1))), false);
    run();
    assert.equal(fs.existsSync(path.dirname(orphan)), false);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
    assert.notEqual(spawnSync('bash', [script, '../outside']).status, 0);
    assert.notEqual(spawnSync('bash', [script, 'linked-source']).status, 0);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
  } finally {
    if (fs.existsSync(dir)) fs.chmodSync(dir, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
