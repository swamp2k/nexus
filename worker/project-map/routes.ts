import { getAuthenticatedUser } from "../auth/session";

type ProjectMapEnv = Env & {
  GITHUB_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
};

type Snapshot = {
  generatedAt: string;
  source: string;
  summary: { githubRepos: number; workers: number; pages: number };
  projects: Array<{
    id: string;
    title: string;
    repo: string | null;
    workers: string[];
    pages: string[];
    domains: string[];
    status: string;
    warnings: string[];
  }>;
  repoOnly: string[];
  archivedRepoOnly: string[];
};

type GithubRepo = {
  name: string;
  full_name: string;
  archived: boolean;
  default_branch: string;
};

type Worker = { id: string };

type PagesProject = {
  name: string;
  domains?: string[];
  source?: { config?: { owner?: string; repo_name?: string; production_branch?: string } };
  latest_deployment?: {
    latest_stage?: { status?: string };
    deployment_trigger?: { metadata?: { branch?: string } };
  };
};

const SNAPSHOT_KEY = "project-map/snapshot.json";

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function requireAdmin(request: Request, env: ProjectMapEnv) {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return { response: json({ error: "unauthorized" }, { status: 401 }) };
  if (user.role !== "admin") return { response: json({ error: "forbidden" }, { status: 403 }) };
  return { user };
}

async function readSnapshot(env: ProjectMapEnv): Promise<Snapshot | null> {
  const object = await env.DATA.get(SNAPSHOT_KEY);
  if (!object) return null;
  return object.json<Snapshot>();
}

async function githubRepos(token: string): Promise<GithubRepo[]> {
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

async function cloudflareGet<T>(env: ProjectMapEnv, path: string): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`cloudflare_${response.status}`);
  const body = await response.json() as { success: boolean; result: T };
  if (!body.success) throw new Error("cloudflare_api_failed");
  return body.result;
}

