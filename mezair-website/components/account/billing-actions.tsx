"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  createPortalAction,
  createCheckoutAction,
  reconcileAction,
  type ActionResult
} from "@/app/account/actions";
import type { HostedReconcileResult } from "@/lib/hosted/types";

type Pending = "portal" | "reconcile" | "checkout" | null;

export function BillingActions({ hasStripeCustomer, checkoutAvailable = false, hasSubscription = false }: {
  hasStripeCustomer: boolean; checkoutAvailable?: boolean; hasSubscription?: boolean;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<HostedReconcileResult | null>(null);

  async function run<T>(
    key: Exclude<Pending, null>,
    call: () => Promise<ActionResult<T>>,
    onOk: (data: T) => void
  ) {
    setPending(key);
    setError(null);
    try {
      const result = await call();
      if (result.ok) onOk(result.data);
      else setError(result.message);
    } catch {
      setError("Could not reach the account service. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {checkoutAvailable && !hasSubscription ? (
          <>
            <label className="grid gap-1 text-sm">
              <span className="sr-only">Billing interval</span>
              <select aria-label="Billing interval" className="min-h-11 rounded-md border bg-background px-3" value={interval}
                onChange={(event) => setInterval(event.target.value as "month" | "year")} disabled={pending !== null}>
                <option value="month">£8.99 monthly</option>
                <option value="year">£89.90 annually</option>
              </select>
            </label>
            <Button disabled={pending !== null} onClick={() => void run("checkout", () => createCheckoutAction(interval),
              (data) => window.location.assign(data.checkoutUrl))}>
              {pending === "checkout" ? "Opening checkout…" : "Subscribe to hosted Sync & Mesh"}
            </Button>
          </>
        ) : null}
        {hasStripeCustomer ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() =>
              void run("portal", createPortalAction, (data) => {
                window.location.assign(data.portalUrl);
              })
            }
          >
            {pending === "portal" ? "Opening…" : "Manage subscription"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          disabled={pending !== null}
          onClick={() =>
            void run("reconcile", reconcileAction, (data) => {
              setReconciled(data);
              router.refresh();
            })
          }
        >
          {pending === "reconcile" ? "Refreshing…" : "Refresh billing"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {reconciled ? (
        <p role="status" className="text-sm text-muted-foreground">
          Refreshed {reconciled.subscriptions} subscription record
          {reconciled.subscriptions === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}
