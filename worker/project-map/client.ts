export type ReleaseAsset = {
  name: string;
  downloadUrl: string;
  size: number;
};

export type RepoRelease = {
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
};

export type RepoMeta = {
  fullName: string;
  url: string;
  isPrivate: boolean;
  archived: boolean;
  description: string | null;
  homepage: string | null;
  pushedAt: string | null;
  latestRelease: RepoRelease | null;
};

export type GithubRepo = {
  name: string;
  full_name: string;
  archived: boolean;
  default_branch: string;
  private?: boolean;
  description?: string | null;
  homepage?: string | null;
  html_url?: string;
  pushed_at?: string | null;
  latestRelease?: RepoRelease | null;
};

export type Worker = { id: string };
export type WorkerDomain = { hostname: string; service: string; enabled?: boolean };
export type WorkerPublicUrls = Record<string, string[]>;

function publicHost(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(value) || !value.includes(".") || value.includes("..")) return null;
  return value;
}

export function collectPublicUrls(
  workers: Worker[],
  domains: WorkerDomain[],
  accountSubdomain: string | null,
  enabledScripts: Record<string, boolean>,
): WorkerPublicUrls {
  const urls: WorkerPublicUrls = {};
  const names = new Set(workers.map((worker) => worker.id));
  for (const name of names) urls[name] = [];
  for (const domain of domains) {
    if (!names.has(domain.service) || domain.enabled === false) continue;
    const hostname = publicHost(domain.hostname);
    if (hostname) urls[domain.service].push(`https://${hostname}`);
  }
  const subdomain = accountSubdomain ? publicHost(`${accountSubdomain}.workers.dev`) : null;
  if (subdomain) for (const name of names) {
    if (enabledScripts[name] !== true) continue;
    const hostname = publicHost(`${name}.${subdomain}`);
    if (hostname) urls[name].push(`https://${hostname}`);
  }
  for (const name of names) urls[name] = [...new Set(urls[name])].sort();
  return urls;
}

export type PagesProject = {
  name: string;
  domains?: string[];
  source?: { config?: { owner?: string; repo_name?: string; production_branch?: string } };
  latest_deployment?: {
    latest_stage?: { status?: string };
    deployment_trigger?: { metadata?: { branch?: string } };
  };
};

const GITHUB_GRAPHQL_QUERY = `query {
  viewer {
    repositories(first: 100, ownerAffiliations: OWNER, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        name
        nameWithOwner
        url
        isPrivate
        isArchived
        description
        homepageUrl
        pushedAt
        defaultBranchRef { name }
        latestRelease {
          tagName
          name
          url
          publishedAt
          isDraft
          isPrerelease
          releaseAssets(first: 12) {
            nodes {
              name
              downloadUrl
              size
            }
          }
        }
      }
    }
  }
}`;

type GraphQLRepoNode = {
  name?: string;
  nameWithOwner?: string;
  url?: string;
  isPrivate?: boolean;
  isArchived?: boolean;
  description?: string | null;
  homepageUrl?: string | null;
  pushedAt?: string | null;
  defaultBranchRef?: { name?: string } | null;
  latestRelease?: {
    tagName?: string;
    name?: string | null;
    url?: string;
    publishedAt?: string | null;
    isDraft?: boolean;
    isPrerelease?: boolean;
    releaseAssets?: {
      nodes?: Array<{ name?: string; downloadUrl?: string; size?: number }>;
    } | null;
  } | null;
};

async function listGithubReposGraphQL(token: string): Promise<GithubRepo[] | null> {
  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Nexus-Project-Map",
      },
      body: JSON.stringify({ query: GITHUB_GRAPHQL_QUERY }),
    });
    if (!response.ok) return null;
    const body = await response.json() as {
      data?: { viewer?: { repositories?: { nodes?: GraphQLRepoNode[] } } };
      errors?: unknown[];
    };
    if (body.errors?.length || !body.data?.viewer?.repositories?.nodes) return null;

    return body.data.viewer.repositories.nodes
      .filter((node): node is GraphQLRepoNode & { name: string; nameWithOwner: string } =>
        Boolean(node.name && node.nameWithOwner))
      .map((node) => {
        const rel = node.latestRelease;
        const latestRelease: RepoRelease | null = rel && !rel.isDraft && rel.tagName && rel.url
          ? {
              tag: rel.tagName,
              name: rel.name?.trim() || rel.tagName,
              url: rel.url,
              publishedAt: rel.publishedAt ?? null,
              assets: (rel.releaseAssets?.nodes ?? [])
                .filter((a): a is { name: string; downloadUrl: string; size?: number } =>
                  Boolean(a?.name && a?.downloadUrl))
                .map((a) => ({ name: a.name, downloadUrl: a.downloadUrl, size: typeof a.size === "number" ? a.size : 0 })),
            }
          : null;

        return {
          name: node.name,
          full_name: node.nameWithOwner,
          archived: node.isArchived === true,
          default_branch: node.defaultBranchRef?.name || "main",
          private: node.isPrivate === true,
          description: node.description ?? null,
          homepage: node.homepageUrl ?? null,
          html_url: node.url,
          pushed_at: node.pushedAt ?? null,
          latestRelease,
        };
      });
  } catch {
    return null;
  }
}

export async function listGithubRepos(token: string): Promise<GithubRepo[]> {
  const graphqlRepos = await listGithubReposGraphQL(token);
  if (graphqlRepos) return graphqlRepos;

  const response = await fetch("https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=updated", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Nexus-Project-Map",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`github_repos_${response.status}`);
  const repos = await response.json<GithubRepo[]>();
  return repos.map((repo) => ({ ...repo, latestRelease: null }));
}

async function cloudflareGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`cloudflare_${response.status}`);
  const body = await response.json() as { success: boolean; result: T };
  if (!body.success) throw new Error("cloudflare_api_failed");
  return body.result;
}

export async function listCloudflareInventory(
  token: string,
  rawAccountId: string,
): Promise<{ workers: Worker[]; pages: PagesProject[]; publicUrls: WorkerPublicUrls }> {
  const accountId = encodeURIComponent(rawAccountId);
  const workers = await cloudflareGet<Worker[]>(token, `/accounts/${accountId}/workers/scripts`);
  // Domain mappings are the authoritative public Worker hostnames.
  // workers.dev is included only when enabled per-script; internal service bindings
  // and non-public Worker routes are deliberately excluded.
  const domains = await cloudflareGet<WorkerDomain[]>(token, `/accounts/${accountId}/workers/domains`);
  const subdomainResult = await cloudflareGet<{ subdomain?: string }>(token, `/accounts/${accountId}/workers/subdomain`);
  const enabledScripts: Record<string, boolean> = {};
  await Promise.all(workers.map(async (worker) => {
    const result = await cloudflareGet<{ enabled?: boolean }>(
      token, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(worker.id)}/subdomain`,
    );
    enabledScripts[worker.id] = result.enabled === true;
  }));
  const publicUrls = collectPublicUrls(workers, domains, subdomainResult.subdomain ?? null, enabledScripts);
  const pages: PagesProject[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects?page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(`cloudflare_pages_${response.status}`);
    const body = await response.json() as {
      success: boolean;
      result: PagesProject[];
      result_info?: { total_pages?: number };
    };
    if (!body.success) throw new Error("cloudflare_pages_failed");
    pages.push(...body.result);
    if (page >= (body.result_info?.total_pages ?? 1)) break;
  }

  return { workers, pages, publicUrls };
}
