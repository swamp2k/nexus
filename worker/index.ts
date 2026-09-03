import { handleAuthRoute } from "./auth/routes";
import { handleCalendarRoute } from "./calendar/routes";
import { handleDisplayRoute } from "./display/routes";
import { handleGarminAgentRoute } from "./garmin/agent-routes";
import { handleGarminCredentialRoute } from "./garmin/credential-routes";
import { handleGarminProcessRoute } from "./garmin/process-routes";
import { handleGarminRoute } from "./garmin/routes";
import { runGarminScheduledSync } from "./garmin/scheduled-sync";
import { handleMelCloudRoute } from "./melcloud/routes";
import { handleEloverblikSettingsRoute } from "./sources/eloverblik-settings-routes";
import { handleSourceRoute } from "./sources/routes";
import { handleSettingsRoute } from "./settings/routes";
import { handleUnraidRoute } from "./unraid/routes";
import { handleWellbeingRoute } from "./wellbeing/routes";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  DATA: R2Bucket;
  MAIL_FROM?: string;
  MAIL_PROVIDER?: string;
  FORWARD_EMAIL_API_KEY?: string;
  ENERGY_PRICE_AREA?: string;
  ENERGY_GRID_PROVIDER?: string;
  ENERGY_SUPPLIER_MARKUP_OERE?: string;
  WASTE_CALENDAR_ICS_URL?: string;
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
  WEATHER_LABEL?: string;
  GARMIN_AGENT_SECRET?: string;
  GARMIN_CREDENTIALS_KEY?: string;
  MELCLOUD_CREDENTIALS_KEY?: string;
  UNRAID_CREDENTIALS_KEY?: string;
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  return await handleAuthRoute(request, env)
    ?? await handleEloverblikSettingsRoute(request, env)
    ?? await handleSettingsRoute(request, env)
    ?? await handleSourceRoute(request, env)
    ?? await handleGarminRoute(request, env)
    ?? await handleGarminProcessRoute(request, env)
    ?? await handleGarminAgentRoute(request, env)
    ?? await handleGarminCredentialRoute(request, env)
    ?? await handleCalendarRoute(request, env)
    ?? await handleDisplayRoute(request, env)
    ?? await handleMelCloudRoute(request, env)
    ?? await handleUnraidRoute(request, env)
    ?? await handleWellbeingRoute(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        const response = await handleApi(request, env, ctx);
        if (response) return response;
        return Response.json({ error: "not_found" }, { status: 404 });
      } catch (error) {
        console.error(error);
        return Response.json({ error: "internal_error" }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runGarminScheduledSync(env, controller.scheduledTime));
  },
};
