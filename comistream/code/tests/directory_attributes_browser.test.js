const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');

test('一覧の引用符付き属性はファイル名と404親パスを文字列として扱う', { skip: !chrome }, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../dir_list.php'), 'utf8');
  const start = source.indexOf('function escapeHtml(text)');
  const end = source.indexOf('\n            }', start) + '\n            }'.length;
  const escape = source.slice(start, end);
  const payload = 'x" onmouseover="alert(1)" <img src=x onerror=alert(2)> &\'日本語';
  await runBrowserFixture(`${escape}
    const name = ${literal(payload)};
    const parentPath = ${literal('/a" onmouseover="alert(1)" x="/child')};
    const row = '<a href="' + escapeHtml(parentPath) + '" id="' + escapeHtml(name) + '">' + escapeHtml(name) + '</a>';
    document.getElementById('container').innerHTML = row;
    const anchor = document.querySelector('#container a');
    expect(anchor.getAttribute('onmouseover') === null, 'Injected an event attribute');
    expect(document.querySelector('#container img,[onerror]') === null, 'Injected an active element');
    expect(anchor.id === name && anchor.textContent === name, 'Displayed filename changed');`, '<div id="container"></div>');
});
