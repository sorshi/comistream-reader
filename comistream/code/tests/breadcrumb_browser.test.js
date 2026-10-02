const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');

test('パンくずのencoded HTMLと壊れたpercentを文字列として表示する', { skip: !chrome }, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../dir_list.php'), 'utf8');
  const start = source.indexOf("window.addEventListener('DOMContentLoaded', function() {", source.indexOf('// パンくずリストを設定'));
  const script = source.slice(start, source.indexOf('</script>', start));
  const segments = ['日本語', '<img src=x onerror=alert(1)>', "a'b", '100%'];
  const pathname = '/' + segments.map(encodeURIComponent).join('/') + '/bad%/';
  await runBrowserFixture(`
    const window = { location: { pathname: ${literal(pathname)} }, addEventListener: (_, fn) => fn() };
    ${script}
    const breadcrumb = document.getElementById('breadcrumb');
    expect(!breadcrumb.querySelector('img,[onerror]'), 'Path became active HTML');
    const anchors = [...breadcrumb.querySelectorAll('a')];
    expect(anchors.map(a => a.textContent).join('|') === ${literal(['TOP', ...segments, 'bad%'].join('|'))}, 'Labels changed');
    expect(anchors[2].getAttribute('href').includes('%3Cimg'), 'Encoded link changed');
  `, '<div id="breadcrumb"></div>');
});
