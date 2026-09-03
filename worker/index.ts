type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  GARMIN_UPLOADS: R2Bucket;
  MAIL_FROM: string;
  MAIL_PROVIDER?: string;
  FORWARD_EMAIL_API_KEY?: string;
  ENERGY_PRICE_AREA?: string;
  ENERGY_GRID_PROVIDER?: string;
  ENERGY_SUPPLIER_MARKUP_OERE?: string;
  ELOVERBLIK_REFRESH_TOKEN?: string;
  ELOVERBLIK_METERING_POINT?: string;
  WASTE_CALENDAR_ICS_URL?: string;
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
  WEATHER_LABEL?: string;
  GARMIN_AGENT_SECRET?: string;
  GARMIN_CREDENTIALS_KEY?: string;
  MELCLOUD_CREDENTIALS_KEY?: string;
  UNRAID_CREDENTIALS_KEY?: string;
};

import { handleAuthRoute } from "./auth/routes";
import { handleGarminRoute } from "./garmin/routes";
import { handleGarminAgentRoute } from "./garmin/agent-routes";
import { handleGarminCredentialRoute } from "./garmin/credential-routes";
import { handleGarminProcessRoute } from "./garmin/process-routes";
import { handleSourceRoute } from "./sources/routes";
import { handleSettingsRoute } from "./settings/routes";
import { handleEloverblikSettingsRoute } from "./sources/eloverblik-settings-routes";
import { handleWellbeingRoute } from "./wellbeing/routes";
import { handleCalendarRoute } from "./calendar/routes";
import { handleMelCloudRoute } from "./melcloud/routes";
import { handleDisplayRoute } from "./display/routes";
import { handleUnraidRoute } from "./unraid/routes";
import { runGarminScheduledSync } from "./garmin/scheduled-sync";

function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/auth/")) {
        const response = await handleAuthRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname === "/api/settings/eloverblik") {
        const response = await handleEloverblikSettingsRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/settings")) {
        const response = await handleSettingsRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/sources/")) {
        const response = await handleSourceRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/garmin/agent/")) {
        const response = await handleGarminAgentRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/garmin/credentials")) {
        const response = await handleGarminCredentialRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/garmin/process")) {
        const response = await handleGarminProcessRoute(request, env, ctx);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/garmin/")) {
        const response = await handleGarminRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/wellbeing/")) {
        const response = await handleWellbeingRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/calendar/")) {
        const response = await handleCalendarRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/melcloud/")) {
        const response = await handleMelCloudRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/display/")) {
        const response = await handleDisplayRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }

      if (url.pathname.startsWith("/api/unraid/")) {
        const response = await handleUnraidRoute(request, env);
        if (response) return applySecurityHeaders(response);
      }
    } catch (error) {
      console.error("Worker route error", error);
      return applySecurityHeaders(Response.json({ error: "internal_error" }, { status: 500 }));
    }

    return applySecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runGarminScheduledSync(env, controller.scheduledTime));
  },
};
