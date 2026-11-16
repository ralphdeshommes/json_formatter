// Browser tests for the JSON viewer. Run: npm install puppeteer-core && node --test tests/
// Set CHROME_PATH if Chrome is not in the default Windows location.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser, page;

before(async () => {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  page = await browser.newPage();
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.goto('file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'));
});

after(async () => {
  const cov = await page.coverage.stopJSCoverage();
  const entry = cov.find(c => c.url.endsWith('index.html'));
  let coveredBytes = 0;
  for (const r of entry.ranges) coveredBytes += r.end - r.start;
  const pct = coveredBytes / entry.text.length * 100;
  console.log(`# JS coverage: ${pct.toFixed(1)}% of the inline script`);
  await browser.close();
});

beforeEach(async () => { await page.evaluate(() => { clearAll(); setTreeView('tree'); }); });

// Pastes text and parses it. Returns whether an error showed and the visible stats.
const parse = (text) => page.evaluate((t) => {
  document.getElementById('input').value = t;
  parseJSON();
  return {
    error: document.getElementById('error').innerText,
    items: document.querySelectorAll('.tree-item').length,
    keys: document.getElementById('totalKeys').textContent,
  };
}, text);

// ---------- Auto-repair ----------
const repairable = [
  ['trailing comma in object', '{"a":1,"b":2,}'],
  ['trailing comma in array', '[1,2,3,]'],
  ['nested trailing commas', '{"a":[1,2,],"b":{"c":1,},}'],
  ['missing final brace', '{"a":1,"b":2'],
  ['missing final bracket', '[1,2,3'],
  ['array of objects cut off', '[{"a":1},{"b":2'],
  ['two missing braces', '{"a":{"b":{"c":1}'],
  ['three missing brackets', '[[[1,2]'],
  ['array inside object cut off', '{"a":[1,2'],
  ['trailing comma then cut off', '{"a":1,"b":2,'],
  ['trailing comma, array, cut off', '{"a":[1,2,],"b":3,'],
  ['mixed nesting cut off', '{"a":[{"b":1'],
  ['braces inside a string', '{"msg":"use { and [ here","a":1'],
  ['escaped quote inside a string', '{"a":"say \\"hi\\" {","b":1'],
  ['deep cut off with trailing comma', '{"a":{"b":[1,2,{"c":3},'],
  ['whitespace after trailing comma', '[1,2,3,\n  ]'],
];
for (const [name, text] of repairable) {
  test(`repairs: ${name}`, async () => {
    const r = await parse(text);
    assert.equal(r.error, '');
    assert.ok(r.items > 0);
  });
}

const valid = ['{}', '[]', '{"a":[1,2,{"b":null}]}', '"just a string"', '42', 'true', 'null'];
for (const text of valid) {
  test(`valid JSON is untouched: ${text}`, async () => {
    const r = await parse(text);
    assert.equal(r.error, '');
  });
}

const unsupported = [
  ['single quotes', "{'a':1}"], ['unquoted keys', '{a:1}'],
  ['comments', '{"a":1 // c\n}'], ['missing comma', '{"a":1 "b":2}'],
];
for (const [name, text] of unsupported) {
  test(`reports an error for ${name}`, async () => {
    const r = await parse(text);
    assert.match(r.error, /Parse Error/);
    assert.equal(r.items, 0);
  });
}

test('empty input asks for JSON', async () => {
  const r = await parse('   ');
  assert.match(r.error, /Please enter some JSON/);
});

test('repairJSON closes in nesting order', async () => {
  assert.equal(await page.evaluate(() => repairJSON('{"a":[{"b":1')), '{"a":[{"b":1}]}');
});

// ---------- Security ----------
for (const view of ['tree', 'table']) {
  test(`pasted HTML does not run in the ${view} view`, async () => {
    const ran = await page.evaluate((v) => {
      window.__x = 0;
      setTreeView(v);
      document.getElementById('input').value = JSON.stringify({
        '<img src=x onerror=window.__x=1>': '<img src=x onerror=window.__x=2>',
        k: ['<svg onload=window.__x=3>'],
      });
      parseJSON();
      return new Promise(res => setTimeout(() => res(window.__x), 200));
    }, view);
    assert.equal(ran, 0);
  });
}

