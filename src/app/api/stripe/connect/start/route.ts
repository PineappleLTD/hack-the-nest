import { NextResponse } from "next/server";
import { onboardingLink } from "@/lib/stripe";
import { ensureSellerId } from "@/lib/seller";

export const runtime = "nodejs";

/**
 * Navigate here to connect (or finish connecting) a Stripe account. Redirects to Stripe-hosted
 * onboarding; Stripe sends the seller back to /?stripe=return. Stripe also uses this URL to issue a
 * fresh link if the old one expires. On failure, redirects to /?stripe=error&message=...
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  try {
    const seller = await ensureSellerId();
    const url = await onboardingLink(seller, `${origin}/api/stripe/connect/start`, `${origin}/?stripe=return`);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't connect Stripe";
    console.error("[stripe:connect]", message);
    return NextResponse.redirect(`${origin}/?stripe=error&message=${encodeURIComponent(message)}`, 303);
  }
}
