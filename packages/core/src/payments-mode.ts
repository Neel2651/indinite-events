/**
 * How checkout takes payment.
 * - "stripe": real Checkout Session; tickets issued only from the verified webhook.
 * - "demo":   development only. Checkout skips Stripe and marks the order paid straight away through the
 *             same fulfilment service the webhook uses, so the rest of the flow (tickets, email, scan) runs.
 */
export type PaymentsMode = "stripe" | "demo";

/** "live" unless DEPLOY_ENV=staging (a demo server for client testing). */
export function isStaging(env: Record<string, string | undefined>): boolean {
  return (env.DEPLOY_ENV ?? "").trim().toLowerCase() === "staging";
}

/**
 * Pure so it can be tested; pass `process.env`. Demo payments are refused on a production build unless the
 * server is explicitly a staging/demo server (DEPLOY_ENV=staging), so the live site can never skip payment.
 */
export function resolvePaymentsMode(env: { PAYMENTS_MODE?: string; NODE_ENV?: string; DEPLOY_ENV?: string }): PaymentsMode {
  const mode = (env.PAYMENTS_MODE ?? "stripe").trim().toLowerCase();
  if (mode !== "stripe" && mode !== "demo") throw new Error(`PAYMENTS_MODE must be "stripe" or "demo", got "${env.PAYMENTS_MODE}"`);
  if (mode === "demo" && env.NODE_ENV === "production" && !isStaging(env)) {
    throw new Error("PAYMENTS_MODE=demo is not allowed on a live server (NODE_ENV=production without DEPLOY_ENV=staging)");
  }
  return mode;
}
