import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * `collectHeadings` runs inside the page. This is the smallest document it can run
 * against: elements match a selector by tag name or by role, and visibility comes from
 * a `hidden` flag on the spec instead of a layout engine.
 */
function makeDocument(spec) {
  const all = [];
  const build = (node, parent) => {
    const attrs = node.attrs ?? {};
    const el = {
      tagName: node.tag.toUpperCase(),
      isConnected: true,
      parentElement: parent,
      _hidden: !!node.hidden,
      _text: node.text ?? '',
      _y: node.y ?? 0,
      getAttribute: (name) => (name in attrs ? attrs[name] : null),
      getBoundingClientRect: () => ({ x: 0, y: el._y, width: el._hidden ? 0 : 100, height: el._hidden ? 0 : 20 }),
    };
    Object.defineProperty(el, 'innerText', { get: () => el._text });
    Object.defineProperty(el, 'textContent', { get: () => el._text });
    all.push(el);
    for (const child of node.children ?? []) build(child, el);
    return el;
  };
  const body = build({ tag: 'body', children: spec }, null);

  const matchesOne = (el, selector) => {
    const role = /^\[role="([^"]+)"\]$/.exec(selector);
    return role ? el.getAttribute('role') === role[1] : el.tagName.toLowerCase() === selector;
  };
  return {
    document: {
      body,
      querySelectorAll: (selector) => {
        const wanted = selector.split(',').map((s) => s.trim());
        return all.filter((el) => el !== body && wanted.some((s) => matchesOne(el, s)));
      },
    },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
  };
}

async function loadCollectHeadings(env) {
  const src = await readFile(new URL('./extract-screen.js', import.meta.url), 'utf8');
  const factory = new Function('document', 'getComputedStyle', `${src}\nreturn collectHeadings;`);
  return factory(env.document, env.getComputedStyle);
}

test('h5 and h6 headings are found, and the content heading comes before the shell breadcrumb', async () => {
  // The shape every OrangeHRM screen has: a module breadcrumb in the topbar <header>,
  // then the page's own title further down as a styled h5/h6. An h1-h3 query found
  // neither, and every crawled screen had `headings: []`.
  const env = makeDocument([
    {
      tag: 'header', children: [
        { tag: 'h6', text: 'Admin', y: 10 },
        { tag: 'h6', text: 'User Management', y: 10 },
      ],
    },
    {
      tag: 'div', children: [
        { tag: 'h5', text: 'System Users', y: 120 },
        { tag: 'h6', text: ' Records\n  Found ', y: 300 },
      ],
    },
  ]);
  const headings = (await loadCollectHeadings(env))();

  assert.deepEqual(headings, [
    { level: 5, text: 'System Users', y: 120 },
    { level: 6, text: 'Records Found', y: 300 },
    { level: 6, text: 'Admin', y: 10 },
    { level: 6, text: 'User Management', y: 10 },
  ]);
});

test('role="heading" takes its level from aria-level, hidden and empty headings are dropped', async () => {
  const env = makeDocument([
    {
      tag: 'main', children: [
        { tag: 'div', attrs: { role: 'heading', 'aria-level': '1' }, text: 'Contacts', y: 40 },
        { tag: 'div', attrs: { role: 'heading' }, text: 'Filters', y: 80 },
        { tag: 'h2', text: 'Collapsed panel', hidden: true, y: 0 },
        { tag: 'h3', text: '   ', y: 90 },
      ],
    },
    { tag: 'nav', children: [{ tag: 'h2', text: 'Menu', y: 0 }] },
  ]);
  const headings = (await loadCollectHeadings(env))();

  assert.deepEqual(headings, [
    { level: 1, text: 'Contacts', y: 40 },
    { level: 2, text: 'Filters', y: 80 },
    { level: 2, text: 'Menu', y: 0 },
  ]);
});
