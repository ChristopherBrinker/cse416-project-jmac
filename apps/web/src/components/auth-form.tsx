"use client";

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
    <main className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <form action={submit} className="max-w-sm space-y-4">
        {signUp && (
          <div className="space-y-2">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              autoComplete="name"
              required
              className="block w-full rounded border p-2"
            />
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="block w-full rounded border p-2"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={signUp ? "new-password" : "current-password"}
            minLength={8}
            maxLength={128}
            required
            className="block w-full rounded border p-2"
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <button
          className="rounded border px-4 py-2"
          type="submit"
          disabled={pending}
        >
          {pending ? "Please wait…" : title}
        </button>
      </form>
      <Link href={signUp ? "/sign-in" : "/sign-up"}>
        {signUp ? "Already have an account? Sign in" : "Create an account"}
      </Link>
    </main>
  );
}
