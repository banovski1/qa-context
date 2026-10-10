// The path an application is served below. The compiler joins declared routes onto it,
// and a reader must not mistake it for a module name.

/** "/web/index.php" for https://host/web/index.php/, or '' when the app sits at the origin. */
export function mountPrefix(baseUrl: string | undefined): string {
  if (!baseUrl) return '';
  try { return new URL(baseUrl).pathname.replace(/\/+$/, ''); } catch { return ''; }
}

