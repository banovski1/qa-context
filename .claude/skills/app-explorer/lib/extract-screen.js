// In-page fragment. Runs in the page, returns the whole screen as one object so
// nothing about the inventory depends on how much of a snapshot fitted in an
// agent's context.

// Native elements and ARIA roles are the controls an app *declares*. A design system
// that builds its dropdowns and toggles out of divs declares nothing, and the crawl
// used to see none of them: OrangeHRM's entire select vocabulary was invisible here
// while the map extractor, which carries these class shapes, listed every one. The
// class patterns are conventions, not app names — `select-text`, `dropdown-toggle` and
// `switch` are what component libraries call these things across ecosystems.
var INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', '[role="combobox"]', '[role="switch"]',
  '[role="option"]', '[role="searchbox"]', '[role="textbox"]',
  '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
  '[class*="select-text" i]', '[class*="dropdown-toggle" i]',
  '[class*="switch-input" i]', '[class*="checkbox-input" i]',
].join(',');

// A composite control is a cluster of divs: the outermost one is the thing a user
// clicks, the inner ones are its parts. Keeping both would inventory one control
// several times, so an element that contains another match is kept and the parts are
// dropped — unless the inner one is a native control, which always wins because it is
// the element that actually takes the input.
function outermostOnly(nodes) {
  var natives = { INPUT: 1, SELECT: 1, TEXTAREA: 1, BUTTON: 1, A: 1 };
  return nodes.filter(function (el) {
    if (natives[el.tagName]) return true;
    for (var i = 0; i < nodes.length; i++) {
      var other = nodes[i];
      if (other !== el && !natives[other.tagName] && other.contains(el)) return false;
    }
    return true;
  });
}

var DESTRUCTIVE = /\b(save|delete|remove|submit|send|apply|confirm|deactivate|merge|convert|import|export|reset password)\b/i;

// An id minted per render (`contact-edit-3598`, a hash, a bare counter) is worse
// than no id at all: it looks stable in one crawl and differs in the next. It is
// rejected wherever a locator could anchor to it.
function looksGenerated(value) {
  return !value
    || /\d{3,}/.test(value)
    || /[0-9a-f]{12,}/i.test(value)
    || /^[a-z]?\d+$/i.test(value);
}

function esc(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}

function isVisible(el) {
  if (!el.isConnected) return false;
  var style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
  var box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

function textOf(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

// A pragmatic subset of the ARIA role mapping: enough to name what a test would
// address, without pulling a full accessibility implementation into the page.
function roleOf(el) {
  var explicit = el.getAttribute('role');
  if (explicit) return explicit.trim().split(/\s+/)[0];
  var tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'button') return 'button';
  if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'search') return 'searchbox';
    if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
    if (type === 'range') return 'slider';
    if (type === 'number') return 'spinbutton';
    if (type === 'hidden') return null;
    return 'textbox';
  }
  // A div that a component library built into a control. Its role has to be inferred
  // from the convention it was built to, because the app declared none — and without a
  // role the control has no component class and drops out of the model entirely.
  var cls = (el.getAttribute('class') || '').toLowerCase();
  if (/select-text|dropdown-toggle/.test(cls)) return 'combobox';
  if (/switch-input/.test(cls)) return 'switch';
  if (/checkbox-input/.test(cls)) return 'checkbox';
  return null;
}

