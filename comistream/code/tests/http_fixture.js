const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function withPhpFixture(router, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-http-'));
  let child;
  try {
    if (process.platform !== 'win32' && process.env.COMISTREAM_HTTP_TESTS !== '1') return await run(null);
    fs.writeFileSync(path.join(root, 'router.php'), router);
    const socket = net.createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    child = spawn(process.env.PHP_BIN || 'php', ['-S', `127.0.0.1:${port}`, path.join(root, 'router.php')], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('PHP fixture startup timed out')), 5000);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.stderr.on('data', (chunk) => { if (chunk.toString().includes('Development Server')) { clearTimeout(timeout); resolve(); } });
    });
    await run(`http://127.0.0.1:${port}`);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { withPhpFixture };
