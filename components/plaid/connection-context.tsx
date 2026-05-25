"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { TellerSyncData } from "@/lib/plaid-types";

export type TellerConnection = {
  connected: boolean;
  loading: boolean;
  institutionName: string | null;
  accessToken: string | null;
  tellerData: TellerSyncData | null;
  markConnected: (accessToken: string, institutionName: string | null) => void;
  setTellerData: (data: TellerSyncData) => void;
  setLoading: (v: boolean) => void;
  reset: () => void;
};

const Ctx = createContext<TellerConnection | null>(null);

export function TellerConnectionProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tellerData, setTellerData] = useState<TellerSyncData | null>(null);

  const markConnected = useCallback(
    (token: string, institution: string | null) => {
      setAccessToken(token);
      setInstitutionName(institution);
      setConnected(true);
    },
    []
  );

  const reset = useCallback(() => {
    setConnected(false);
    setAccessToken(null);
    setInstitutionName(null);
    setTellerData(null);
    setLoading(false);
  }, []);

  const value = useMemo<TellerConnection>(
    () => ({
      connected,
      loading,
      institutionName,
      accessToken,
      tellerData,
      markConnected,
      setTellerData,
      setLoading,
      reset,
    }),
    [connected, loading, institutionName, accessToken, tellerData, markConnected, reset]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTellerConnection(): TellerConnection {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useTellerConnection must be used inside <TellerConnectionProvider>"
    );
  }
  return ctx;
}

// Backwards-compatible aliases.
export const PlaidConnectionProvider = TellerConnectionProvider;
export const usePlaidConnection = useTellerConnection;
export type PlaidConnection = TellerConnection;
