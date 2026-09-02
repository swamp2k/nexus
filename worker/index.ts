import { handleAuthRoute } from "./auth/routes";
import { handleCalendarRoute } from "./calendar/routes";
import { handleDisplayDataAlias, handleDisplayRoute } from "./display/routes";
import { handleGarminAgentRoute } from "./garmin/agent-routes";
import { handleGarminCredentialRoute } from "./garmin/credential-routes";
import { handleGarminProcessRoute } from "./garmin/process-routes";
import { handleGarminRoute } from "./garmin/routes";
import { queueScheduledGarminSyncs, shouldRunScheduledGarminSync } from "./garmin/scheduled-sync";
import { handleMelCloudRoute } from "./melcloud/routes";
import { handleHomeLayoutRoute } from "./settings/home-layout";
import { handleNavigationRoute } from "./settings/navigation";
import { handleSettingsRoute } from "./settings/routes";
import { handleSourceRoute } from "./sources/routes";
import { handleUnraidRoute } from "./unraid/routes";
import { handleJournalAiRoute } from "./wellbeing/journal-ai";
import { handleMiyagiHistoryRoute } from "./wellbeing/miyagi-history";
import { handleMiyagiRoute } from "./wellbeing/miyagi";
import { handleWellbeingHistoryRoute } from "./wellbeing/history";
import { handleWellbeingRoute } from "./wellbeing/routes";

type HealthResponse = { ok: true; service: "nexus"; version: string };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return Response.json({ ok: true, service: "nexus", version: "0.1.0" } satisfies HealthResponse, { headers: { "Cache-Control": "no-store" } });

      if (url.pathname.startsWith("/api/display/")) {
        const response = await handleDisplayRoute(request, env);
        if (response) return response;
      }
      const displayDataResponse = await handleDisplayDataAlias(request, env);
      if (displayDataResponse) return displayDataResponse;

      if (url.pathname.startsWith("/api/auth/")) { const response = await handleAuthRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/calendar/")) { const response = await handleCalendarRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/garmin/")) {
        const credentialResponse = await handleGarminCredentialRoute(request, env); if (credentialResponse) return credentialResponse;
        const agentResponse = await handleGarminAgentRoute(request, env); if (agentResponse) return agentResponse;
        const processResponse = await handleGarminProcessRoute(request, env); if (processResponse) return processResponse;
        const garminResponse = await handleGarminRoute(request, env); if (garminResponse) return garminResponse;
      }
      if (url.pathname.startsWith("/api/melcloud/")) { const response = await handleMelCloudRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/unraid/")) { const response = await handleUnraidRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/wellbeing/miyagi/history")) { const response = await handleMiyagiHistoryRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/wellbeing/miyagi/")) { const response = await handleMiyagiRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/wellbeing/journal-ai/")) { const response = await handleJournalAiRoute(request, env); if (response) return response; }
      if (url.pathname === "/api/wellbeing/history") { const response = await handleWellbeingHistoryRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/wellbeing/")) { const response = await handleWellbeingRoute(request, env); if (response) return response; }
      if (url.pathname === "/api/home-layout") { const response = await handleHomeLayoutRoute(request, env); if (response) return response; }
      if (url.pathname === "/api/navigation") { const response = await handleNavigationRoute(request, env); if (response) return response; }
      if (url.pathname === "/api/settings") { const response = await handleSettingsRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/sources/")) { const response = await handleSourceRoute(request, env); if (response) return response; }
      if (url.pathname.startsWith("/api/")) return Response.json({ error: "not_found" }, { status: 404 });
      return new Response(null, { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", path: url.pathname, error: error instanceof Error ? error.message : "unknown_error" }));
      return Response.json({ error: "internal_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  },
  async scheduled(_event, env, ctx) {
    const now = new Date();
    if (!shouldRunScheduledGarminSync(now)) return;
    ctx.waitUntil((async () => {
      try {
        const result = await queueScheduledGarminSyncs(env);
        console.log(JSON.stringify({ event: "garmin_scheduled_sync", at: now.toISOString(), ...result }));
      } catch (error) {
        console.error(JSON.stringify({ event: "garmin_scheduled_sync_failed", at: now.toISOString(), error: error instanceof Error ? error.message : "unknown_error" }));
      }
    })());
  },
} satisfies ExportedHandler<Env>;