test('HTML in a path does not run in the breadcrumb or details', async () => {
  const ran = await page.evaluate(() => {
    window.__x = 0;
    document.getElementById('input').value = JSON.stringify({ '<img src=x onerror=window.__x=1>': 5 });
    parseJSON();
    document.querySelector('.tree-value').click();
    return new Promise(res => setTimeout(() => res(window.__x), 200));
  });
  assert.equal(ran, 0);
});

test('HTML in the error preview does not run', async () => {
  const ran = await page.evaluate(() => {
    window.__x = 0;
    document.getElementById('input').value = '{<img src=x onerror=window.__x=1>';
    parseJSON();
    return new Promise(res => setTimeout(() => res(window.__x), 200));
  });
  assert.equal(ran, 0);
});

test('markup shows as literal text in the tree', async () => {
  await parse('{"a":"<b>bold</b>"}');
  const text = await page.evaluate(() => document.querySelector('.tree-string').textContent);
  assert.equal(text, '"<b>bold</b>"');
});

// ---------- Stats ----------
const statsCases = [
  ['empty object', {}, { totalKeys: 0, maxDepth: 0, objectCount: 1, arrayCount: 0 }],
  ['flat object', { a: 1, b: 2 }, { totalKeys: 2, maxDepth: 1, objectCount: 1, arrayCount: 0 }],
  ['nested object', { a: { b: { c: 1 } } }, { totalKeys: 3, maxDepth: 3, objectCount: 3, arrayCount: 0 }],
  ['array of objects', [{ a: 1 }, { a: 2 }], { totalKeys: 2, maxDepth: 2, objectCount: 2, arrayCount: 1 }],
  ['scalar', 5, { totalKeys: 0, maxDepth: 0, objectCount: 0, arrayCount: 0 }],
  ['null', null, { totalKeys: 0, maxDepth: 0, objectCount: 0, arrayCount: 0 }],
];
for (const [name, value, expected] of statsCases) {
  test(`stats: ${name}`, async () => {
    assert.deepEqual(await page.evaluate(v => analyzeJSON(v), value), expected);
  });
}

test('stats cards show the sample counts and appear after parsing', async () => {
  await page.evaluate(() => loadSample());
  await page.evaluate(() => parseJSON());
  const s = await page.evaluate(() => ({
    shown: document.getElementById('stats').style.display,
    keys: document.getElementById('totalKeys').textContent,
  }));
  assert.equal(s.shown, 'flex');
  assert.ok(Number(s.keys) > 20);
});

// ---------- Tree ----------
test('tree renders every key of a small document', async () => {
  const r = await parse('{"a":1,"b":{"c":[1,2]}}');
  assert.equal(r.keys, '3');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.tree-key').length), 5);
});

test('clicking a toggle collapses and expands a branch', async () => {
  await parse('{"a":{"b":1}}');
  const states = await page.evaluate(() => {
    const toggle = document.querySelectorAll('.tree-toggle')[1];
    const content = toggle.parentElement.querySelector('.tree-content');
    toggle.click(); const collapsed = content.style.display;
    toggle.click(); const expanded = content.style.display;
    return { collapsed, expanded };
  });
  assert.deepEqual(states, { collapsed: 'none', expanded: 'block' });
});

test('Collapse All then Expand All', async () => {
  await parse('{"a":{"b":{"c":1}}}');
  const r = await page.evaluate(() => {
    collapseAll();
    const hidden = [...document.querySelectorAll('.tree-content')].every(e => e.style.display === 'none');
    expandAll();
    const shown = [...document.querySelectorAll('.tree-content')].every(e => e.style.display === 'block');
    return { hidden, shown };
  });
  assert.deepEqual(r, { hidden: true, shown: true });
});

test('clicking a value shows its path, type, depth and size', async () => {
  await parse('{"user":{"name":"Ada","tags":["x","y"]}}');
  const r = await page.evaluate(() => {
    const vals = [...document.querySelectorAll('.tree-value')];
    vals.find(v => v.textContent === '"Ada"').click();
    return {
      path: document.getElementById('breadcrumb').innerText.replace(/\s/g, ''),
      details: document.getElementById('details').innerText.replace(/\s+/g, ' '),
    };
  });
  assert.equal(r.path, 'root.user.name');
  assert.match(r.details, /Type: string/);
  assert.match(r.details, /Depth: 2/);
  assert.match(r.details, /Size: 3 chars/);
});

