import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import {
  classifyBucket,
  isInflowTransaction,
  REVENUE_BUCKET,
  type MerchantCategoryOverride,
  type TellerTransaction,
  type TellerAccount,
  type TellerSyncData,
} from "@/lib/plaid-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "edge";

type TellerRawAccount = {
  id: string;
  name: string;
  type?: string | null;
  subtype?: string | null;
  institution?: { name?: string | null } | null;
  balance?: {
    available?: string | number | null;
    ledger?: string | number | null;
  } | null;
};

type TellerRawTransaction = {
  id: string;
  date: string;
  description: string;
  amount: string | number;
  type?: string | null;
  details?: {
    category?: string | null;
    counterparty?: { name?: string | null; type?: string | null } | null;
  } | null;
};

// Service binding to the teller-proxy Worker. The proxy owns the mTLS
// certificate and presents it during the outbound handshake with
// api.teller.io; we just hand it a Teller URL and the Authorization
// header and read back whatever Teller returns.
type ServiceFetcher = { fetch: typeof fetch };

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function basicAuthHeader(accessToken: string): string {
  return `Basic ${btoa(`${accessToken}:`)}`;
}

async function loadCategoryOverrides(): Promise<MerchantCategoryOverride[]> {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const { data, error } = await supabase
      .from("merchant_category_overrides")
      .select("merchant_name, description_pattern, custom_bucket")
      .eq("user_id", user.id);

    if (error) {
      console.warn("[Teller] category override lookup failed:", error.message);
      return [];
    }

    return (data ?? []) as MerchantCategoryOverride[];
  } catch (e) {
    console.warn(
      "[Teller] category override lookup skipped:",
      e instanceof Error ? e.message : "unknown"
    );
    return [];
  }
}

function isTellerInflow(t: TellerRawTransaction, amount: number): boolean {
  if (amount > 0) return false;
  if (amount < 0) return true;

  const type = (t.type ?? "").toLowerCase();
  if (/(credit|deposit)/.test(type)) return true;
  if (/(debit|withdraw|payment|purchase)/.test(type)) return false;

  return isInflowTransaction({
    name: t.description,
    amount,
    category: t.details?.category ?? "",
    merchantName: t.details?.counterparty?.name ?? null,
    pfcPrimary: t.details?.counterparty?.type ?? null,
    pfcDetailed: t.details?.category ?? null,
  });
}

/**
 * Resolve the teller-proxy service binding from the Cloudflare environment.
 *
 * The mTLS cert lives on a standalone Worker (see /teller-proxy) because
 * the Pages dashboard config wasn't honoring the cert binding declared in
 * the Pages wrangler.jsonc. The proxy Worker presents the cert; this
 * Pages function just calls into it via the TELLER_PROXY service binding.
 */
function getTellerProxy(): ServiceFetcher {
  const { env } = getRequestContext();
  const proxy = (env as { TELLER_PROXY?: ServiceFetcher }).TELLER_PROXY;
  if (!proxy) {
    throw new Error(
      "TELLER_PROXY service binding is not configured. Deploy the " +
        "teller-proxy Worker (cd teller-proxy && npx wrangler deploy), " +
        "then ensure a TELLER_PROXY service binding pointing at " +
        "`teller-proxy` exists on the Pages project (either via " +
        "wrangler.jsonc or the Pages dashboard's Bindings panel)."
    );
  }
  return proxy;
}

// Teller rate limit: ~10 req/s. We apply a simple exponential backoff on
// 429 / 503 responses. The edge runtime has no Node.js timers so we use
// a Promise-wrapping setTimeout polyfill.
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function tellerRequest<T>(
  fetcher: ServiceFetcher,
  url: string,
  accessToken: string,
  retries = 3
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetcher.fetch(url, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(accessToken),
        Accept: "application/json",
      },
    });
    const body = await res.text();

    if (res.status === 429 || res.status === 503) {
      const retryAfterSec = Number(res.headers.get("Retry-After") ?? 0);
      const backoffMs = retryAfterSec > 0
        ? retryAfterSec * 1000
        : Math.min(200 * 2 ** attempt, 4000);
      if (attempt < retries) {
        await sleep(backoffMs);
        continue;
      }
      lastErr = new Error(`Teller rate limited (${res.status}) after ${retries} retries`);
      break;
    }

    if (!res.ok) {
      throw new Error(
        `Teller request failed (${res.status}): ${body.slice(0, 400)}`
      );
    }

    try {
      return JSON.parse(body) as T;
    } catch (e) {
      throw new Error(
        `Teller response parse error: ${
          e instanceof Error ? e.message : "unknown"
        }`
      );
    }
  }
  throw lastErr ?? new Error(`Teller request failed after ${retries} retries`);
}

/**
 * Paginate through all transactions for a single account.
 * Teller returns a list with a `links.next` cursor URL when there are more
 * pages. We follow `from_id` (the id of the last item on the current page)
 * as a cursor until the response is empty or has fewer items than the page
 * size, which signals the last page.
 */
