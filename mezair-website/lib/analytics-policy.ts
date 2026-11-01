const PUBLIC_PAGES = new Set(["/", "/pricing", "/sync", "/what-does-mezair-mean", "/docs"]);

/** Account/auth/share URLs, query strings and fragment keys never enter analytics. */
export function publicAnalyticsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!PUBLIC_PAGES.has(url.pathname) && !url.pathname.startsWith("/docs/")) return null;
    if (url.pathname.startsWith("/docs/workspace-review-local")) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function downloadPlatform(value: string): "mac" | "windows" | "linux" | "releases" | null {
  try {
    const url = new URL(value);
    if (
      url.hostname !== "github.com" ||
      !url.pathname.startsWith("/anthonyhumphreys/mezair/releases")
    )
      return null;
    if (/\.(dmg|zip)$/i.test(url.pathname)) return "mac";
    if (/\.exe$/i.test(url.pathname)) return "windows";
    if (/\.(AppImage|deb|pacman)$/i.test(url.pathname)) return "linux";
    if (
      url.pathname === "/anthonyhumphreys/mezair/releases" ||
      url.pathname === "/anthonyhumphreys/mezair/releases/latest"
    )
      return "releases";
    return null;
  } catch {
    return null;
  }
}
