type HealthResponse = {
  ok: true;
  service: "nexus";
  version: string;
};

export default {
  fetch(request) {
    const url = new URL(request.url);

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

    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        {
          error: "not_found",
        },
        { status: 404 },
      );
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler;
