import assert from "node:assert/strict";
import { applyRegistry, buildPublicApps, parseRegistryEntry } from "../worker/project-map/registry.ts";
import { extractIconCandidates, isSafePublicHost } from "../worker/project-map/favicon.ts";

// 1. parseRegistryEntry: valid fields + defaults
const parsed = parseRegistryEntry({
  id: "pc-doctor",
  title: "PC Doctor",
  repos: ["swamp2k/PCDoctor"],
  workers: [],
  pages: [],
  domains: [],
  confirmed: true,
  description: "Helps the family fix PC problems.",
  category: "Desktop Tools",
  productionUrl: "https://example.com",
  isPublic: true,
  showRepoPublic: true,
  hidden: false,
  pinned: true,
  icon: "🩺",
});
assert.equal(parsed.isPublic, true);
assert.equal(parsed.showRepoPublic, true);
assert.equal(parsed.pinned, true);
assert.equal(parsed.icon, "🩺");
assert.equal(parsed.productionUrl, "https://example.com");

// 1b. parseRegistryEntry: rejects icon > 16 chars
assert.throws(() => parseRegistryEntry({
  id: "bad-icon",
  title: "Bad Icon",
  repos: [],
  workers: [],
  pages: [],
  domains: [],
  icon: "12345678901234567",
}), /invalid_icon/);

// 2. parseRegistryEntry: rejects non-https productionUrl
assert.throws(() => parseRegistryEntry({
  id: "bad-url",
  title: "Bad",
  repos: [],
  workers: [],
  pages: [],
  domains: [],
  productionUrl: "http://insecure.example.com",
}), /invalid_production_url/);

assert.throws(() => parseRegistryEntry({
  id: "js-url",
  title: "Bad",
  repos: [],
  workers: [],
  pages: [],
  domains: [],
  productionUrl: "javascript:alert(1)",
}), /invalid_production_url/);

// 3. buildPublicApps: strict privacy & sorting
const snapshot = {
  generatedAt: "2026-11-27T12:00:00.000Z",
  source: "live",
  summary: { githubRepos: 2, workers: 1, pages: 0 },
  projects: [
    {
      id: "nexus",
      title: "Nexus",
      repo: "swamp2k/nexus",
      repos: ["swamp2k/nexus"],
      workers: ["nexus"],
      pages: [],
      domains: ["nexus.jeppesen.cc"],
      status: "confirmed",
      warnings: [],
    },
  ],
  repoOnly: ["swamp2k/PCDoctor", "swamp2k/secret-repo"],
  archivedRepoOnly: [],
  workerPublicUrls: { nexus: ["https://nexus.jeppesen.cc"] },
  repoMeta: {
    "swamp2k/PCDoctor": {
      fullName: "swamp2k/PCDoctor",
      url: "https://github.com/swamp2k/PCDoctor",
      isPrivate: false,
      archived: false,
      description: "GitHub description for PC Doctor",
      homepage: null,
      pushedAt: "2026-11-27T10:00:00.000Z",
      latestRelease: {
        tag: "v1.0.42",
        name: "v1.0.42",
        url: "https://github.com/swamp2k/PCDoctor/releases/tag/v1.0.42",
        publishedAt: "2026-11-27T10:00:00.000Z",
        assets: [{ name: "PCDoctor.exe", downloadUrl: "https://github.com/swamp2k/PCDoctor/releases/download/v1.0.42/PCDoctor.exe", size: 12345678 }],
      },
    },
    "swamp2k/secret-repo": {
      fullName: "swamp2k/secret-repo",
      url: "https://github.com/swamp2k/secret-repo",
      isPrivate: true,
      archived: false,
      description: "TOP SECRET DESCRIPTION",
      homepage: "https://secret.example.com",
      pushedAt: "2026-11-27T10:00:00.000Z",
      latestRelease: {
        tag: "v9.9.9",
        name: "Secret",
        url: "https://github.com/swamp2k/secret-repo/releases/tag/v9.9.9",
        publishedAt: "2026-11-27T10:00:00.000Z",
        assets: [],
      },
    },
  },
};

