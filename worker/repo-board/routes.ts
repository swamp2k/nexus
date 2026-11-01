import { getAuthenticatedUser } from "../auth/session";

/**
 * Repo Board integration. repo-board stays the source of truth for lanes and
 * prompts; Nexus only asks it for the board (private Service Binding, so no
 * public URL or second login) and passes the data to the UI.
 *
 * To change the transport later, replace the body of `loadBoard()` only.
 */
const CONTRACT_VERSION = 1;

export type RepoBoardData = {
  contractVersion: number;
  generatedAt: string;
  lanes: { id: string; title: string; repos: unknown[] }[];
};

type RepoBoardIntegration = { getBoard(): Promise<RepoBoardData> };

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function loadBoard(env: Env): Promise<RepoBoardData> {
  if (!env.REPOBOARD) throw new Error("binding_missing");
  const board = await (env.REPOBOARD as unknown as RepoBoardIntegration).getBoard();
  if (board.contractVersion !== CONTRACT_VERSION) throw new Error("contract_mismatch");
  return board;
}

export async function handleRepoBoardRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/repo-board/board") return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") return json({ error: "forbidden" }, { status: 403 });
  try {
    return json(await loadBoard(env));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["not_configured", "binding_missing", "contract_mismatch"].includes(message) ? message : "upstream_unavailable";
    return json({ error: code }, { status: 502 });
  }
}
