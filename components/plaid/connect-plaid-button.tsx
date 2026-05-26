"use client";

import { useCallback, useState } from "react";
import { Check, Plug, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useTellerConnection } from "./connection-context";

type TellerEnrollment = {
  accessToken: string;
  enrollment?: {
    institution?: { name?: string | null } | null;
  } | null;
  user?: { id?: string | null } | null;
};

type TellerConnectInstance = {
  open: () => void;
};

type TellerConnectSetupOptions = {
  applicationId: string;
  environment: "sandbox" | "development" | "production";
  products: string[];
  onSuccess: (enrollment: TellerEnrollment) => void | Promise<void>;
  onExit?: () => void;
  onFailure?: (failure: { message?: string }) => void;
};

declare global {
  interface Window {
    TellerConnect?: {
      setup: (opts: TellerConnectSetupOptions) => TellerConnectInstance;
    };
  }
}

type Props = {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  label?: string;
  className?: string;
};

export function ConnectTellerButton({
  variant = "primary",
  size = "lg",
  label = "Connect Bank with Teller",
  className
}: Props) {
  const {
    connected,
    loading: syncLoading,
    institutionName,
    markConnected,
    syncTellerData,
  } = useTellerConnection();

  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(() => {
    if (connected) return;
    setError(null);

    if (typeof window === "undefined" || !window.TellerConnect) {
      setError("Teller Connect script is still loading. Try again in a moment.");
      return;
    }

    const appId = process.env.NEXT_PUBLIC_TELLER_APP_ID;
    if (!appId) {
      setError("Missing NEXT_PUBLIC_TELLER_APP_ID environment variable.");
      return;
    }

    setOpening(true);

    const tellerConnect = window.TellerConnect.setup({
      applicationId: appId,
      environment: "development",
      products: ["balance", "transactions"],
      onSuccess: async function (enrollment: TellerEnrollment) {
        const institution = enrollment.enrollment?.institution?.name ?? null;
        markConnected(enrollment.accessToken, institution);
        setOpening(false);
        try {
          await syncTellerData(enrollment.accessToken);
        } catch (e) {
          console.warn("[Teller] sync error:", e);
          setError(e instanceof Error ? e.message : "Teller sync failed");
        }
      },
      onExit: () => {
        setOpening(false);
      },
      onFailure: (failure) => {
        setOpening(false);
        setError(failure?.message ?? "Teller Connect failed.");
      },
    });

    tellerConnect.open();
  }, [connected, markConnected, syncTellerData]);

  if (connected) {
    return (
      <Button variant="outline" size={size} className={className} disabled>
        {syncLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
        {syncLoading
          ? "Syncing transactions…"
          : institutionName
          ? `Connected · ${institutionName}`
          : "Bank connected"}
      </Button>
    );
  }

  return (
    <div className="inline-flex flex-col items-start gap-2">
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={handleClick}
        disabled={opening}
      >
        {opening ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plug className="size-4" />
        )}
        {opening ? "Opening Teller…" : label}
      </Button>
      {error && (
        <p className="text-xs text-hotpink-soft max-w-xs leading-snug">{error}</p>
      )}
    </div>
  );
}

// Backwards-compatible alias.
export const ConnectPlaidButton = ConnectTellerButton;
