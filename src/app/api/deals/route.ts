import { NextResponse } from "next/server";
import { dealsForStore, findDeals, type Deal } from "@/lib/deals";
import { mapLimit } from "@/lib/llm";
import { storeKey, vendorById } from "@/lib/vendors";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Stored, unexpired deals for a store, e.g. GET /api/deals?store=bestbuy */
export async function GET(req: Request) {
  const store = new URL(req.url).searchParams.get("store")?.trim();
  if (!store) return badRequest("store is required");
  return NextResponse.json({ deals: dealsForStore(storeKey(store)) });
}

/**
 * POST { query } searches the web for fresh deals and stores them.
 * POST { stores: ["amazon", "bestbuy"] } does that for each shop vendor and returns active deals per store,
 * which is how search results pick up deals automatically. A store whose lookup fails falls back to stored deals.
 */
export async function POST(req: Request) {
  const body = await readJson<{ query?: string; stores?: string[] }>(req);

  if (Array.isArray(body?.stores)) {
    const ids = [...new Set(body.stores.filter((s): s is string => typeof s === "string" && !!vendorById(s)))];
    const entries = await mapLimit(ids, 3, async (id): Promise<[string, Deal[]]> => {
      try {
        await findDeals(vendorById(id)!.name);
      } catch (err) {
        console.error("[deals]", id, err instanceof Error ? err.message : err);
      }
      return [id, dealsForStore(id)];
    });
    return NextResponse.json({ deals: Object.fromEntries(entries) });
  }

  const query = body?.query?.trim();
  if (!query) return badRequest("query or stores is required");
  try {
    return NextResponse.json({ query, deals: await findDeals(query) });
  } catch (err) {
    return serverError(err);
  }
}
