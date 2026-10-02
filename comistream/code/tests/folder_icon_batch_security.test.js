const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('folder icon batch passes hostile directory names as data arguments', () => {
  const source = fs.readFileSync(path.join(__dirname, '../make_folder_image_run.sh'), 'utf8');
  const dispatch = source.split('\n').find((line) =>
    !line.trimStart().startsWith('#') && line.includes('xargs -0 -I{}') && line.includes('bash -c')
  );
  assert.ok(dispatch, 'Active xargs dispatcher was not found.');
  assert.match(dispatch, /bash -c 'make_folder_icon "\$1" 2>>"\$2"' _ '\{\}' "\$errorLog"/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-folder-icon-'));
  try {
    const script = [
      'make_folder_icon() { printf "%s\\n" "$1"; }',
      'export -f make_folder_icon',
      'multiProc=1',
      'errorLog=/dev/null',
      `printf '%s\\0' '$(touch command-ran).txt' | ${dispatch.trim()}`,
    ].join('\n');
    const output = execFileSync('bash', ['-c', script], { cwd: root, encoding: 'utf8' });
    assert.equal(output.trim(), '$(touch command-ran).txt');
    assert.equal(fs.existsSync(path.join(root, 'command-ran')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
