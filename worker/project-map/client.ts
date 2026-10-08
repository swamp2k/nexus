export type GithubRepo = {
  name: string;
  full_name: string;
  archived: boolean;
  default_branch: string;
};

export type Worker = { id: string };

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
): Promise<{ workers: Worker[]; pages: PagesProject[] }> {
  const accountId = encodeURIComponent(rawAccountId);
  const workers = await cloudflareGet<Worker[]>(token, `/accounts/${accountId}/workers/scripts`);
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

  return { workers, pages };
}
