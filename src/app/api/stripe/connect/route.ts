import { NextResponse } from "next/server";
import { connectStatus, forgetConnectedAccount } from "@/lib/stripe";
import { sellerId } from "@/lib/seller";
import { serverError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * GET: this browser's Stripe connection.
 * { configured, connected, chargesEnabled, detailsSubmitted, accountName }
 * To connect, send the browser to GET /api/stripe/connect/start (it redirects to Stripe and back to /?stripe=return).
 */
export async function GET() {
  try {
    return NextResponse.json(await connectStatus(await sellerId()));
  } catch (err) {
    return serverError(err);
  }
}

/** DELETE: disconnect this browser's Stripe account from the app (the Stripe account itself is untouched). */
export async function DELETE() {
  const id = await sellerId();
  if (id) forgetConnectedAccount(id);
  return NextResponse.json({ connected: false });
}