async function cloudflareInventory(env: ProjectMapEnv): Promise<{ workers: Worker[]; pages: PagesProject[] }> {
  const accountId = encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID!);
  const workers = await cloudflareGet<Worker[]>(env, `/accounts/${accountId}/workers/scripts`);
  const pages: PagesProject[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects?page=${page}`, {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    });
    if (!response.ok) throw new Error(`cloudflare_pages_${response.status}`);
    const body = await response.json() as { success: boolean; result: PagesProject[]; result_info?: { total_pages?: number } };
    if (!body.success) throw new Error("cloudflare_pages_failed");
    pages.push(...body.result);
    if (page >= (body.result_info?.total_pages ?? 1)) break;
  }
  return { workers, pages };
}

function titleFromId(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function rebuildSnapshot(base: Snapshot | null, repos: GithubRepo[], workers: Worker[], pages: PagesProject[]): Snapshot {
  const repoMap = new Map(repos.map((repo) => [repo.full_name.toLowerCase(), repo]));
  const workerNames = new Set(workers.map((worker) => worker.id));
  const pageMap = new Map(pages.map((page) => [page.name, page]));
  const representedRepos = new Set<string>();
  const representedWorkers = new Set<string>();
  const representedPages = new Set<string>();

  const projects = (base?.projects ?? []).map((project) => {
    const repo = project.repo ? repoMap.get(project.repo.toLowerCase()) : undefined;
    if (project.repo && repo) representedRepos.add(repo.full_name);
    const currentWorkers = project.workers.filter((name) => workerNames.has(name));
    currentWorkers.forEach((name) => representedWorkers.add(name));
    const currentPages = project.pages.filter((name) => pageMap.has(name));
    currentPages.forEach((name) => representedPages.add(name));

    const domains = Array.from(new Set(currentPages.flatMap((name) => pageMap.get(name)?.domains ?? [])));
    const warnings: string[] = [];
    if (project.repo && !repo) warnings.push("Configured GitHub repo was not found");
    if (repo?.archived && (currentWorkers.length || currentPages.length)) warnings.push("Deployed repo is archived");

    for (const pageName of currentPages) {
      const page = pageMap.get(pageName);
      const productionBranch = page?.source?.config?.production_branch;
      if (repo && productionBranch && productionBranch !== repo.default_branch) {
        warnings.push(`${pageName}: production tracks ${productionBranch}; repo default is ${repo.default_branch}`);
      }
      if (page?.latest_deployment?.latest_stage?.status === "failure") warnings.push(`${pageName}: latest deployment failed`);
    }

    if (!project.repo && (currentWorkers.length || currentPages.length)) warnings.push("No GitHub repo mapped");

    return { ...project, workers: currentWorkers, pages: currentPages, domains, warnings };
  });

  for (const page of pages) {
    if (representedPages.has(page.name)) continue;
    const repoFullName = page.source?.config?.owner && page.source?.config?.repo_name
      ? `${page.source.config.owner}/${page.source.config.repo_name}`
      : null;
    if (repoFullName && repoMap.has(repoFullName.toLowerCase())) representedRepos.add(repoFullName);
    representedPages.add(page.name);
    projects.push({
      id: page.name,
      title: titleFromId(page.name),
      repo: repoFullName,
      workers: [],
      pages: [page.name],
      domains: page.domains ?? [],
      status: "unmapped",
      warnings: ["New Pages project needs registry review"],
    });
  }

  for (const worker of workers) {
    if (representedWorkers.has(worker.id)) continue;
    const exact = repos.find((repo) => repo.name.toLowerCase() === worker.id.toLowerCase());
    if (exact) representedRepos.add(exact.full_name);
    projects.push({
      id: worker.id,
      title: titleFromId(worker.id),
      repo: exact?.full_name ?? null,
      workers: [worker.id],
      pages: [],
      domains: [],
      status: "unmapped",
      warnings: [exact ? "Auto-matched by exact name; review registry" : "New Worker needs registry review"],
    });
  }

  const repoOnly = repos.filter((repo) => !repo.archived && !representedRepos.has(repo.full_name)).map((repo) => repo.full_name).sort();
  const archivedRepoOnly = repos.filter((repo) => repo.archived && !representedRepos.has(repo.full_name)).map((repo) => repo.full_name).sort();

  return {
    generatedAt: new Date().toISOString(),
    source: "live",
    summary: { githubRepos: repos.length, workers: workers.length, pages: pages.length },
    projects: projects.sort((a, b) => a.title.localeCompare(b.title)),
    repoOnly,
    archivedRepoOnly,
  };
}

async function refresh(env: ProjectMapEnv): Promise<{ snapshot: Snapshot | null; missing: string[] }> {
  const missing = [
    !env.GITHUB_TOKEN && "GITHUB_TOKEN",
    !env.CLOUDFLARE_API_TOKEN && "CLOUDFLARE_API_TOKEN",
    !env.CLOUDFLARE_ACCOUNT_ID && "CLOUDFLARE_ACCOUNT_ID",
  ].filter((value): value is string => Boolean(value));
  const current = await readSnapshot(env);
  if (missing.length) return { snapshot: current, missing };

  const [repos, cf] = await Promise.all([
    githubRepos(env.GITHUB_TOKEN!),
    cloudflareInventory(env),
  ]);
  const snapshot = rebuildSnapshot(current, repos, cf.workers, cf.pages);
  await env.DATA.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { httpMetadata: { contentType: "application/json" } });
  return { snapshot, missing: [] };
}

export async function handleProjectMapRoute(request: Request, env: ProjectMapEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/project-map") return null;
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;

  if (request.method === "POST") {
    try {
      const result = await refresh(env);
      if (!result.snapshot) return json({ error: "snapshot_not_found", missingSetup: result.missing }, { status: 404 });
      return json({ ...result.snapshot, liveRefreshReady: result.missing.length === 0, missingSetup: result.missing });
    } catch (error) {
      console.error(JSON.stringify({ event: "project_map_refresh_failed", error: error instanceof Error ? error.message : "unknown_error" }));
      const snapshot = await readSnapshot(env);
      if (!snapshot) return json({ error: "refresh_failed" }, { status: 502 });
      return json({ ...snapshot, liveRefreshReady: true, refreshError: "refresh_failed" });
    }
  }

  const snapshot = await readSnapshot(env);
  if (!snapshot) return json({ error: "snapshot_not_found" }, { status: 404 });
  const missing = [
    !env.GITHUB_TOKEN && "GITHUB_TOKEN",
    !env.CLOUDFLARE_API_TOKEN && "CLOUDFLARE_API_TOKEN",
    !env.CLOUDFLARE_ACCOUNT_ID && "CLOUDFLARE_ACCOUNT_ID",
  ].filter((value): value is string => Boolean(value));
  return json({ ...snapshot, liveRefreshReady: missing.length === 0, missingSetup: missing });
}
