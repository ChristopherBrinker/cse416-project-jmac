"use client";
import { cn } from "@cse416-project-jmac/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import { BrandLogo } from "./brand-logo";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const links = [
    { to: "/", label: "Home", className: "hidden sm:inline-flex" },
    { to: "/dashboard", label: "Dashboard", className: "inline-flex" },
  ] as const;

  return (
    <header className="bg-background/85 supports-backdrop-filter:bg-background/70 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link href="/" className="min-w-0">
            <BrandLogo />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {links.map(({ to, label, className }) => {
              const isActive = pathname === to;
              return (
                <Link
                  key={to}
                  href={to}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "text-muted-foreground hover:text-foreground px-2.5 py-1.5 text-xs font-medium transition-colors",
                    className,
                    isActive && "bg-muted text-foreground"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle />
          {session && <UserMenu />}
        </div>
      </div>
    </header>
  );
}
