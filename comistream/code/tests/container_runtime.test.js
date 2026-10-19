const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chrome } = require('./browser_fixture');

const image = process.env.COMISTREAM_TEST_IMAGE;
const docker = (args, input) => execFileSync('docker', args, {
    input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000,
});

test('managed container separates fixed code, private state and public resources', {
    skip: !image, timeout: 180000,
}, async (t) => {
    const name = `comistream-runtime-test-${randomBytes(6).toString('hex')}`;
    const dataVolume = `${name}-data`;
    const mediaVolume = `${name}-media`;
    let container;
    let base;
    let cookie = '';
    const request = async (path, options = {}) => {
        const response = await fetch(base + path, {
            redirect: 'manual', ...options,
            headers: { Cookie: cookie, ...options.headers },
        });
        for (const value of response.headers.getSetCookie()) {
            if (value.startsWith('PHPSESSID=')) cookie = value.split(';')[0];
        }
        return response;
    };
    const php = (source) => docker(['exec', '-i', container, 'php'], `<?php\n${source}`);
    const start = async () => {
        container = docker(['run', '-d', '--name', name, '--label', 'comistream.test=runtime',
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777', '--shm-size=256m',
            '-p', '127.0.0.1::8080', '-v', `${dataVolume}:/home/user/comistream/data`,
            '-v', `${mediaVolume}:/home/user/public/nas:ro`, image]).trim();
        const port = docker(['port', container, '8080/tcp']).trim().split(':').pop();
        base = `http://127.0.0.1:${port}`;
        for (let attempt = 0; attempt < 60; attempt++) {
            try {
                const response = await request('/theme/manifest.json');
                if (response.status === 200) return;
            } catch (_) {}
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(`Container failed to start: ${docker(['logs', container])}`);
    };
    try {
        docker(['volume', 'create', '--label', 'comistream.test=runtime', dataVolume]);
        docker(['volume', 'create', '--label', 'comistream.test=runtime', mediaVolume]);
        // 実データを使わず、読み取り専用で渡すメディアを別コンテナで作るルン。
        docker(['run', '--rm', '-i', '--network=none', '--user=0', '--entrypoint=php',
            '-v', `${mediaVolume}:/fixture`, image], `<?php
mkdir('/fixture/日本語 + % # ? folder');
file_put_contents('/fixture/sample.mp3', '0123456789');
file_put_contents('/fixture/.htaccess', 'Require all denied');
foreach (['php', 'phtml', 'cgi', 'shtml'] as $extension) file_put_contents('/fixture/payload.' . $extension, '<?php echo "EXECUTED"; ?>');
symlink('/home/user/comistream/data/db/comistream.sqlite', '/fixture/private.txt');
mkdir('/tmp/book/META-INF', 0755, true);
file_put_contents('/tmp/book/mimetype', 'application/epub+zip');
file_put_contents('/tmp/book/META-INF/container.xml', '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file_put_contents('/tmp/book/content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
file_put_contents('/tmp/book/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body><p>EPUB fixture chapter.</p></body></html>');
chdir('/tmp/book');
passthru('7zz a -tzip /fixture/sample.epub . >/dev/null', $status);
chmod('/fixture/sample.epub', 0644);
exit($status);
`);
        await start();

        await t.test('first setup and configuration do not mutate fixed files', async () => {
            let response = await request('/');
            assert.equal(response.status, 302);
            response = await request('/cgi-bin/comistream.php');
            assert.equal(response.status, 200);
            assert.match(await response.text(), /initial_setup/);
            response = await request('/cgi-bin/comistream.php', {
                method: 'POST', body: new URLSearchParams({ action: 'initial_setup', username: 'fixture', password: 'fixture-password' }),
            });
            assert.equal(response.status, 302);
            response = await request('/cgi-bin/comistream.php?mode=config');
            const html = await response.text();
            const token = html.match(/name="config_csrf_token" value="([^"]+)"/);
            assert.ok(token, 'Setup did not create an administrator session.');
            response = await request('/cgi-bin/comistream.php?mode=config', {
                method: 'POST', body: new URLSearchParams({ config_csrf_token: token[1], siteName: '日本語 "quoted" & name', webRoot: '/tmp/forged-root' }),
            });
            assert.equal(response.status, 200);
            assert.match(await response.text(), /設定が更新されました/);
            const manifest = await (await request('/theme/manifest.json')).json();
            assert.equal(manifest.name, '日本語 "quoted" & name');
            assert.equal(manifest.short_name, manifest.name);
            assert.equal(manifest.scope, '/');
            assert.equal(php(`$db = new PDO('sqlite:/home/user/comistream/data/db/comistream.sqlite'); echo $db->query("SELECT value FROM system_config WHERE key='webRoot'")->fetchColumn();`), '/home/user/public');
            assert.equal(php(`echo json_decode(file_get_contents('/home/user/comistream/theme/manifest.json'), true)['name'];`), 'Comistream');
        });

        await t.test('read-only ownership and disabled overrides are enforced', async () => {
            assert.equal(docker(['exec', container, 'id', '-u']).trim(), '48');
            const paths = ['/home/user', '/home/user/public', '/home/user/comistream', '/home/user/comistream/code', '/home/user/comistream/theme', '/etc/httpd/conf'];
            // 読み取り専用マウントがなくても、所有者・modeで固定領域を保護するルン。
            docker(['run', '--rm', '--network=none', '--entrypoint=php', image, '-r',
                `foreach (${JSON.stringify(paths)} as $p) { if (is_writable($p) || fileowner($p) !== 0) exit(1); }`]);
            const result = JSON.parse(php(`$results = []; foreach (${JSON.stringify(paths)} as $p) $results[$p] = is_writable($p); echo json_encode($results);`));
            assert.ok(Object.values(result).every((value) => value === false));
            assert.equal(php(`echo @file_put_contents('/etc/httpd/conf/httpd.conf', 'modified') === false ? 'denied' : 'written';`), 'denied');
            assert.equal(php(`echo @unlink('/home/user/comistream/theme/manifest.json') ? 'deleted' : 'denied';`), 'denied');
            assert.equal(php(`echo @rename('/home/user/public', '/home/user/public-moved') ? 'renamed' : 'denied';`), 'denied');
            assert.equal(php(`echo @file_put_contents('/home/user/public/nas/new-file', 'modified') === false ? 'denied' : 'written';`), 'denied');
            let response = await request('/nas/sample.mp3', { headers: { Range: 'bytes=2-5' } });
            assert.equal(response.status, 206);
            assert.equal(await response.text(), '2345');
            for (const extension of ['php', 'phtml', 'cgi', 'shtml']) {
                response = await request(`/nas/payload.${extension}`);
                assert.equal(response.status, 403, `Unexpected script response: ${extension}`);
            }
            assert.equal((await request('/nas/private.txt')).status, 403);
            assert.equal((await request('/nas/.htaccess')).status, 403);
            assert.equal((await request('/cgi-bin/comistream_lib.php')).status, 404);
            response = await request('/nas/' + encodeURIComponent('日本語 + % # ? folder') + '/');
            assert.equal(response.status, 200);
            assert.match(await response.text(), /dir_list|Directory listing/);
            assert.equal((await request('/theme/style.css')).status, 200);
            response = await request('/theme/export.php');
            assert.equal(response.status, 403);
            assert.match(await response.text(), /読書履歴エクスポート/);
        });

        await t.test('generated assets preserve public URLs and hide internal state', async () => {
            php(`$root = '/home/user/comistream/data/theme';
file_put_contents($root . '/covers/test.jpg', 'image');
file_put_contents($root . '/covers/.htaccess', 'Require all denied');
file_put_contents($root . '/covers/payload.php', '<?php echo "EXECUTED";');
mkdir($root . '/hls/fixture');
file_put_contents($root . '/hls/fixture/index.m3u8', '#EXTM3U');
file_put_contents($root . '/hls/fixture/00001.ts', 'segment');
file_put_contents($root . '/hls/fixture/state.json', '{"private":true}');
symlink('/home/user/public/nas/sample.mp3', $root . '/hls/fixture/file');
symlink('/home/user/comistream/data/db/comistream.sqlite', $root . '/covers/escape.jpg');`);
            assert.equal(await (await request('/theme/covers/test.jpg')).text(), 'image');
            assert.equal((await request('/theme/covers/payload.php')).status, 403);
            assert.equal((await request('/theme/covers/escape.jpg')).status, 403);
            assert.equal((await request('/theme/covers/missing.jpg')).status, 404);
            assert.equal(await (await request('/theme/hls/fixture/index.m3u8')).text(), '#EXTM3U');
            for (const name of ['file', 'state.json']) assert.equal((await request('/theme/hls/fixture/' + name)).status, 403);
            const font = await request('/theme/fonts/kana-repeat/ComistreamKanaRepeat-v2.ttf');
            assert.equal(font.status, 200);
            assert.match(font.headers.get('cache-control'), /immutable/);
        });

        await t.test('EPUB opening works without a writable theme or public cache link', async () => {
            const missingId = 'f'.repeat(64);
            assert.equal((await request('/theme/bibi/' + missingId + '/chapter.xhtml')).status, 404);
            assert.equal(php(`echo file_exists('/home/user/comistream/data/runtime/book-cache/${missingId}.lock') ? 'created' : 'absent';`), 'absent');
            let response = await request('/cgi-bin/comistream.php?mode=open&file=sample.epub');
            const html = await response.text();
            if (response.status !== 200) console.error(docker(['logs', container]));
            assert.equal(response.status, 200, html.slice(0, 2000));
            const match = html.match(/\/theme\/bibi\/([a-f0-9]{32,128})\//);
            assert.ok(match, 'EPUB viewer did not include a package URL.');
            const url = '/theme/bibi/' + match[1] + '/';
            response = await request(url + 'chapter.xhtml');
            assert.equal(response.status, 200);
            assert.match(await response.text(), /EPUB fixture chapter/);
            const etag = response.headers.get('etag');
            assert.equal((await request(url + 'chapter.xhtml', { headers: { 'If-None-Match': etag } })).status, 304);
            response = await request(url + 'chapter.xhtml', { headers: { Range: 'bytes=0-4' } });
            assert.equal(response.status, 206);
            assert.equal(await response.text(), '<html');
            for (const path of ['DONE', '_comistream-reader-source.json', '.htaccess', 'file', 'payload.php']) {
                assert.equal((await request(url + path)).status, 404);
            }
            assert.equal(php(`echo file_exists('/home/user/public/theme/bibi') ? 'present' : 'absent';`), 'absent');
        });

        await t.test('recreation reuses data and preserves the site name', async () => {
            docker(['rm', '-f', container]);
            container = null;
            await start();
            const manifest = await (await request('/theme/manifest.json')).json();
            assert.equal(manifest.name, '日本語 "quoted" & name');
            const response = await request('/nas/');
            assert.equal(response.status, 200);
            assert.equal(php(`$db = new PDO('sqlite:/home/user/comistream/data/db/comistream.sqlite'); echo $db->query('SELECT COUNT(*) FROM users')->fetchColumn();`), '1');
        });

        await t.test('browser renders an EPUB through the protected resource handler', {
            skip: !chrome,
        }, async () => {
            const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-container-browser-'));
            try {
                const browser = spawnSync(chrome, ['--headless', '--disable-gpu', '--no-first-run',
                    '--no-default-browser-check', '--disable-background-networking', '--disable-extensions',
                    '--disable-sync', '--enable-logging=stderr',
                    '--user-data-dir=' + profile, '--virtual-time-budget=10000', '--dump-dom',
                    base + '/cgi-bin/comistream.php?mode=open&file=sample.epub'], {
                    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 45000,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
                const html = browser.stdout || '';
                assert.equal(browser.status, 0, browser.stderr);
                if (!/<foliate-view[\s>]/.test(html)) {
                    console.error(html.match(/id="epub-status"[^>]*>[^<]*/)?.[0], browser.stderr);
                    console.error(docker(['logs', '--tail', '25', container]));
                }
                assert.ok(/<foliate-view[\s>]/.test(html), 'EPUB view was not created.');
                assert.ok(/id="epub-loading-overlay"[^>]*aria-hidden="true"/.test(html), 'EPUB reader did not finish loading.');
                assert.ok(!/id="epub-status"[^>]*class="[^"]*epub-status-error/.test(html), 'EPUB reader reported a loading error.');
            } finally {
                fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
            }
        });
    } finally {
        if (container) docker(['rm', '-f', container]);
        docker(['volume', 'rm', dataVolume, mediaVolume]);
    }
});
