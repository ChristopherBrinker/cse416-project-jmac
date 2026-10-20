"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cse416-project-jmac/ui/components/dropdown-menu";
import { LogOut } from "lucide-react";
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Account menu"
            variant="ghost"
            size="icon"
            className="bg-muted size-9 rounded-full"
          />
        }
      >
        {session?.user.name.slice(0, 1).toUpperCase() ?? "U"}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-xl p-1.5"
      >
        <div className="space-y-1 px-3 py-2.5 text-xs">
          <p className="truncate font-medium">{session?.user.name}</p>
          <p className="text-muted-foreground truncate">
            {session?.user.email}
          </p>
        </div>
        <DropdownMenuSeparator className="mx-1 my-1" />
        <DropdownMenuItem
          className="rounded-lg px-3 py-2.5 font-medium"
          disabled={pending}
          closeOnClick={false}
          onClick={signOut}
        >
          <LogOut aria-hidden="true" />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
        {error && (
          <p role="alert" className="text-destructive px-3 py-2 text-xs">
            {error}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