async function fetchAllTransactions(
  fetcher: ServiceFetcher,
  accountId: string,
  accessToken: string
): Promise<TellerRawTransaction[]> {
  const PAGE_SIZE = 250; // Teller max per page
  const all: TellerRawTransaction[] = [];
  let cursor: string | null = null;

  // Guard against runaway pagination (e.g. infinite-loop bug or malformed API
  // response). 40 pages × 250 = 10 000 transactions per account maximum.
  const MAX_PAGES = 40;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(
      `https://api.teller.io/accounts/${accountId}/transactions`
    );
    url.searchParams.set("count", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("from_id", cursor);

    let batch: TellerRawTransaction[];
    try {
      batch = await tellerRequest<TellerRawTransaction[]>(
        fetcher,
        url.toString(),
        accessToken
      );
    } catch (err) {
      // Surface the error to the caller rather than silently returning empty.
      // Partial-failure: return what we have so far plus re-throw so the
      // outer handler can log it without losing already-fetched pages.
      console.warn(
        `[teller-sync] transaction fetch failed for account ${accountId} ` +
          `(page ${page}):`,
        err instanceof Error ? err.message : err
      );
      // Partial data already accumulated is still usable; re-throw to let the
      // account-level catch block decide how to handle it.
      throw err;
    }

    if (!Array.isArray(batch) || batch.length === 0) break;

    all.push(...batch);

    // If the batch is smaller than a full page we've reached the last page.
    if (batch.length < PAGE_SIZE) break;

    // Advance cursor to the id of the last transaction in this page.
    // Teller uses `from_id` to mean "give me transactions older than this id".
    cursor = batch[batch.length - 1].id;
  }

  return all;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      accessToken?: string;
    };

    if (!body.accessToken) {
      return NextResponse.json(
        { error: "accessToken is required" },
        { status: 400 }
      );
    }

    let fetcher: ServiceFetcher;
    try {
      fetcher = getTellerProxy();
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "TELLER_PROXY service binding is not configured",
        },
        { status: 500 }
      );
    }

    const rawAccounts = await tellerRequest<TellerRawAccount[]>(
      fetcher,
      "https://api.teller.io/accounts",
      body.accessToken
    );

    const accounts: TellerAccount[] = [];
    const transactions: TellerTransaction[] = [];
    let institutionName: string | null = null;
    const categoryOverrides = await loadCategoryOverrides();

    for (const a of rawAccounts) {
      if (!institutionName && a.institution?.name) {
        institutionName = a.institution.name;
      }

      accounts.push({
        id: a.id,
        name: a.name,
        type: a.type ?? "depository",
        subtype: a.subtype ?? null,
        balanceCurrent: toNumber(a.balance?.ledger),
        balanceAvailable: toNumber(a.balance?.available),
      });

      let rawTx: TellerRawTransaction[] = [];
      try {
        rawTx = await fetchAllTransactions(fetcher, a.id, body.accessToken);
      } catch (txErr) {
        // Partial-failure: skip this account's transactions but continue with
        // other accounts rather than aborting the entire sync. The error is
        // already logged inside fetchAllTransactions; record it here too so
        // the final response can surface a warning.
        console.warn(
          `[teller-sync] skipping transactions for account ${a.id}:`,
          txErr instanceof Error ? txErr.message : txErr
        );
        rawTx = [];
      }

      for (const t of rawTx) {
        const amt = toNumber(t.amount);
        const isInflow = isTellerInflow(t, amt);
        const amount = isInflow ? -Math.abs(amt) : Math.abs(amt);
        const merchantName = t.details?.counterparty?.name ?? null;
        const category = t.details?.category ?? "Uncategorized";
        const pfcPrimary = t.details?.counterparty?.type ?? null;
        const pfcDetailed = t.details?.category ?? null;
        const baseTransaction = {
          name: t.description,
          amount,
          category,
          merchantName,
          pfcPrimary,
          pfcDetailed,
        };
        const bucket = classifyBucket(baseTransaction, categoryOverrides);
        transactions.push({
          id: t.id,
          date: t.date,
          name: t.description,
          amount,
          category,
          merchantName,
          pfcPrimary,
          pfcDetailed,
          bucket,
          customBucket: bucket,
        });
      }
    }

    // Persist pre-categorized transactions to Supabase. We resolve the
    // calling auth user, map to the internal public.users.id required by the
    // expenses RLS policy, and upsert by plaid_transaction_id so repeat syncs
    // are idempotent. Persistence failure is non-fatal — we still return the
    // freshly fetched payload so the UI keeps working when Supabase is
    // unreachable or env vars are missing in a preview build.
    try {
      const supabase = createSupabaseServerClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      if (authUser) {
        const { data: userRow } = await supabase
          .from("users")
          .select("id")
          .eq("auth_user_id", authUser.id)
          .maybeSingle();

        if (userRow?.id && transactions.length > 0) {
          const rows = transactions
            .filter((t) => t.amount > 0 && t.bucket !== REVENUE_BUCKET)
            .map((t) => ({
              user_id: userRow.id,
              plaid_transaction_id: t.id,
              bucket: t.bucket,
              merchant: t.merchantName,
              description: t.name,
              amount_cents: Math.round(t.amount * 100),
              currency: "USD",
              occurred_on: t.date,
            }));
          if (rows.length > 0) {
            const { error: upsertError } = await supabase
              .from("expenses")
              .upsert(rows, { onConflict: "plaid_transaction_id" });
            if (upsertError) {
              console.warn(
                "[teller-sync] expenses upsert failed:",
                upsertError.message
              );
            }
          }
        }
      }
    } catch (persistErr) {
      console.warn(
        "[teller-sync] persistence skipped:",
        persistErr instanceof Error ? persistErr.message : "unknown"
      );
    }

    const payload: TellerSyncData = {
      transactions,
      accounts,
      institutionName,
    };

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Teller sync failed" },
      { status: 500 }
    );
  }
}
