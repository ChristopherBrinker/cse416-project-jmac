"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(result.error.message ?? "Unable to sign out. Try again.");
        setPending(false);
        return;
      }
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("Unable to sign out. Please try again.");
    }
    setPending(false);
  };

  return (
    <div>
      <details className="relative w-fit">
        <summary
          aria-label="Account menu"
          className="bg-muted flex size-7 cursor-pointer list-none items-center justify-center rounded-full text-sm font-medium"
        >
          {session?.user.name.slice(0, 1).toUpperCase() ?? "U"}
        </summary>
        <div className="bg-background absolute z-10 mt-2 w-64 space-y-2 rounded border p-3 shadow">
          <p className="truncate text-sm">{session?.user.email}</p>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            disabled={pending}
            onClick={signOut}
          >
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
