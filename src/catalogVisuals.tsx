export type CategoryTone = "blue" | "emerald" | "violet" | "amber" | "rose" | "teal" | "slate";

const HASH_TONES: CategoryTone[] = ["blue", "emerald", "violet", "amber", "rose", "teal"];

export function categoryTone(category: string): CategoryTone {
  const value = category.trim().toLowerCase();
  if (!value) return "slate";
  if (/shop|butik|dba|pris/.test(value)) return "emerald";
  if (/desktop|pc|tool|3d|video/.test(value)) return "violet";
  if (/home|server|infra|unraid/.test(value)) return "amber";
  if (/web|app|site/.test(value)) return "blue";
  if (/util|script|dev/.test(value)) return "teal";

  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return HASH_TONES[Math.abs(hash) % HASH_TONES.length];
}

export function projectMonogram(title: string): string {
  const words = title.trim().split(/[\s\-_]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return "?";
}

export function displayHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export type Shelf<T> = {
  key: string;
  label: string;
  tone: CategoryTone;
  isFeatured?: boolean;
  items: T[];
};

export function groupIntoShelves<T>(
  items: T[],
  opts: {
    getCategory: (item: T) => string;
    getPinned: (item: T) => boolean;
    featuredLabel: string;
    uncategorizedLabel: string;
  },
): Shelf<T>[] {
  const shelves: Shelf<T>[] = [];
  const featured = items.filter((item) => opts.getPinned(item));
  if (featured.length) {
    shelves.push({
      key: "__featured",
      label: opts.featuredLabel,
      tone: "blue",
      isFeatured: true,
      items: featured,
    });
  }

  const byCategory = new Map<string, { label: string; items: T[] }>();
  const uncategorized: T[] = [];

  for (const item of items) {
    if (opts.getPinned(item)) continue;
    const rawCat = opts.getCategory(item).trim();
    if (!rawCat) {
      uncategorized.push(item);
      continue;
    }
    const key = rawCat.toLowerCase();
    const existing = byCategory.get(key);
    if (existing) existing.items.push(item);
    else byCategory.set(key, { label: rawCat, items: [item] });
  }

  const sortedCategories = Array.from(byCategory.entries())
    .sort(([, a], [, b]) => a.label.localeCompare(b.label));

  for (const [key, group] of sortedCategories) {
    shelves.push({
      key: `cat:${key}`,
      label: group.label,
      tone: categoryTone(group.label),
      items: group.items,
    });
  }

  if (uncategorized.length) {
    shelves.push({
      key: "__other",
      label: opts.uncategorizedLabel,
      tone: "slate",
      items: uncategorized,
    });
  }

  return shelves;
}

export function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export function GithubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

export function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
