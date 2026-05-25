import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import type {
  TellerTransaction,
  TellerAccount,
  TellerSyncData,
} from "@/lib/plaid-types";

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

// Cloudflare's mTLS certificate binding exposes a Fetcher-like object whose
// .fetch() presents the bound client cert during the outbound TLS handshake.
type MtlsFetcher = { fetch: typeof fetch };

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function basicAuthHeader(accessToken: string): string {
  return `Basic ${btoa(`${accessToken}:`)}`;
}

/**
 * Resolve the Teller mTLS Fetcher from the Cloudflare environment.
 *
 * On Cloudflare Pages the cert/key are not passed as PEM env strings —
 * they are uploaded via `wrangler mtls-certificate upload` and surfaced as
 * a binding declared in wrangler.jsonc under `mtls_certificates`. The Web
 * `fetch()` API has no `cert`/`key` init option, so the binding's `.fetch`
 * is the only supported way to do client-cert auth from a Worker.
 */
function getTellerFetcher(): MtlsFetcher {
  const { env } = getRequestContext();
  const fetcher = (env as { TELLER_MTLS?: MtlsFetcher }).TELLER_MTLS;
  if (!fetcher) {
    throw new Error(
      "Teller mTLS binding is not configured. Upload the cert via " +
        "`wrangler mtls-certificate upload --cert certs/teller.crt --key certs/teller.key --name teller`, " +
        "then add a TELLER_MTLS binding under `mtls_certificates` in wrangler.jsonc."
    );
  }
  return fetcher;
}

async function tellerRequest<T>(
  fetcher: MtlsFetcher,
  url: string,
  accessToken: string
): Promise<T> {
  const res = await fetcher.fetch(url, {
    method: "GET",
    headers: {
      Authorization: basicAuthHeader(accessToken),
      Accept: "application/json",
    },
  });
  const body = await res.text();
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

    let fetcher: MtlsFetcher;
    try {
      fetcher = getTellerFetcher();
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "Teller mTLS binding is not configured",
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
        rawTx = await tellerRequest<TellerRawTransaction[]>(
          fetcher,
          `https://api.teller.io/accounts/${a.id}/transactions`,
          body.accessToken
        );
      } catch {
        rawTx = [];
      }

      for (const t of rawTx) {
        const amt = toNumber(t.amount);
        transactions.push({
          id: t.id,
          date: t.date,
          name: t.description,
          amount: -amt,
          category: t.details?.category ?? "Uncategorized",
          merchantName: t.details?.counterparty?.name ?? null,
          pfcPrimary: t.details?.counterparty?.type ?? null,
          pfcDetailed: t.details?.category ?? null,
        });
      }
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
