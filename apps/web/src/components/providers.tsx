"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { Toaster } from "@cse416-project-jmac/ui/components/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { WagmiProvider } from "wagmi";

import { authClient } from "@/lib/auth-client";
import { wagmiConfig } from "@/lib/wagmi";

import { ENV } from "../env";
import { ThemeProvider } from "./theme-provider";

const convex = new ConvexReactClient(ENV.NEXT_PUBLIC_CONVEX_URL);
const queryClient = new QueryClient();

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <ConvexBetterAuthProvider client={convex} authClient={authClient}>
            {children}
          </ConvexBetterAuthProvider>
        </QueryClientProvider>
      </WagmiProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
