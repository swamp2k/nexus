import { getAuthenticatedUser } from "../auth/session";
import { getElectricityUsage } from "./eloverblik";
import { getEloverblikCredentials, getEloverblikCredentialStatus } from "./eloverblik-credentials";
import { getEnergyPrices, resolveEnergySettings } from "./energy-prices";
import { getWeatherForecast, resolveWeatherLocation } from "./weather";

type SourceEnv = Env & {
  ENERGY_PRICE_AREA?: string;
  ENERGY_GRID_PROVIDER?: string;
  ENERGY_SUPPLIER_MARKUP_OERE?: string;
  ELOVERBLIK_CREDENTIALS_KEY?: string;
  WASTE_CALENDAR_ICS_URL?: string;
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
  WEATHER_LABEL?: string;
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

  if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });

  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (pathname === "/api/sources/status") {
    const [weatherLocation, energySettings, eloverblikStatus] = await Promise.all([
      resolveWeatherLocation(env, user.id),
      resolveEnergySettings(env, user.id),
      getEloverblikCredentialStatus(env, user.id),
    ]);
    return json({
      sources: {
        weather: {
          configured: Boolean(weatherLocation),
          provider: "MET Norway",
          label: weatherLocation?.label ?? "Hjem",
        },
        energyPrices: {
          configured: Boolean(energySettings.gridProvider),
          area: energySettings.area,
          gridProvider: energySettings.gridProvider,
          supplierMarkupOere: energySettings.supplierMarkupOere,
        },
        electricityUsage: {
          configured: eloverblikStatus.configured,
          provider: "Eloverblik",
          meteringPoint: eloverblikStatus.meteringPoint || null,
        },
        wasteCalendar: {
          configured: Boolean(env.WASTE_CALENDAR_ICS_URL),
          implementation: "calendar_adapter_pending",
        },
      },
    });
  }

  if (pathname === "/api/sources/weather") {
    const result = await getWeatherForecast(env, user.id);
    if (!result) return json({ error: "source_not_configured" }, { status: 503 });
    return json(result);
  }

  if (pathname === "/api/sources/energy/prices") {
    return json(await getEnergyPrices(env, user.id));
  }

  if (pathname === "/api/sources/energy/usage") {
    const credentials = await getEloverblikCredentials(env, user.id);
    if (!credentials) return json({ error: "source_not_configured" }, { status: 503 });
    return json(await getElectricityUsage(env, user.id, credentials));
  }

  if (pathname === "/api/sources/waste") {
    return json(
      { error: env.WASTE_CALENDAR_ICS_URL ? "calendar_adapter_pending" : "source_not_configured" },
      { status: env.WASTE_CALENDAR_ICS_URL ? 501 : 503 },
    );
  }

  return null;
}
