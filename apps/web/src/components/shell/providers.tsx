"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ApiError, signInPath } from "@/lib/api";

function onError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401 && window.location.pathname !== "/sign-in") {
    window.location.assign(signInPath());
  }
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        onError,
        shouldRetryOnError: (error: unknown) => !(error instanceof ApiError && error.status >= 400 && error.status < 500),
        errorRetryCount: 3,
      }}
    >
      {children}
    </SWRConfig>
  );
}
