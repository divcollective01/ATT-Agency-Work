import Stripe from "stripe";

/**
 * Edge-runtime safe Stripe client.
 *
 * Stripe's Node SDK works on Cloudflare Workers / Next Edge if you swap the
 * default http client for the fetch-based one. `httpClient` + a Web crypto
 * provider are the two pieces it needs in non-Node environments.
 */
export function getStripeClient(): Stripe {
  const key =
    process.env.STRIPE_SECRET_KEY ||
    (typeof process !== "undefined" ? process.env.STRIPE_SECRET_KEY : undefined);
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");

  return new Stripe(key, {
    apiVersion: "2026-05-27.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
    typescript: true,
  });
}

export type SurchargeLineItem = {
  description: string;
  amountCents: number;   // already in smallest currency unit
  currency?: string;     // default usd
  metadata?: Record<string, string>;
};
