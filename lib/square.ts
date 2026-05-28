/**
 * Edge-runtime safe Square API client. Square's official SDK is Node-only,
 * so we hit the REST endpoints directly with `fetch`.
 *
 * Square Connect API base — production. For Square sandbox tokens point at
 * https://connect.squareupsandbox.com instead.
 */
const SQUARE_BASE = "https://connect.squareup.com/v2";
const SQUARE_VERSION = "2025-09-24";

function getToken(): string {
  const tok =
    process.env.SQUARE_ACCESS_TOKEN ||
    (typeof process !== "undefined" ? process.env.SQUARE_ACCESS_TOKEN : undefined);
  if (!tok) throw new Error("SQUARE_ACCESS_TOKEN missing");
  return tok;
}

async function squareFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    ...init,
    headers: {
      "Square-Version": SQUARE_VERSION,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json()) as any;
  if (!res.ok) {
    const errMsg =
      json?.errors?.[0]?.detail ??
      json?.errors?.[0]?.code ??
      `Square error ${res.status}`;
    throw new Error(errMsg);
  }
  return json as T;
}

export type SquareLocation = { id: string; name: string; status?: string };
export type SquareCustomer = { id: string; name: string; email: string | null };

export async function squareListLocations(): Promise<SquareLocation[]> {
  const data = await squareFetch<{ locations?: Array<{ id: string; name: string; status?: string }> }>(
    "/locations",
    { method: "GET" }
  );
  return (data.locations ?? []).map((l) => ({ id: l.id, name: l.name, status: l.status }));
}

export async function squareListCustomers(query?: string): Promise<SquareCustomer[]> {
  if (query) {
    const data = await squareFetch<{ customers?: any[] }>("/customers/search", {
      method: "POST",
      body: JSON.stringify({
        query: {
          filter: {
            email_address: { fuzzy: query },
          },
        },
        limit: 25,
      }),
    });
    return (data.customers ?? []).map((c: any) => ({
      id: c.id,
      name: [c.given_name, c.family_name].filter(Boolean).join(" ") || c.company_name || c.email_address || c.id,
      email: c.email_address ?? null,
    }));
  }
  const data = await squareFetch<{ customers?: any[] }>("/customers?limit=25&sort_field=CREATED_AT&sort_order=DESC", {
    method: "GET",
  });
  return (data.customers ?? []).map((c: any) => ({
    id: c.id,
    name: [c.given_name, c.family_name].filter(Boolean).join(" ") || c.company_name || c.email_address || c.id,
    email: c.email_address ?? null,
  }));
}

export type SquareSurchargeItem = {
  description: string;
  amountCents: number; // smallest currency unit
  currency?: string;   // default USD
};

/**
 * Square invoice push flow:
 *  1. Create an Order on the chosen location with one ad-hoc line per surcharge.
 *  2. Create a draft Invoice on that Order targeted at the customer. The
 *     business owner finalizes / sends from the Square dashboard.
 *
 * Idempotency keys protect against duplicate pushes on retry.
 */
export async function squarePushSurcharges(opts: {
  locationId: string;
  customerId: string;
  items: SquareSurchargeItem[];
}): Promise<{ orderId: string; invoiceId: string; publicUrl: string | null }> {
  const currency = opts.items[0]?.currency ?? "USD";
  const idempBase = `att-ps-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const orderRes = await squareFetch<{ order: { id: string } }>("/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `${idempBase}-order`,
      order: {
        location_id: opts.locationId,
        customer_id: opts.customerId,
        line_items: opts.items
          .filter((i) => Number.isFinite(i.amountCents) && i.amountCents > 0)
          .map((i) => ({
            name: i.description,
            quantity: "1",
            base_price_money: {
              amount: Math.round(i.amountCents),
              currency: i.currency ?? currency,
            },
          })),
        state: "OPEN",
      },
    }),
  });

  const orderId = orderRes.order.id;

  const invRes = await squareFetch<{ invoice: { id: string; public_url?: string | null } }>("/invoices", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `${idempBase}-inv`,
      invoice: {
        location_id: opts.locationId,
        order_id: orderId,
        primary_recipient: { customer_id: opts.customerId },
        delivery_method: "EMAIL",
        payment_requests: [
          {
            request_type: "BALANCE",
            due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10),
          },
        ],
        title: "Profit Shield — FRED PPI 90-day exposure surcharge",
      },
    }),
  });

  return {
    orderId,
    invoiceId: invRes.invoice.id,
    publicUrl: invRes.invoice.public_url ?? null,
  };
}

export async function squareValidate(): Promise<{ accountName: string }> {
  // Locations list is the canonical "is my token good" call — it requires
  // MERCHANT_PROFILE_READ and is the first thing any Square integration does.
  const locs = await squareListLocations();
  if (locs.length === 0) {
    throw new Error("Token valid but merchant has no locations");
  }
  return { accountName: locs[0].name };
}