test('clicking a key shows an array path with an index', async () => {
  await parse('{"tags":["x","y"]}');
  const path = await page.evaluate(() => {
    [...document.querySelectorAll('.tree-key')].find(k => k.textContent === '1').click();
    return document.getElementById('breadcrumb').innerText.replace(/\s/g, '');
  });
  assert.equal(path, 'root.tags[1]');
});

test('selecting an item marks it selected and clears the old one', async () => {
  await parse('{"a":1,"b":2}');
  const n = await page.evaluate(() => {
    const vals = document.querySelectorAll('.tree-value');
    vals[0].click(); vals[1].click();
    return document.querySelectorAll('.tree-item.selected').length;
  });
  assert.equal(n, 1);
});

test('keys with dots and spaces still produce a path', async () => {
  await parse('{"a.b":{"c d":1}}');
  const path = await page.evaluate(() => {
    document.querySelector('.tree-value').click();
    return document.getElementById('breadcrumb').innerText.replace(/\s/g, '');
  });
  assert.match(path, /^root\.a\.b\.cd$/);
});

// ---------- Large files render in chunks ----------
const bigArray = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i })));

test('a 1,000-item array renders only the first chunk', async () => {
  await parse(bigArray(1000));
  const r = await page.evaluate(() => ({
    rows: document.querySelectorAll('.tree-root > .tree-content > .tree-item').length,
    more: document.querySelector('.tree-more').textContent,
  }));
  assert.equal(r.rows, 200);
  assert.match(r.more, /show 200 more \(800 left\)/);
});

test('"show more" loads the next chunk and finally disappears', async () => {
  await parse(bigArray(450));
  const r = await page.evaluate(() => {
    const count = () => document.querySelectorAll('.tree-root > .tree-content > .tree-item').length;
    const out = [count()];
    document.querySelector('.tree-more').click(); out.push(count());
    document.querySelector('.tree-more').click(); out.push(count());
    out.push(document.querySelectorAll('.tree-more').length);
    return out;
  });
  assert.deepEqual(r, [200, 400, 450, 0]);
});

test('items loaded by "show more" are clickable with the right path', async () => {
  await parse(bigArray(300));
  const path = await page.evaluate(() => {
    document.querySelector('.tree-more').click();
    const keys = [...document.querySelectorAll('.tree-key')].filter(k => k.textContent === '250');
    keys[0].click();
    return document.getElementById('breadcrumb').innerText.replace(/\s/g, '');
  });
  assert.equal(path, 'root[250]');
});

test('a 5,000-record file (40,000 keys) parses and renders in under 500 ms', async () => {
  const text = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({
    id: i, name: 'user' + i, email: 'u' + i + '@x.com', active: i % 2 === 0,
    tags: ['a', 'b', 'c'], addr: { city: 'Miami', zip: '33101' },
  })));
  const ms = await page.evaluate((t) => {
    document.getElementById('input').value = t;
    const t0 = performance.now(); parseJSON(); return performance.now() - t0;
  }, text);
  assert.ok(ms < 500, `took ${ms} ms`);
});

test('stats cover the whole file, not just the rendered chunk', async () => {
  const r = await parse(bigArray(1000));
  assert.equal(r.keys, '1000');
});

// ---------- Table view ----------
test('table view shows one column per key and one row per record', async () => {
  await page.evaluate(() => setTreeView('table'));
  await page.evaluate(() => { document.getElementById('input').value = '[{"a":1,"b":2},{"a":3,"b":4}]'; parseJSON(); });
  const r = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('.data-table th')].map(t => t.textContent),
    rows: document.querySelectorAll('.data-table tbody tr').length,
  }));
  assert.deepEqual(r.heads, ['#', 'a', 'b']);
  assert.equal(r.rows, 2);
});

test('table view marks keys missing from a record', async () => {
  await page.evaluate(() => { setTreeView('table'); document.getElementById('input').value = '[{"a":1},{"b":2}]'; parseJSON(); });
  assert.equal(await page.evaluate(() => document.querySelectorAll('.missing-cell').length), 2);
});

