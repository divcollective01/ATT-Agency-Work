import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COPY } from "@/lib/copy";
import { LoginForm } from "./login-form";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: { error?: string; mode?: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user && !user.is_anonymous) {
    redirect("/");
  }

  const initialMode = searchParams?.mode === "signin" ? "signin" : "signup";
  const initialError = searchParams?.error;
  const isAnonymous = Boolean(user?.is_anonymous);

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="size-12 rounded-2xl bg-vibrant flex items-center justify-center text-cocoa-950 shadow-glow">
            <ShieldCheck className="size-6" />
          </div>
          <p className="font-display text-2xl mt-4 tracking-tight">{COPY.brand}</p>
          <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute mt-1">
            ATT Agency
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {initialMode === "signup" ? "Create your account" : "Welcome back"}
            </CardTitle>
            <CardDescription>
              {isAnonymous && initialMode === "signup"
                ? "Save your tracked materials, expenses, and forecasts to a permanent account."
                : initialMode === "signup"
                ? "Set up a Profit Shield account to defend your margin."
                : "Sign in to your Profit Shield account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm initialMode={initialMode} initialError={initialError} />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-cream-mute">
          Back to <Link href="/" className="text-cream underline-offset-4 hover:underline">dashboard</Link>
        </p>
      </div>
    </div>
  );
}
