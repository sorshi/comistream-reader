const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');

test('履歴の表示名・旧HTMLから実行可能な要素やURLを移植しない', { skip: !chrome }, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../dir_list.js'), 'utf8');
  const helpers = source.slice(source.indexOf('function createHistoryAnchor('), source.indexOf('// 最後に開いたファイルの取得'));
  const name = '<img src=x onerror=alert(1)> "日本語"';
  const legacy = '<a href="/book" onclick="alert(1)">Book<img src=x onerror=alert(1)></a><a href="javascript:alert(1)">bad</a><script>alert(1)</script>';
  await runBrowserFixture(`${helpers}
    const historyElement = document.getElementById('history');
    renderHistoryEntry('/book?name=a%20b', ${literal(name)});
    expect(historyElement.textContent === ${literal(name)}, 'Literal name changed');
    expect(!historyElement.querySelector('img'), 'Name became HTML');
    renderHistoryResponse(${literal(legacy)});
    expect(historyElement.querySelectorAll('a').length === 1, 'Unsafe URL retained');
    expect(!historyElement.querySelector('img,script,[onclick],[onerror]'), 'Active markup retained');
    expect(historyElement.textContent === 'Book', 'Normal label lost');`, '<div id="history"></div>');
});
