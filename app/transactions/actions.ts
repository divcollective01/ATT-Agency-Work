"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CATEGORY_BUCKETS, type ExpenseCategory } from "@/lib/plaid-types";

export type ActionResult = { ok: true } | { ok: false; error: string };

type TransactionOverrideInput = {
  merchantName?: string | null;
  description?: string | null;
  customBucket: string;
};

const VALID_BUCKETS = new Set<string>(CATEGORY_BUCKETS);

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function currentUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error("[transactions] auth lookup error:", error.message);
    return null;
  }

  return user?.id ?? null;
}

function revalidateTransactionViews() {
  revalidatePath("/");
  revalidatePath("/inflation");
}

export async function setTransactionCategoryOverride(
  input: TransactionOverrideInput
): Promise<ActionResult> {
  const merchantName = clean(input.merchantName);
  const descriptionPattern = clean(input.description);
  const customBucket = clean(input.customBucket);

  if (!customBucket || !VALID_BUCKETS.has(customBucket)) {
    return { ok: false, error: "Pick a valid category bucket." };
  }

  if (!merchantName && !descriptionPattern) {
    return { ok: false, error: "Missing merchant or transaction description." };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to save category overrides." };

  const supabase = createSupabaseServerClient();
  const payload = {
    user_id: userId,
    merchant_name: merchantName ?? null,
    description_pattern: merchantName ? null : descriptionPattern,
    custom_bucket: customBucket as ExpenseCategory,
  };

  // Use upsert on the unique partial index so the operation is atomic and
  // idempotent. Concurrent calls with the same key converge to the latest
  // custom_bucket rather than creating duplicate rows or racing on
  // delete+insert.
  const conflictCol = merchantName ? "merchant_name" : "description_pattern";
  const { error } = await supabase
    .from("merchant_category_overrides")
    .upsert(payload, { onConflict: `user_id,${conflictCol}`, ignoreDuplicates: false });

  if (error) {
    console.error("[transactions] override upsert error:", error.message);
    return { ok: false, error: error.message };
  }

  revalidateTransactionViews();
  return { ok: true };
}

export async function removeTransactionCategoryOverride(input: {
  merchantName?: string | null;
  description?: string | null;
}): Promise<ActionResult> {
  const merchantName = clean(input.merchantName);
  const descriptionPattern = clean(input.description);

  if (!merchantName && !descriptionPattern) {
    return { ok: false, error: "Missing merchant or transaction description." };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to remove category overrides." };

  const supabase = createSupabaseServerClient();
  const deleteQuery = supabase
    .from("merchant_category_overrides")
    .delete()
    .eq("user_id", userId);

  const { error } = merchantName
    ? await deleteQuery.eq("merchant_name", merchantName)
    : await deleteQuery.eq("description_pattern", descriptionPattern);

  if (error) {
    console.error("[transactions] override delete error:", error.message);
    return { ok: false, error: error.message };
  }

  revalidateTransactionViews();
  return { ok: true };
}
