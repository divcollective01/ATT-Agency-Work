"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string } | undefined;

function readCredentials(formData: FormData): { email: string; password: string } | string {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return "Email and password are required.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  return { email, password };
}

/**
 * Origin used to build absolute redirect URLs for Supabase auth flows.
 * Prefers NEXT_PUBLIC_SITE_URL (set per-environment in Cloudflare Pages
 * and in .env.local) and falls back to the inbound request's forwarded
 * host so local dev and preview deploys work without extra config.
 *
 * Use this for flows where landing on the host that initiated the request
 * is acceptable (e.g. signup email confirmation while testing locally).
 */
function getOrigin(): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (envOrigin) return envOrigin;
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

/**
 * Strict site URL for production-only email redirects. Reset emails must
 * never link to localhost because the recipient is rarely the same machine
 * that triggered the request. We require NEXT_PUBLIC_SITE_URL and fail
 * loudly otherwise rather than silently emailing a useless localhost link.
 */
function requireProductionSiteUrl(): string | null {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? null;
}

/**
 * Upgrade the current anonymous session into a permanent email/password
 * account. Because we call updateUser on the existing session, auth.uid()
 * stays the same — all foreign-key rows (materials, expenses, forecasts)
 * remain attached to the same public.users row.
 *
 * If there is no current session (e.g. a logged-out visitor on /login),
 * we fall back to signUp so they still get an account. When email
 * confirmation is enabled in Supabase, signUp returns a user with no
 * session — we surface a "check your email" message instead of redirecting.
 */
export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = readCredentials(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const origin = getOrigin();
  const emailRedirectTo = `${origin}/auth/callback?next=/`;

  if (user?.is_anonymous) {
    const { data: updated, error } = await supabase.auth.updateUser(
      { email: parsed.email, password: parsed.password },
      { emailRedirectTo }
    );
    if (error) return { error: error.message };

    // With "Confirm email" OFF, Supabase flips is_anonymous to false right
    // away — land the user on the dashboard. With it ON, the session stays
    // anonymous (their existing materials/expenses keep working) until they
    // click the link, so we tell them to check their inbox.
    if (updated.user && updated.user.is_anonymous === false) {
      revalidatePath("/", "layout");
      redirect("/");
    }

    revalidatePath("/", "layout");
    return {
      message:
        "Check your email to confirm your new account. Your tracked data stays on this device until you do."
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email: parsed.email,
    password: parsed.password,
    options: { emailRedirectTo }
  });
  if (error) return { error: error.message };

  // Supabase returns a user with an empty identities array when the email
  // is already registered (so we don't leak account existence). Surface a
  // generic hint rather than silently succeeding.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { error: "An account with this email already exists. Try signing in instead." };
  }

  // user.identities present but no session → email confirmation is on and
  // the user hasn't clicked the link yet.
  if (data.user && !data.session) {
    return { message: "Check your email to verify your account before signing in." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = readCredentials(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.email,
    password: parsed.password
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Send a password-reset email. The link Supabase emails lands on
 * /auth/callback with a one-time code (or token_hash, depending on the
 * project's email template), which we exchange and then route the user
 * to /update-password to enter a new password.
 */
export async function resetPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Email is required." };

  const siteUrl = requireProductionSiteUrl();
  if (!siteUrl) {
    return {
      error:
        "Server is missing NEXT_PUBLIC_SITE_URL — set it to the production URL in Cloudflare Pages (Settings → Environment Variables) and in .env.local so reset emails always land on production."
    };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=/update-password`
  });
  if (error) return { error: error.message };

  return {
    message: "If an account exists for that email, a reset link is on its way."
  };
}

/**
 * Finalize a password reset.
 *
 * Security model — why this action can only ever change the password of
 * the user who actually clicked the recovery link in their email:
 *
 *   1. supabase.auth.getUser() round-trips the access token to Supabase
 *      Auth and verifies its JWT signature. We are NOT trusting raw
 *      cookies that client-side script could spoof; the returned `user`
 *      reflects the real identity bound to a Supabase-signed JWT.
 *
 *   2. That JWT can only have been minted by one of two paths we
 *      control:
 *        (a) app/auth/callback/route.ts handing a one-time `code` /
 *            `token_hash` from the recovery email to
 *            exchangeCodeForSession / verifyOtp, or
 *        (b) the Supabase browser client consuming the implicit-flow
 *            hash fragment from the same recovery email and firing
 *            PASSWORD_RECOVERY.
 *      In both paths the token was just issued to the address that owns
 *      the inbox, so updateUser({ password }) can only rewrite that
 *      user's password — never anyone else's.
 *
 *   3. Anonymous sessions are rejected explicitly. They're valid
 *      Supabase users but have no email, so attaching a password would
 *      create a credential nobody can sign back into.
 *
 *   4. Supabase invalidates the user's other refresh tokens on
 *      successful password change, severing any stale or attacker-
 *      planted sessions the moment the update lands.
 */
export async function updatePassword(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!password || !confirm) return { error: "Please fill in both fields." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user || user.is_anonymous) {
    return {
      error: "Your reset link is invalid or has expired. Request a new one."
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/");
}
