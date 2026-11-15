import { db } from "./db";
import { NotConfiguredError } from "./http";

/**
 * Stripe over the REST API (no SDK needed). The app's STRIPE_SECRET_KEY is a Connect platform key;
 * each seller connects their own Stripe account through Stripe-hosted onboarding (which collects
 * their identity, address and bank details), and payment links are created on that account so
 * buyers pay the seller directly.
 */
async function stripe<T>(method: "GET" | "POST", path: string, params: Record<string, string> = {}, account?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new NotConfiguredError("Stripe isn't set up: add a Stripe secret key (with Connect enabled) as STRIPE_SECRET_KEY in .env");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (account) headers["Stripe-Account"] = account;
  const body = method === "POST" ? new URLSearchParams(params) : undefined;
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe: ${json?.error?.message ?? `HTTP ${res.status}`}`);
  return json as T;
}

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

// ---------- Connected seller accounts ----------

export function connectedAccountId(sellerId: string | null): string | null {
  if (!sellerId) return null;
  const row = db.prepare("SELECT account_id FROM stripe_accounts WHERE seller_id = ?").get(sellerId) as { account_id: string } | undefined;
  return row?.account_id ?? null;
}

export function forgetConnectedAccount(sellerId: string) {
  db.prepare("DELETE FROM stripe_accounts WHERE seller_id = ?").run(sellerId);
}

export type ConnectStatus = {
  configured: boolean;
  connected: boolean;
  /** Onboarding finished and Stripe will accept payments for this seller. */
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  accountName: string | null;
};

export async function connectStatus(sellerId: string | null): Promise<ConnectStatus> {
  const none = { connected: false, chargesEnabled: false, detailsSubmitted: false, accountName: null };
  if (!stripeConfigured()) return { configured: false, ...none };
  const accountId = connectedAccountId(sellerId);
  if (!accountId) return { configured: true, ...none };
  const a = await stripe<{
    charges_enabled: boolean;
    details_submitted: boolean;
    email?: string | null;
    business_profile?: { name?: string | null };
  }>("GET", `/accounts/${accountId}`);
  return {
    configured: true,
    connected: true,
    chargesEnabled: a.charges_enabled,
    detailsSubmitted: a.details_submitted,
    accountName: a.business_profile?.name || a.email || null,
  };
}

/** Stripe-hosted onboarding link for this seller, creating their connected account the first time. */
export async function onboardingLink(sellerId: string, refreshUrl: string, returnUrl: string): Promise<string> {
  let accountId = connectedAccountId(sellerId);
  if (!accountId) {
    const a = await stripe<{ id: string }>("POST", "/accounts", { type: "standard" });
    accountId = a.id;
    db.prepare("INSERT OR REPLACE INTO stripe_accounts (seller_id, account_id, created_at) VALUES (?, ?, ?)").run(
      sellerId,
      accountId,
      Date.now(),
    );
  }
  const link = await stripe<{ url: string }>("POST", "/account_links", {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return link.url;
}

// ---------- Payment links ----------

/** A Payment Link for one item, created on the seller's connected account (a direct charge). */
export async function createPaymentLink(name: string, price: number, accountId: string): Promise<string> {
  const p = await stripe<{ id: string }>(
    "POST",
    "/prices",
    { currency: "usd", unit_amount: String(Math.round(price * 100)), "product_data[name]": name.slice(0, 250) },
    accountId,
  );
  const link = await stripe<{ url: string }>(
    "POST",
    "/payment_links",
    { "line_items[0][price]": p.id, "line_items[0][quantity]": "1" },
    accountId,
  );
  return link.url;
}
