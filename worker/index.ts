import { handleAuthRoute } from "./auth/routes";
import { handleGarminRoute } from "./garmin/routes";

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
        const garminResponse = await handleGarminRoute(request, env);
        if (garminResponse) return garminResponse;
      }

      if (url.pathname.startsWith("/api/")) {
        return Response.json(
          {
            error: "not_found",
          },
          { status: 404 },
        );
      }

      return new Response(null, { status: 404 });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request_failed",
          path: url.pathname,
          error: error instanceof Error ? error.message : "unknown_error",
        }),
      );

      return Response.json(
        { error: "internal_error" },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  },
} satisfies ExportedHandler<Env>;
