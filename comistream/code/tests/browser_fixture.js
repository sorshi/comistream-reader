const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((candidate) => candidate && fs.existsSync(candidate));
const literal = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

async function runBrowserFixture(script, body = '') {
  if (!chrome) throw new Error('A Chrome/Chromium binary is required.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-browser-'));
  try {
    const fixture = path.join(root, 'fixture.html');
    fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8">${body}<pre id="result"></pre><script>
      window.pwned = 0; window.alert = () => window.pwned++;
      function expect(value, message) { if (!value) throw new Error(message); }
      try { (function(location) { ${script} })({ href: 'https://reader.invalid/library/', origin: 'https://reader.invalid' });
        setTimeout(() => { document.getElementById('result').dataset.result = window.pwned || window.testFailed || window.testDone === false ? 'failed' : 'passed'; }, 300);
      } catch (error) { document.getElementById('result').textContent = error.stack; document.getElementById('result').dataset.result = 'failed'; }
      </script>`);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-sync', '--user-data-dir=' + path.join(root, 'profile'), '--virtual-time-budget=1000', '--dump-dom', pathToFileURL(fixture).href], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let errors = '';
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch (_) {}
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        error ? reject(error) : resolve(output);
      };
      const timer = setTimeout(() => finish(new Error('Chrome fixture timed out: ' + errors)), 20000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('</html>')) finish();
      });
      child.stderr.on('data', (chunk) => { errors += chunk; });
      child.on('error', finish);
      child.on('close', () => finish(output.includes('</html>') ? null : new Error('Chrome fixture failed: ' + errors)));
    });
    if (!output.includes('data-result="passed"')) throw new Error(output);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

module.exports = { chrome: process.env.COMISTREAM_BROWSER_TESTS === '1' && chrome, literal, runBrowserFixture };