test('table view handles arrays of plain values', async () => {
  await page.evaluate(() => { setTreeView('table'); document.getElementById('input').value = '[1,"two",null]'; parseJSON(); });
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll('.data-table th')].map(t => t.textContent)),
    ['#', 'Value'],
  );
});

test('table view of an object lists key and value rows', async () => {
  await page.evaluate(() => { setTreeView('table'); document.getElementById('input').value = '{"x":1,"y":[1,2]}'; parseJSON(); });
  const r = await page.evaluate(() => [...document.querySelectorAll('.key-cell')].map(t => t.textContent));
  assert.deepEqual(r, ['x', 'y']);
});

test('table view shows empty array and empty object messages', async () => {
  await page.evaluate(() => { setTreeView('table'); document.getElementById('input').value = '[]'; parseJSON(); });
  assert.match(await page.evaluate(() => document.getElementById('tree').innerText), /Empty array/);
  await page.evaluate(() => { document.getElementById('input').value = '{}'; parseJSON(); });
  assert.match(await page.evaluate(() => document.getElementById('tree').innerText), /Empty object/);
});

test('table view shows a lone scalar', async () => {
  await page.evaluate(() => { setTreeView('table'); document.getElementById('input').value = '42'; parseJSON(); });
  assert.equal(await page.evaluate(() => document.querySelector('.table-scalar').innerText), '42');
});

test('table view truncates long strings', async () => {
  await page.evaluate((s) => { setTreeView('table'); document.getElementById('input').value = JSON.stringify([{ s }]); parseJSON(); }, 'x'.repeat(100));
  const text = await page.evaluate(() => document.querySelector('.data-table td:nth-child(2)').innerText);
  assert.ok(text.length < 70);
});

test('clicking a table cell shows its path', async () => {
  await page.evaluate(() => { setTreeView('table'); document.getElementById('input').value = '[{"a":1},{"a":2}]'; parseJSON(); });
  const path = await page.evaluate(() => {
    document.querySelectorAll('.data-table tbody tr')[1].querySelectorAll('td')[1].click();
    return document.getElementById('breadcrumb').innerText.replace(/\s/g, '');
  });
  assert.equal(path, 'root[1].a');
});

test('switching views keeps the data and disables Expand All in table view', async () => {
  await parse('{"a":[{"b":1}]}');
  const r = await page.evaluate(() => {
    setTreeView('table');
    const disabled = document.getElementById('expandAllBtn').disabled;
    setTreeView('tree');
    return { disabled, back: document.querySelectorAll('.tree-item').length };
  });
  assert.equal(r.disabled, true);
  assert.ok(r.back > 0);
});

// ---------- Buttons ----------
test('Clear empties input, tree, stats and selection', async () => {
  await parse('{"a":1}');
  const r = await page.evaluate(() => {
    clearAll();
    return {
      input: document.getElementById('input').value,
      tree: document.getElementById('tree').innerHTML,
      stats: document.getElementById('stats').style.display,
    };
  });
  assert.deepEqual(r, { input: '', tree: '', stats: 'none' });
});

test('Load Sample fills the input with valid JSON', async () => {
  await page.evaluate(() => loadSample());
  const ok = await page.evaluate(() => { try { JSON.parse(document.getElementById('input').value); return true; } catch { return false; } });
  assert.equal(ok, true);
});

test('Copy Path with nothing selected shows a prompt instead of copying', async () => {
  await parse('{"a":1}');
  const msg = await page.evaluate(() => { let m = ''; window.alert = (t) => { m = t; }; copyPath(); return m; });
  assert.match(msg, /select an item first/i);
});

test('Copy Path copies the selected path', async () => {
  await parse('{"a":{"b":1}}');
  const copied = await page.evaluate(async () => {
    let written = '';
    window.alert = () => {};
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { written = t; return Promise.resolve(); } }, configurable: true });
    document.querySelector('.tree-value').click();
    copyPath();
    await new Promise(r => setTimeout(r, 50));
    return written.replace(/\s/g, '');
  });
  assert.equal(copied, 'root.a.b');
});

test('typing in the box parses after the debounce', async () => {
  await page.evaluate(() => { document.getElementById('input').value = '{"a":1}'; document.getElementById('input').dispatchEvent(new Event('input')); });
  await new Promise(r => setTimeout(r, 700));
  assert.equal(await page.evaluate(() => document.getElementById('totalKeys').textContent), '1');
});
