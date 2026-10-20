"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import { Input } from "@cse416-project-jmac/ui/components/input";
import { Label } from "@cse416-project-jmac/ui/components/label";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function AuthForm({ signUp = false }: { signUp?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const title = signUp ? "Create account" : "Sign in";

  const submit = async (formData: FormData) => {
    setPending(true);
    setError(null);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    try {
      const result = signUp
        ? await authClient.signUp.email({
            email,
            password,
            name: String(formData.get("name") ?? ""),
          })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Authentication failed. Try again.");
        setPending(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    }
    setPending(false);
  };

  return (
    <main className="mx-auto grid w-full max-w-7xl items-center gap-10 px-5 py-14 sm:gap-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-20">
      <div>
        <h1 className="max-w-xl text-4xl leading-[1.06] font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
          {signUp ? "Your next benchmark starts here." : "Welcome back."}
        </h1>
        <p className="text-muted-foreground mt-6 max-w-md text-base leading-relaxed sm:text-lg">
          {signUp
            ? "Create an account to compare AI models on your private datasets."
            : "Sign in to manage your evaluations and pick up where you left off."}
        </p>
      </div>
      <form
        action={submit}
        aria-labelledby="auth-title"
        aria-busy={pending}
        className="bg-card w-full max-w-md space-y-5 rounded-xl border p-6 sm:p-8 lg:max-w-none"
      >
        <h2
          id="auth-title"
          className="mb-7 text-2xl font-semibold tracking-tight"
        >
          {title}
        </h2>
        {signUp && (
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm">
              Name
            </Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Your name"
              required
              className="h-12 rounded-lg px-4 text-base md:text-sm"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            className="h-12 rounded-lg px-4 text-base md:text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm">
            Password
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={signUp ? "new-password" : "current-password"}
            minLength={8}
            maxLength={128}
            required
            aria-describedby={signUp ? "password-hint" : undefined}
            className="h-12 rounded-lg px-4 text-base md:text-sm"
          />
          {signUp && (
            <p id="password-hint" className="text-muted-foreground text-xs">
              Use 8–128 characters.
            </p>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
          >
            {error}
          </p>
        )}
        <Button
          className="focus-visible:ring-offset-background h-12 w-full justify-between gap-4 rounded-lg bg-[#744c70] px-5 text-sm text-white hover:bg-[#603e5d] focus-visible:ring-2 focus-visible:ring-[#744c70] focus-visible:ring-offset-2 dark:bg-[#c7a3c4] dark:text-[#211a23] dark:hover:bg-[#d6b7d3] dark:focus-visible:ring-[#c7a3c4]"
          type="submit"
          disabled={pending}
        >
          {pending ? "Please wait…" : title}
          <ArrowUpRight aria-hidden="true" />
        </Button>
        <p className="text-muted-foreground border-t pt-5 text-sm leading-6">
          {signUp ? "Already have an account? " : "New here? "}
          <Link
            className="text-foreground rounded-sm font-medium underline underline-offset-4 outline-offset-4 hover:no-underline"
            href={signUp ? "/sign-in" : "/sign-up"}
          >
            {signUp ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </form>
    </main>
  );
}
