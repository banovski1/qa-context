// Where the deep crawl starts, and how it names what it finds.
//
// The deep crawl only follows `<a href>`, and most business software does not link
// its screens — on OrangeHRM links alone reached 22 of the 74 screens the map found
// through the menus. So the map's screens are seeds, not something a person has to
// copy into CRAWL_SEED_ROUTES by hand.

// A route's identity is its path with record ids replaced by a slot, so a list of
// a thousand contacts contributes one detail screen rather than a thousand.
const ID_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b[0-9a-f]{16,}\b/gi,
  /\b\d{3,}\b/g,
];

export function templatize(url) {
  let out = url;
  for (const pattern of ID_PATTERNS) out = out.replace(pattern, '{id}');
  return out;
}

export function routeId(url, baseUrl) {
  const relative = templatize(url).replace(baseUrl.replace(/\/$/, ''), '') || '/';
  const slug = relative.replace(/^[/#?]+/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'root';
}

export function sameApp(url, baseUrl) {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function excluded(url, patterns) {
  return (patterns || []).some((pattern) => new RegExp(pattern).test(url));
}

/** Every screen URL the map recorded, in map order. A missing or empty map is none. */
export function mapScreenUrls(map) {
  const urls = [];
  for (const module of map?.modules || []) {
    for (const screen of module?.screens || []) {
      if (typeof screen?.url === 'string' && screen.url) urls.push(screen.url);
    }
  }
  return urls;
}

/**
 * The crawl's starting queue: the base URL, then CRAWL_SEED_ROUTES, then every screen
 * the map reached. Same-origin only, CRAWL_EXCLUDE honoured, one target per route id.
 */
export function seedTargets({ baseUrl, seedRoutes = [], exclude = [], map = null }) {
  const root = baseUrl.replace(/\/$/, '');
  const candidates = [
    baseUrl,
    ...seedRoutes.map((route) => (String(route).startsWith('http') ? String(route) : root + route)),
    ...mapScreenUrls(map),
  ];
  const targets = [];
  const seen = new Set();
  for (const url of candidates) {
    if (!sameApp(url, baseUrl) || excluded(url, exclude)) continue;
    const id = routeId(url, baseUrl);
    if (seen.has(id)) continue;
    seen.add(id);
    targets.push({ id, url, depth: 0 });
  }
  return targets;
}