const entries = [
  parsed,
  parseRegistryEntry({
    id: "private-app",
    title: "Private App",
    repos: [],
    workers: [],
    pages: [],
    domains: [],
    isPublic: false,
  }),
  parseRegistryEntry({
    id: "hidden-app",
    title: "Hidden App",
    repos: [],
    workers: [],
    pages: [],
    domains: [],
    isPublic: true,
    hidden: true,
  }),
  parseRegistryEntry({
    id: "public-with-private-repo",
    title: "Alpha Public",
    repos: ["swamp2k/secret-repo"],
    workers: [],
    pages: [],
    domains: [],
    description: "Safe custom description",
    productionUrl: "https://app.example.com",
    isPublic: true,
    showRepoPublic: true,
    pinned: false,
  }),
];

const applied = applyRegistry(snapshot, entries);
assert.ok(applied.repoMeta["swamp2k/PCDoctor"]);

const publicApps = buildPublicApps(snapshot, entries);
assert.equal(publicApps.length, 2);
// Pinned first ("PC Doctor"), then "Alpha Public"
assert.equal(publicApps[0].id, "pc-doctor");
assert.equal(publicApps[0].icon, "🩺");
assert.equal(publicApps[0].repoUrl, "https://github.com/swamp2k/PCDoctor");
assert.equal(publicApps[0].latestRelease?.tag, "v1.0.42");

// Private repo metadata must NEVER leak even when entry is public
assert.equal(publicApps[1].id, "public-with-private-repo");
assert.equal(publicApps[1].repoUrl, null);
assert.equal(publicApps[1].latestRelease, null);
assert.equal(publicApps[1].description, "Safe custom description");
assert.equal(publicApps[1].productionUrl, "https://app.example.com");

console.log("test-project-catalog: all assertions passed");

// 4. icon URLs & favicon extraction safety
const urlIconEntry = parseRegistryEntry({
  id: "icon-url-app",
  title: "Icon URL App",
  repos: [],
  workers: [],
  pages: [],
  domains: [],
  icon: "https://example.com/favicon.png",
});
assert.equal(urlIconEntry.icon, "https://example.com/favicon.png");

assert.throws(() => parseRegistryEntry({
  id: "bad-icon-http",
  title: "Bad Icon",
  repos: [],
  workers: [],
  pages: [],
  domains: [],
  icon: "http://example.com/favicon.png",
}), /invalid_icon/);

assert.throws(() => parseRegistryEntry({
  id: "bad-icon-data",
  title: "Bad Icon",
  repos: [],
  workers: [],
  pages: [],
  domains: [],
  icon: "data:image/png;base64,AAA",
}), /invalid_icon/);

assert.equal(isSafePublicHost("example.com"), true);
assert.equal(isSafePublicHost("localhost"), false);
assert.equal(isSafePublicHost("127.0.0.1"), false);
assert.equal(isSafePublicHost("192.168.1.1"), false);
assert.equal(isSafePublicHost("169.254.169.254"), false);
assert.equal(isSafePublicHost("[::1]"), false);

const html = `
  <link rel="icon" href="/favicon.ico">
  <link rel="icon" type="image/svg+xml" href="/logo.svg">
  <link rel="apple-touch-icon" href="https://cdn.example.com/apple-touch.png">
  <link rel="icon" href="http://insecure.example.com/bad.png">
  <link rel="icon" href="javascript:alert(1)">
`;
const candidates = extractIconCandidates(html, "https://app.example.com/home");
assert.equal(candidates[0], "https://cdn.example.com/apple-touch.png");
assert.equal(candidates[1], "https://app.example.com/logo.svg");
assert.equal(candidates[2], "https://app.example.com/favicon.ico");
assert.ok(!candidates.some((c) => c.startsWith("http://") || c.startsWith("javascript:")));
