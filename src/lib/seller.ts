import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * There are no logins, so a seller is identified by an anonymous, httpOnly cookie. It is what a
 * connected Stripe account is tied to, so each browser connects its own account.
 */
const COOKIE = "agentshop_seller";

export async function sellerId(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function ensureSellerId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;
  const id = crypto.randomUUID();
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 3600,
    secure: process.env.NODE_ENV === "production",
  });
  return id;
}
