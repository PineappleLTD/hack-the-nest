import { NextResponse } from "next/server";
import { dealsForStore, findDeals } from "@/lib/deals";
import { storeKey } from "@/lib/vendors";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Stored, unexpired deals for a store, e.g. GET /api/deals?store=bestbuy */
export async function GET(req: Request) {
  const store = new URL(req.url).searchParams.get("store")?.trim();
  if (!store) return badRequest("store is required");
  return NextResponse.json({ deals: dealsForStore(storeKey(store)) });
}

/** Search the web for fresh deals and store them. */
export async function POST(req: Request) {
  const body = await readJson<{ query?: string }>(req);
  const query = body?.query?.trim();
  if (!query) return badRequest("query is required");
  try {
    return NextResponse.json({ query, deals: await findDeals(query) });
  } catch (err) {
    return serverError(err);
  }
}
