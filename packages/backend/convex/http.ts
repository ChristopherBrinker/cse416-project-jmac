import { httpRouter } from "convex/server";

import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { uploadBenchmark, getBenchmarkFile } from "./benchmark";

const http = httpRouter();

const optionsHandler = httpAction(async (_, request) => {
  const headers = request.headers;
  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null &&
    headers.get("Access-Control-Request-Headers") !== null
  ) {
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) {
      throw new Error("Set SITE_URL on the Convex deployment");
    }
    return new Response(null, {
      headers: new Headers({
        "Access-Control-Allow-Origin": siteUrl,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      }),
    });
  }
  return new Response();
});

http.route({
  path: "/benchmark/upload",
  method: "POST",
  handler: uploadBenchmark,
});

http.route({
  path: "/benchmark/upload",
  method: "OPTIONS",
  handler: optionsHandler,
});

http.route({
  path: "/benchmark",
  method: "GET",
  handler: getBenchmarkFile,
});

authComponent.registerRoutes(http, createAuth);
export default http;
