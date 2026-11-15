import { NextResponse } from "next/server";
import { connectedAccountId, createPaymentLink, stripeConfigured } from "@/lib/stripe";
import { sellerId } from "@/lib/seller";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";

/** A Stripe Payment Link on the seller's own connected account, so the buyer pays the seller. */
export async function POST(req: Request) {
  const body = await readJson<{ name?: string; price?: number }>(req);
  if (!body?.name || !(Number(body.price) > 0)) return badRequest("name and price are required");
  if (!stripeConfigured()) return NextResponse.json({ error: "Stripe isn't set up on this server (STRIPE_SECRET_KEY)" }, { status: 503 });
  const account = connectedAccountId(await sellerId());
  if (!account) return NextResponse.json({ error: "Connect your Stripe account first, so buyers pay you directly" }, { status: 409 });
  try {
    return NextResponse.json({ url: await createPaymentLink(body.name, Number(body.price), account) });
  } catch (err) {
    return serverError(err);
  }
}
