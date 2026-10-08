export type GithubRepo = {
  name: string;
  full_name: string;
  archived: boolean;
  default_branch: string;
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

export async function listGithubRepos(token: string): Promise<GithubRepo[]> {
  const response = await fetch("https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=updated", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Nexus-Project-Map",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`github_repos_${response.status}`);
  return response.json<GithubRepo[]>();
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
