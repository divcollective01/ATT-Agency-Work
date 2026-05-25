import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import https from "https";
import type {
  TellerTransaction,
  TellerAccount,
  TellerSyncData,
} from "@/lib/plaid-types";

export const runtime = "nodejs";

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

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function basicAuthHeader(accessToken: string): string {
  const raw = `${accessToken}:`;
  const encoded = Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

function tellerRequest<T>(
  url: string,
  accessToken: string,
  cert: Buffer,
  key: Buffer
): Promise<T> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        host: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        cert,
        key,
        headers: {
          Authorization: basicAuthHeader(accessToken),
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            try {
              resolve(JSON.parse(body) as T);
            } catch (e) {
              reject(
                new Error(
                  `Teller response parse error: ${
                    e instanceof Error ? e.message : "unknown"
                  }`
                )
              );
            }
          } else {
            reject(
              new Error(`Teller request failed (${status}): ${body.slice(0, 400)}`)
            );
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
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

    const certPath = process.env.TELLER_CERT_PATH;
    const keyPath = process.env.TELLER_KEY_PATH;
    if (!certPath || !keyPath) {
      return NextResponse.json(
        { error: "Teller mTLS certificate paths are not configured" },
        { status: 500 }
      );
    }

    const cert = fs.readFileSync(path.resolve(process.cwd(), certPath));
    const key = fs.readFileSync(path.resolve(process.cwd(), keyPath));

    const rawAccounts = await tellerRequest<TellerRawAccount[]>(
      "https://api.teller.io/accounts",
      body.accessToken,
      cert,
      key
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
          `https://api.teller.io/accounts/${a.id}/transactions`,
          body.accessToken,
          cert,
          key
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