function labelTextFor(el) {
  var byAttr = el.getAttribute('aria-labelledby');
  if (byAttr) {
    var parts = byAttr.split(/\s+/).map(function (id) {
      var node = document.getElementById(id);
      return node ? textOf(node) : '';
    }).filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  if (el.id) {
    var explicit = document.querySelector('label[for="' + esc(el.id) + '"]');
    if (explicit) return textOf(explicit);
  }
  var wrapping = el.closest('label');
  if (wrapping) return textOf(wrapping);
  return '';
}

var LABEL_SELECTOR = 'label,[class*="label" i],dt,legend';

/**
 * The label a person reads, for an app that never wrote `for=`.
 *
 * Walk out from the control until a label appears in the same wrapper. The guard is
 * what makes this safe rather than a guess: stop as soon as the wrapper also covers a
 * *different* control, because then the label it holds belongs to that one and not to
 * this. Without the guard the walk reaches a form and calls every field by the form's
 * legend; with it, an unlabelled control stays unlabelled and is reported as such.
 */
function proximityLabel(el) {
  var node = el.parentElement;
  for (var up = 0; up < 4 && node; up++, node = node.parentElement) {
    var siblings = Array.prototype.slice.call(node.querySelectorAll(INTERACTIVE_SELECTOR))
      .filter(function (other) {
        return other !== el && !other.contains(el) && !el.contains(other);
      });
    if (siblings.length) return '';
    var label = node.querySelector(LABEL_SELECTOR);
    if (label && !label.contains(el)) {
      var text = textOf(label);
      if (text) return text;
    }
  }
  return '';
}

/**
 * The name, and where it came from.
 *
 * The source matters downstream: a name the browser computes is one a test can ask for
 * by role, and a name inferred from a nearby label is not. Emitting the second as
 * though it were the first produces a page object whose getters all fail with
 * NOT_FOUND — the app never associated the two, so nothing but this walk connects them.
 */
function namedBy(el) {
  var aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return { name: aria.trim(), source: 'accessible' };
  var byAttr = el.getAttribute('aria-labelledby');
  if (byAttr) {
    var linked = labelTextFor(el);
    if (linked) return { name: linked, source: 'accessible' };
  }
  if (el.id) {
    var explicit = document.querySelector('label[for="' + esc(el.id) + '"]');
    if (explicit) {
      var t = textOf(explicit);
      if (t) return { name: t, source: 'accessible' };
    }
  }
  var wrapping = el.closest('label');
  if (wrapping) {
    var w = textOf(wrapping);
    if (w) return { name: w, source: 'accessible' };
  }
  // For a control that *takes* input, the label rendered beside it beats its own
  // contents and its placeholder. Both of those are the accessible name by spec, and
  // both are useless as handles: a date field's name is "yyyy-mm-dd" and a custom
  // select's is "-- Select --", so a screen with three of each has three controls with
  // one name. The label next to them is what a person calls them and what tells them
  // apart. For a button or a link the opposite holds — their content *is* their name,
  // and a nearby label belongs to something else.
  if (TAKES_INPUT.test(roleOf(el) || '') || /^(input|select|textarea)$/.test(el.tagName.toLowerCase())) {
    var near = proximityLabel(el);
    if (near) return { name: near, source: 'proximity' };
  }
  var own = textOf(el);
  if (own) return { name: own, source: 'accessible' };
  var placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return { name: placeholder.trim(), source: 'accessible' };
  var title = el.getAttribute('title');
  if (title && title.trim()) return { name: title.trim(), source: 'accessible' };
  var alt = el.querySelector && el.querySelector('img[alt]');
  if (alt) return { name: alt.getAttribute('alt').trim(), source: 'accessible' };
  return { name: '', source: null };
}

var TAKES_INPUT = /^(textbox|searchbox|combobox|listbox|checkbox|radio|switch|spinbutton|slider)$/;

function accessibleName(el) {
  return namedBy(el).name;
}

function dataAttributes(el) {
  var out = {};
  for (var i = 0; i < el.attributes.length; i++) {
    var attr = el.attributes[i];
    if (attr.name.indexOf('data-') === 0) out[attr.name] = attr.value;
  }
  return out;
}

function testIdOf(el, testIdAttribute) {
  var raw = el.getAttribute(testIdAttribute);
  return raw && raw.trim() ? raw.trim() : null;
}

// A path scoped to the nearest stable ancestor, so it survives sibling churn
// better than a root-anchored chain of :nth-child.
function cssPath(el) {
  var parts = [];
  var node = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    var tag = node.tagName.toLowerCase();
    if (node.id && !looksGenerated(node.id) && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
      parts.unshift('#' + CSS.escape(node.id));
      break;
    }
    var selector = tag;
    var classes = (node.getAttribute('class') || '').trim().split(/\s+/)
      .filter(function (c) { return c && !/\d/.test(c); }).slice(0, 2);
    if (classes.length) selector += '.' + classes.map(function (c) { return CSS.escape(c); }).join('.');
    var parent = node.parentElement;
    if (parent) {
      var sameKind = Array.prototype.filter.call(parent.children, function (sib) {
        return sib.tagName === node.tagName;
      });
      if (sameKind.length > 1) selector += ':nth-of-type(' + (sameKind.indexOf(node) + 1) + ')';
    }
    parts.unshift(selector);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

// The region an element sits in, taken from the nearest landmark or semantic
// container. This is what turns a flat element list into a component analysis.
function regionOf(el) {
  var node = el;
  while (node && node !== document.body) {
    var role = node.getAttribute && node.getAttribute('role');
    var tag = node.tagName.toLowerCase();
    if (role === 'dialog' || role === 'alertdialog' || tag === 'dialog') return 'dialog';
    if (role === 'navigation' || tag === 'nav') return 'navigation';
    if (role === 'banner' || tag === 'header') return 'header';
    if (role === 'contentinfo' || tag === 'footer') return 'footer';
    if (tag === 'form' || role === 'form') return 'form';
    if (tag === 'table' || role === 'table' || role === 'grid') return 'table';
    if (role === 'search') return 'search';
    if (role === 'toolbar') return 'toolbar';
    if (role === 'main' || tag === 'main') return 'main';
    node = node.parentElement;
  }
  return 'body';
}

// Every heading the user can see, the screen's own first. All six levels and
// role="heading", because a design system styles its page title as whatever level
// suits the type scale — OrangeHRM's are h5 and h6, and an h1-h3 query recorded no
// heading on any of its screens. A heading in the shell (header, navigation, footer)
// or a dialog is kept but sorted after the content's: the compiler reads the first
// one as the screen's identity, and a module breadcrumb shared by every screen in the
// module identifies none of them.
var HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
var SHELL_REGIONS = { header: 1, navigation: 1, footer: 1, dialog: 1 };

function collectHeadings() {
  var found = Array.prototype.slice.call(document.querySelectorAll(HEADING_SELECTOR))
    .filter(isVisible)
    .map(function (h, order) {
      // innerText, not textContent: a breadcrumb heading built from two spans yields
      // "Contactscreate" under textContent, which is a heading no assertion can use.
      var text = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
      var tag = /^H([1-6])$/.exec(h.tagName);
      // aria-level wins over the tag, as it does in the accessibility tree; a bare
      // role="heading" defaults to level 2 there.
      var level = Number(h.getAttribute('aria-level')) || (tag ? Number(tag[1]) : 2);
      return {
        level: level,
        text: text.slice(0, 120),
        // The y coordinate is what lets the compiler say which section a repeated
        // label sits in — the disambiguator a person uses, and the only evidence of it here.
        y: Math.round(h.getBoundingClientRect().y),
        shell: !!SHELL_REGIONS[regionOf(h)],
        order: order,
      };
    })
    .filter(function (h) { return h.text; });
  found.sort(function (a, b) { return (a.shell - b.shell) || (a.order - b.order); });
  return found.map(function (h) { return { level: h.level, text: h.text, y: h.y }; });
}

// Attributes an application uses to name a region or a field on purpose. An
// ancestor carrying one is a far better anchor than the markup path to it.
var ANCHOR_ATTRIBUTES = ['data-name', 'data-field', 'data-view', 'data-panel', 'data-role', 'data-id'];

function anchorSelectorFor(el) {
  var node = el.parentElement;
  var hops = 0;
  while (node && node !== document.body && hops < 5) {
    for (var i = 0; i < ANCHOR_ATTRIBUTES.length; i++) {
      var attr = ANCHOR_ATTRIBUTES[i];
      var value = node.getAttribute(attr);
      if (value && value.trim() && !looksGenerated(value)) {
        return '[' + attr + '="' + esc(value.trim()) + '"]';
      }
    }
    node = node.parentElement;
    hops++;
  }
  return null;
}

function countRoleName(role, name, index) {
  var key = role + '\u0000' + name;
  return index[key] || 0;
}

function buildCandidates(el, meta, index, testIdAttribute) {
  var out = [];
  function push(strategy, expression, matchCount, args) {
    out.push({ strategy: strategy, expression: expression, matchCount: matchCount, args: args });
  }
  if (meta.testId) {
    push('testId',
      "getByTestId('" + esc(meta.testId) + "')",
      document.querySelectorAll('[' + testIdAttribute + '="' + esc(meta.testId) + '"]').length,
      [meta.testId]);
  }
  if (meta.role && meta.name) {
    // A name the browser did not compute cannot be asked for by role: `getByRole` reads
    // the accessibility tree, and a label sitting next to an input is not in it. It is
    // still a real handle — the one a person reads — so it is recorded as its own
    // strategy rather than being dressed up as an accessible name.
    if (meta.nameSource === 'proximity') {
      push('proximity',
        "label('" + esc(meta.name) + "') >> " + meta.tag,
        index.proximity[meta.name] || 0,
        [meta.name, meta.tag]);
    } else {
      push('role',
        "getByRole('" + meta.role + "', { name: '" + esc(meta.name) + "', exact: true })",
        countRoleName(meta.role, meta.name, index.roleName),
        [meta.role, meta.name]);
    }
  }
  if (meta.label) {
    push('label',
      "getByLabel('" + esc(meta.label) + "', { exact: true })",
      index.label[meta.label] || 0,
      [meta.label]);
  }
  if (meta.placeholder) {
    push('placeholder',
      "getByPlaceholder('" + esc(meta.placeholder) + "', { exact: true })",
      document.querySelectorAll('[placeholder="' + esc(meta.placeholder) + '"]').length,
      [meta.placeholder]);
  }
  // An element's own naming attribute beats an ancestor's, so try it first.
  var ownAnchor = null;
  for (var a = 0; a < ANCHOR_ATTRIBUTES.length; a++) {
    var ownValue = el.getAttribute(ANCHOR_ATTRIBUTES[a]);
    if (ownValue && ownValue.trim()) {
      ownAnchor = '[' + ANCHOR_ATTRIBUTES[a] + '="' + esc(ownValue.trim()) + '"]';
      break;
    }
  }
  var scopedSelectors = [];
  if (ownAnchor) scopedSelectors.push(meta.tag + ownAnchor);
  var anchor = anchorSelectorFor(el);
  if (anchor) {
    scopedSelectors.push(anchor + ' ' + meta.tag + (meta.type && meta.tag === 'input' ? '[type="' + esc(meta.type) + '"]' : ''));
    scopedSelectors.push(anchor + ' ' + meta.tag);
  }
  for (var s = 0; s < scopedSelectors.length; s++) {
    var selector = scopedSelectors[s];
    var count = 0;
    try { count = document.querySelectorAll(selector).length; } catch (e) { continue; }
    if (count) push('scoped', "locator('" + esc(selector) + "')", count, [selector]);
  }
  if (meta.id && !looksGenerated(meta.id)) {
    push('attribute', "locator('#" + esc(meta.id) + "')",
      document.querySelectorAll('#' + CSS.escape(meta.id)).length, ['#' + meta.id]);
  }
  if (meta.nameAttr) {
    var sel = meta.tag + '[name="' + esc(meta.nameAttr) + '"]';
    push('attribute', "locator('" + esc(sel) + "')", document.querySelectorAll(sel).length, [sel]);
  }
  if (meta.text && meta.text.length <= 60) {
    push('text', "getByText('" + esc(meta.text) + "', { exact: true })",
      index.text[meta.text] || 0, [meta.text]);
  }
  var path = cssPath(el);
  if (path) {
    var pathMatches = 0;
    try { pathMatches = document.querySelectorAll(path).length; } catch (e) { pathMatches = 0; }
    push('css', "locator('" + esc(path) + "')", pathMatches, [path]);
  }
  return out;
}

/**
 * Every collection on the screen, however it is built.
 *
 * `document.querySelectorAll('table')` finds the ones written as a `<table>` and nothing
 * else. A modern list is a grid of divs with `role="table"` if you are lucky and with a
 * class if you are not — OrangeHRM's 52 tables were all invisible here for that reason.
 * A header row is still required: a table with no header is the app placing things, not
 * listing records, and has no column to address a row by.
 */
function collectTables() {
  var out = [];
  var seen = [];
  var roots = Array.prototype.slice.call(
    document.querySelectorAll('table,[role="table"],[role="grid"],[role="treegrid"]'),
  );
  for (var i = 0; i < roots.length; i++) {
    var t = roots[i];
    var headerCells = Array.prototype.slice.call(t.querySelectorAll('th,[role="columnheader"]'))
      .map(textOf).filter(Boolean);
    if (!headerCells.length) continue;
    var bodyRows = t.querySelectorAll('tbody tr').length ||
      t.querySelectorAll('[role="row"]').length ||
      Math.max(0, t.querySelectorAll('tr').length - 1);
    out.push({ columns: headerCells, rowCount: bodyRows });
    seen.push(t);
  }
  if (out.length) return out;

  // Nothing declared itself a table. Fall back to the shape a div grid takes: a row of
  // header cells, and repeated sibling rows under a shared container.
  var headers = Array.prototype.slice.call(
    document.querySelectorAll('[class*="table-header" i],[class*="grid-header" i],[class*="list-header" i]'),
  );
  for (var h = 0; h < headers.length && out.length < 4; h++) {
    var header = headers[h];
    if (!isVisible(header)) continue;
    var cells = Array.prototype.slice.call(
      header.querySelectorAll('[class*="cell" i],[class*="col" i],[role="columnheader"]'),
    ).map(textOf).filter(Boolean);
    if (cells.length < 2) {
      cells = Array.prototype.slice.call(header.children).map(textOf).filter(Boolean);
    }
    if (cells.length < 2) continue;
    var container = header.closest('[class*="table" i],[class*="grid" i],[class*="list" i]') || header.parentElement;
    var rows = container
      ? container.querySelectorAll('[role="row"],[class*="table-row" i],[class*="table-card" i],[class*="list-row" i]')
      : [];
    out.push({ columns: cells, rowCount: rows.length });
  }
  return out;
}

function __extractScreen(options) {
  var opts = options || {};
  var testIdAttribute = opts.testIdAttribute || 'data-testid';
  var elements = outermostOnly(
    Array.prototype.slice.call(document.querySelectorAll(INTERACTIVE_SELECTOR)),
  );

  var metas = elements.map(function (el) {
    var role = roleOf(el);
    var named = namedBy(el);
    var name = named.name;
    return {
      el: el,
      nameSource: named.source,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      role: role,
      name: name,
      text: textOf(el),
      label: labelTextFor(el),
      placeholder: el.getAttribute('placeholder') || '',
      id: el.getAttribute('id') || '',
      nameAttr: el.getAttribute('name') || '',
      testId: testIdOf(el, testIdAttribute),
      data: dataAttributes(el),
      region: regionOf(el),
      visible: isVisible(el),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      href: el.getAttribute('href') || null,
      box: (function () {
        var b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      })(),
    };
  });

  // Match counts are computed against the live document, which is the whole
  // point of running here rather than over source: uniqueness is proved.
  var index = { roleName: {}, label: {}, text: {}, proximity: {} };
  metas.forEach(function (m) {
    if (m.role && m.name && m.nameSource === 'proximity') {
      index.proximity[m.name] = (index.proximity[m.name] || 0) + 1;
    } else if (m.role && m.name) {
      var key = m.role + '\u0000' + m.name;
      index.roleName[key] = (index.roleName[key] || 0) + 1;
    }
    if (m.label) index.label[m.label] = (index.label[m.label] || 0) + 1;
    if (m.text) index.text[m.text] = (index.text[m.text] || 0) + 1;
  });

  var out = metas.map(function (m, i) {
    var candidates = buildCandidates(m.el, m, index, testIdAttribute);
    var decision = chooseLocator(candidates);
    return {
      index: i,
      tag: m.tag,
      type: m.type,
      role: m.role,
      name: m.name,
      nameSource: m.nameSource,
      label: m.label || null,
      placeholder: m.placeholder || null,
      id: m.id || null,
      nameAttr: m.nameAttr || null,
      testId: m.testId,
      data: m.data,
      region: m.region,
      visible: m.visible,
      disabled: m.disabled,
      destructive: DESTRUCTIVE.test(m.name || ''),
      href: m.href,
      box: m.box,
      locator: decision.chosen,
      unique: decision.unique,
      fragile: !!decision.fragile,
      ambiguityReason: decision.reason || null,
      // The chosen locator plus its three best alternatives. Keeping every
      // candidate for every element multiplied the inventory's size several times
      // over to record expressions nothing would ever choose.
      // Alternatives are kept for visible controls only — those are the ones a
      // human will re-pick a locator for. A hidden control keeps its chosen
      // locator and nothing else.
      candidates: m.visible
        ? candidates
          .slice()
          .sort(function (a, b) { return rankOf(a.strategy) - rankOf(b.strategy); })
          .slice(0, 4)
        : [],
    };
  });

  // In-app links are the crawl's fuel; absolute externals are recorded but never
  // enqueued by the driver.
  var links = Array.prototype.slice.call(document.querySelectorAll('a[href]')).map(function (a) {
    return { href: a.getAttribute('href'), resolved: a.href, text: textOf(a).slice(0, 80) };
  });

  var headings = collectHeadings();

  var tables = collectTables();

  var regionCounts = {};
  out.forEach(function (e) { regionCounts[e.region] = (regionCounts[e.region] || 0) + 1; });

  return {
    url: location.href,
    path: location.pathname + location.search + location.hash,
    title: document.title,
    headings: headings,
    tables: tables,
    regions: regionCounts,
    elements: out,
    links: links,
    // Counted over visible controls, because a locator for something the user
    // cannot see is not a result a test can use.
    stats: (function () {
      var visible = out.filter(function (e) { return e.visible; });
      return {
        elements: out.length,
        visible: visible.length,
        hidden: out.length - visible.length,
        semantic: visible.filter(function (e) { return e.unique && !e.fragile; }).length,
        fragile: visible.filter(function (e) { return e.unique && e.fragile; }).length,
        ambiguous: visible.filter(function (e) { return !e.unique; }).length,
        withTestId: visible.filter(function (e) { return !!e.testId; }).length,
      };
    })(),
  };
}
