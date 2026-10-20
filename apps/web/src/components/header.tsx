"use client";
import { cn } from "@cse416-project-jmac/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import { BrandLogo } from "./brand-logo";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const NAV_LINK_CLASS_NAME =
  "text-muted-foreground hover:bg-muted hover:text-foreground rounded-full px-4 py-2 text-xs font-medium tracking-wider uppercase outline-offset-4 transition-colors";

export default function Header() {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
  ] as const;

  return (
    <header className="bg-background sticky top-0 z-40 border-b">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 sm:min-h-18 sm:flex-nowrap sm:px-6 sm:py-4">
        <Link href="/" className="rounded-sm outline-offset-4">
          <BrandLogo />
        </Link>
        <nav
          aria-label="Main"
          className="order-last flex w-full items-center gap-1 sm:order-none sm:w-auto"
        >
          {links.map(({ to, label }) => {
            const isActive = pathname === to;
            return (
              <Link
                key={to}
                href={to}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  NAV_LINK_CLASS_NAME,
                  isActive && "bg-muted text-foreground"
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ModeToggle />
          {session ? (
            <UserMenu />
          ) : (
            !isPending && (
              <Link
                href="/sign-in"
                aria-current={pathname === "/sign-in" ? "page" : undefined}
                className={cn(
                  NAV_LINK_CLASS_NAME,
                  "hidden sm:inline-flex",
                  pathname === "/sign-in" && "bg-muted text-foreground"
                )}
              >
                Sign in
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}
