import { getAuthenticatedUser } from "../auth/session";
import { getElectricityUsage } from "./eloverblik";
import { getEnergyPrices } from "./energy-prices";

type SourceEnv = Env & {
  ENERGY_PRICE_AREA?: string;
  ELOVERBLIK_REFRESH_TOKEN?: string;
  ELOVERBLIK_METERING_POINT?: string;
  WASTE_CALENDAR_ICS_URL?: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function requireUser(request: Request, env: SourceEnv) {
  return getAuthenticatedUser(request, env.DB);
}

export async function handleSourceRoute(request: Request, env: SourceEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/sources/")) return null;

  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (pathname === "/api/sources/status") {
    return json({
      sources: {
        energyPrices: {
          configured: true,
          area: env.ENERGY_PRICE_AREA === "DK2" ? "DK2" : "DK1",
        },
        electricityUsage: {
          configured: Boolean(env.ELOVERBLIK_REFRESH_TOKEN && env.ELOVERBLIK_METERING_POINT),
        },
        wasteCalendar: {
          configured: Boolean(env.WASTE_CALENDAR_ICS_URL),
          implementation: "calendar_adapter_pending",
        },
      },
    });
  }

  if (pathname === "/api/sources/energy/prices") {
    const result = await getEnergyPrices(env);
    return json(result);
  }

  if (pathname === "/api/sources/energy/usage") {
    const result = await getElectricityUsage(env);
    if (!result) {
      return json({ error: "source_not_configured" }, { status: 503 });
    }
    return json(result);
  }

  if (pathname === "/api/sources/waste") {
    return json(
      {
        error: env.WASTE_CALENDAR_ICS_URL ? "calendar_adapter_pending" : "source_not_configured",
      },
      { status: env.WASTE_CALENDAR_ICS_URL ? 501 : 503 },
    );
  }

  return null;
}
