import { Button } from "@cse416-project-jmac/ui/components/button";
import Link from "next/link";

import { BrandLogo } from "@/components/brand-logo";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start justify-center gap-6 p-6">
      <BrandLogo size="lg" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Benchmark AI models on your private data.
        </h1>
        <p className="text-muted-foreground max-w-xl text-sm">
          Run evaluations across providers, recover from failures automatically,
          and keep a verifiable receipt for every result.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href="/sign-in" />}
        >
          Sign in
        </Button>
        <Button
          variant="outline"
          size="lg"
          nativeButton={false}
          render={<Link href="/dashboard" />}
        >
          Open dashboard
        </Button>
      </div>
    </main>
  );
}
