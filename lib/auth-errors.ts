import type { AuthError } from "@supabase/supabase-js";

type AuthErrorLike = {
  code?: AuthError["code"];
  message: string;
  status?: AuthError["status"];
};

export const EMAIL_EXISTS_SIGNIN_MESSAGE =
  "An account with this email already exists. Switch to the Sign In tab to continue.";

export function isEmailExistsError(error: AuthErrorLike): boolean {
  const message = error.message.toLowerCase();
  return (
    error.code === "email_exists" ||
    (error.status === 422 &&
      message.includes("email") &&
      (message.includes("exists") ||
        message.includes("registered") ||
        message.includes("already"))) ||
    message.includes("email already exists") ||
    message.includes("already registered")
  );
}

export function loginErrorRedirectUrl(origin: string, message: string): string {
  const params = new URLSearchParams({
    error: message,
    mode: "signin"
  });
  return `${origin}/login?${params.toString()}`;
}
