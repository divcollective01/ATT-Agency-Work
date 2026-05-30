"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp, type AuthMode, type AuthState } from "@/app/auth/actions";

type Mode = AuthMode;

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" disabled={pending} className="w-full">
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {mode === "signup" ? "Creating account…" : "Signing in…"}
        </>
      ) : mode === "signup" ? (
        "Create account"
      ) : (
        "Sign in"
      )}
    </Button>
  );
}

export function LoginForm({
  initialMode,
  initialError
}: {
  initialMode: Mode;
  initialError?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  // Keep a separate state per action so the banner from a previous
  // signup attempt ("Check your email…") doesn't bleed into the
  // signin view and vice versa.
  const [signinState, signinAction] = useFormState<AuthState, FormData>(
    signIn,
    initialMode === "signin" && initialError ? { error: initialError } : undefined
  );
  const [signupState, signupAction] = useFormState<AuthState, FormData>(
    signUp,
    initialMode === "signup" && initialError ? { error: initialError } : undefined
  );

  const state = mode === "signin" ? signinState : signupState;
  const formAction = mode === "signin" ? signinAction : signupAction;

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          {mode === "signin" ? (
            <Link
              href="/forgot-password"
              className="text-[11px] uppercase tracking-[0.18em] text-cream-mute hover:text-cream underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          ) : null}
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder="At least 6 characters"
          minLength={6}
          required
        />
      </div>

      {state?.error ? (
        <div
          role="alert"
          className="space-y-3 rounded-2xl border border-hotpink/40 bg-hotpink/10 px-4 py-3 text-sm text-hotpink"
        >
          <p>{state.error}</p>
          {state.suggestedMode === "signin" && mode !== "signin" ? (
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="text-cream underline-offset-4 hover:underline focus:outline-none focus-visible:underline"
            >
              Switch to Sign In
            </button>
          ) : null}
        </div>
      ) : null}

      {state?.message ? (
        <p
          role="status"
          className="rounded-2xl border border-vibrant/40 bg-vibrant/10 px-4 py-3 text-sm text-cream"
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton mode={mode} />

      <div className="hairline-divider" />

      <p className="text-center text-sm text-cream-mute">
        {mode === "signup" ? "Already have an account?" : "New to Profit Shield?"}{" "}
        <button
          type="button"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          className="text-cream underline-offset-4 hover:underline focus:outline-none focus-visible:underline"
        >
          {mode === "signup" ? "Sign in" : "Create an account"}
        </button>
      </p>
    </form>
  );
}
