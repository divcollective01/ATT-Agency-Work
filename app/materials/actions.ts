"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COMMODITY_CATALOG } from "@/lib/fred";

const VALID_CODES = new Set(COMMODITY_CATALOG.map((c) => c.code));

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createMaterial(formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || "unit";
  const baselineRaw = formData.get("baseline_cost");
  const baseline = typeof baselineRaw === "string" ? Number(baselineRaw) : NaN;
  const qtyRaw = formData.get("quantity");
  const quantity = typeof qtyRaw === "string" && qtyRaw.length > 0 ? Number(qtyRaw) : 1;
  const mode = String(formData.get("tracking_mode") ?? "fred").trim();
  const code = String(formData.get("fred_ppi_code") ?? "").trim();
  const volRaw = formData.get("custom_volatility_pct");
  const volatility = typeof volRaw === "string" && volRaw.length > 0 ? Number(volRaw) : NaN;

  if (!name) return { ok: false, error: "Material name is required." };
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return { ok: false, error: "Baseline cost must be a positive number." };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: "Quantity must be a positive number." };
  }

  let payload: Record<string, unknown>;

  if (mode === "custom") {
    if (!Number.isFinite(volatility)) {
      return { ok: false, error: "Enter a projected annual cost volatility %." };
    }
    payload = {
      name,
      unit,
      quantity,
      baseline_cost: baseline,
      tracking_mode: "custom",
      fred_ppi_code: null,
      custom_volatility_pct: volatility,
    };
  } else {
    if (!VALID_CODES.has(code)) {
      return { ok: false, error: "Pick a commodity from the dropdown." };
    }
    payload = {
      name,
      unit,
      quantity,
      baseline_cost: baseline,
      tracking_mode: "fred",
      fred_ppi_code: code,
      custom_volatility_pct: null,
    };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("material_costs").insert(payload);

  if (error) {
    console.error("[materials] insert error:", error.message);
    return { ok: false, error: error.message };
  }

  revalidatePath("/materials");
  revalidatePath("/forecast");
  return { ok: true };
}

export async function deleteMaterial(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "Missing material id." };

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("material_costs").delete().eq("id", id);

  if (error) {
    console.error("[materials] delete error:", error.message);
    return { ok: false, error: error.message };
  }

  revalidatePath("/materials");
  revalidatePath("/forecast");
  return { ok: true };
}
