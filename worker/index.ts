import { handleAuthRoute } from "./auth/routes";
import { handleGarminAgentRoute } from "./garmin/agent-routes";
import { handleGarminCredentialRoute } from "./garmin/credential-routes";
import { handleGarminProcessRoute } from "./garmin/process-routes";
import { handleGarminRoute } from "./garmin/routes";
import { handleHomeLayoutRoute } from "./settings/home-layout";
import { handleSettingsRoute } from "./settings/routes";
import { handleSourceRoute } from "./sources/routes";
import { handleJournalAiRoute } from "./wellbeing/journal-ai";
import { handleMiyagiHistoryRoute } from "./wellbeing/miyagi-history";
import { handleMiyagiRoute } from "./wellbeing/miyagi";
import { handleWellbeingHistoryRoute } from "./wellbeing/history";
import { handleWellbeingRoute } from "./wellbeing/routes";

type HealthResponse = {
  ok: true;
  service: "nexus";
  version: string;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        const body: HealthResponse = {
          ok: true,
          service: "nexus",
          version: "0.1.0",
        };

        return Response.json(body, {
          headers: {
            "Cache-Control": "no-store",
          },
        });
      }

      if (url.pathname.startsWith("/api/auth/")) {
        const authResponse = await handleAuthRoute(request, env);
        if (authResponse) return authResponse;
      }

      if (url.pathname.startsWith("/api/garmin/")) {
        const credentialResponse = await handleGarminCredentialRoute(request, env);
        if (credentialResponse) return credentialResponse;
        const agentResponse = await handleGarminAgentRoute(request, env);
        if (agentResponse) return agentResponse;
        const processResponse = await handleGarminProcessRoute(request, env);
        if (processResponse) return processResponse;
        const garminResponse = await handleGarminRoute(request, env);
        if (garminResponse) return garminResponse;
      }

      if (url.pathname.startsWith("/api/wellbeing/miyagi/history")) {
        const historyResponse = await handleMiyagiHistoryRoute(request, env);
        if (historyResponse) return historyResponse;
      }

      if (url.pathname.startsWith("/api/wellbeing/miyagi/")) {
        const miyagiResponse = await handleMiyagiRoute(request, env);
        if (miyagiResponse) return miyagiResponse;
      }

      if (url.pathname.startsWith("/api/wellbeing/journal-ai/")) {
        const journalAiResponse = await handleJournalAiRoute(request, env);
        if (journalAiResponse) return journalAiResponse;
      }

      if (url.pathname === "/api/wellbeing/history") {
        const historyResponse = await handleWellbeingHistoryRoute(request, env);
        if (historyResponse) return historyResponse;
      }

      if (url.pathname.startsWith("/api/wellbeing/")) {
        const wellbeingResponse = await handleWellbeingRoute(request, env);
        if (wellbeingResponse) return wellbeingResponse;
      }

      if (url.pathname === "/api/home-layout") {
        const homeLayoutResponse = await handleHomeLayoutRoute(request, env);
        if (homeLayoutResponse) return homeLayoutResponse;
      }

      if (url.pathname === "/api/settings") {
        const settingsResponse = await handleSettingsRoute(request, env);
        if (settingsResponse) return settingsResponse;
      }

      if (url.pathname.startsWith("/api/sources/")) {
        const sourceResponse = await handleSourceRoute(request, env);
        if (sourceResponse) return sourceResponse;
      }

      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }

      return new Response(null, { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({
        event: "request_failed",
        path: url.pathname,
        error: error instanceof Error ? error.message : "unknown_error",
      }));

      return Response.json(
        { error: "internal_error" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
} satisfies ExportedHandler<Env>;
