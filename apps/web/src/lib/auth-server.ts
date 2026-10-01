import "server-only";
import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

import { ENV } from "@/env";

export const { handler, isAuthenticated } = convexBetterAuthNextJs({
  convexUrl: ENV.NEXT_PUBLIC_CONVEX_URL,
  convexSiteUrl: ENV.NEXT_PUBLIC_CONVEX_SITE_URL,
});
