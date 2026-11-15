import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/products";
import { dealCountsByVendor } from "@/lib/deals";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST { query, stream? }
 *
 * Without `stream`: { query, products, dealCounts } once the whole search is done.
 *
 * With `stream: true`: newline-delimited JSON, so results show as they're found.
 *   { "type": "product", "product": Product }    each product as soon as its page is read; a later
 *                                                 "done" may drop it (a repeat or implausible price)
 *   { "type": "done", "query", "products", "dealCounts" }   the final list, cheapest first
 *   { "type": "error", "error": string }
 * If the client goes away mid-search, pages still arriving aren't sent to Claude.
 */
export async function POST(req: Request) {
  const body = await readJson<{ query?: string; stream?: boolean }>(req);
  const query = body?.query?.trim();
  if (!query) return badRequest("query is required");

  if (!body?.stream) {
    try {
      const products = await searchProducts(query);
      return NextResponse.json({ query, products, dealCounts: dealCountsByVendor() });
    } catch (err) {
      return serverError(err);
    }
  }

  const abort = new AbortController();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const products = await searchProducts(query, {
          signal: abort.signal,
          onProduct: (product) => send({ type: "product", product }),
        });
        send({ type: "done", query, products, dealCounts: dealCountsByVendor() });
      } catch (err) {
        console.error("[api]", err);
        send({ type: "error", error: err instanceof Error ? err.message : "Something went wrong" });
      } finally {
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
