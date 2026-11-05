"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Wordmark } from "@/components/shell/app-shell";
import { Button, FieldLabel, inputClass } from "@/components/ui";
import { errorMessage, sendJson } from "@/lib/api";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/shipments";
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await sendJson("POST", "/v1/auth/session", { accessCode: String(form.get("accessCode") ?? ""), name: String(form.get("name") ?? "").trim() || undefined });
      router.replace(safeNext(params.get("next")));
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-[380px]">
      <Wordmark />
      <h1 className="mt-8 font-serif text-[2rem] font-medium leading-[1.1] tracking-[-0.015em] text-ink">Open the Workbench</h1>
      <p className="mt-3 max-w-[34ch] text-[0.9375rem] leading-relaxed text-ink-2">
        See what arrived, what differed, who is acting and what changed on every shipment Reissue is checking.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4 rounded-[10px] border border-line bg-surface p-5" aria-describedby={error ? "sign-in-error" : undefined}>
        <div>
          <FieldLabel htmlFor="accessCode">Access code</FieldLabel>
          <input id="accessCode" name="accessCode" type="password" required autoComplete="current-password" className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="name" hint="(shown on actions you take)">
            Your name
          </FieldLabel>
          <input id="name" name="name" type="text" required maxLength={60} autoComplete="name" className={inputClass} />
        </div>
        {error ? (
          <p id="sign-in-error" role="alert" className="rounded-[6px] bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
