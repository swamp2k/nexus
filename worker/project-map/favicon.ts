function normalizeHttpsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 300) throw new Error("invalid_url");
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "https:" || !parsed.hostname.includes(".") || parsed.username || parsed.password) {
    throw new Error("invalid_url");
  }
  return parsed.toString();
}

export function isSafePublicHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host || !host.includes(".")) return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host.startsWith("[") || host.includes(":")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return true;
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}

export function extractIconCandidates(html: string, pageUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }

  const scored: Array<{ score: number; url: string }> = [];
  const links = html.match(/<link\b[^>]*>/gi) ?? [];

  for (const tag of links) {
    const rel = attr(tag, "rel").toLowerCase();
    if (!rel.includes("icon")) continue;
    const href = attr(tag, "href");
    if (!href) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== "https:" || !isSafePublicHost(resolved.hostname) || resolved.username || resolved.password) {
      continue;
    }

    const type = attr(tag, "type").toLowerCase();
    const score = rel.includes("apple-touch-icon")
      ? 1
      : type.includes("svg") || resolved.pathname.toLowerCase().endsWith(".svg")
        ? 2
        : 3;

    scored.push({ score, url: resolved.toString() });
  }

  scored.sort((a, b) => a.score - b.score);

  const origin = base.origin;
  const fallbacks = isSafePublicHost(base.hostname) && base.protocol === "https:"
    ? [
        `${origin}/favicon.svg`,
        `${origin}/apple-touch-icon.png`,
        `${origin}/favicon.png`,
        `${origin}/favicon.ico`,
      ]
    : [];

  return Array.from(new Set([...scored.map((s) => s.url), ...fallbacks]));
}

async function probeIcon(url: string): Promise<boolean> {
  const checkResponse = (res: Response): boolean => {
    if (!res.ok) return false;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.startsWith("image/") || ct.startsWith("application/octet-stream")) return true;
    return /\.(ico|svg|png|webp|jpg|jpeg)(\?|$)/i.test(url);
  };

  try {
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "Nexus-Icon-Fetcher/1.0" },
    });
    if (checkResponse(head)) return true;
    if (head.status !== 405 && head.status !== 501) return false;

    const get = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "Nexus-Icon-Fetcher/1.0" },
    });
    return checkResponse(get);
  } catch {
    return false;
  }
}

export async function fetchSiteIcons(rawUrl: string): Promise<{ iconUrl: string | null; candidates: string[] }> {
  const normalized = normalizeHttpsUrl(rawUrl);
  if (!normalized) throw new Error("invalid_url");
  const parsed = new URL(normalized);
  if (!isSafePublicHost(parsed.hostname)) throw new Error("invalid_url");

  let finalUrl = parsed.toString();
  let html = "";

  try {
    const response = await fetch(finalUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Nexus-Icon-Fetcher/1.0" },
    });
    if (response.url) {
      try {
        const redirected = new URL(response.url);
        if (redirected.protocol === "https:" && isSafePublicHost(redirected.hostname)) {
          finalUrl = redirected.toString();
        }
      } catch { /* keep original */ }
    }
    const ct = (response.headers.get("content-type") ?? "").toLowerCase();
    if (response.ok && ct.includes("html")) {
      const text = await response.text();
      html = text.slice(0, 65536);
    }
  } catch {
    return { iconUrl: null, candidates: [] };
  }

  const candidates = extractIconCandidates(html, finalUrl).slice(0, 6);
  const checks = await Promise.all(candidates.map(async (url) => ((await probeIcon(url)) ? url : null)));
  const verified = checks.filter((u): u is string => Boolean(u));

  return {
    iconUrl: verified[0] ?? null,
    candidates: verified,
  };
}
