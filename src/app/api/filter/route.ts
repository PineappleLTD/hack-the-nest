import { NextResponse } from "next/server";
import { applyFilter, FILTER_SYSTEM, FilterSpecSchema, type Product } from "@/lib/products";
import { structured } from "@/lib/llm";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson<{ text?: string; products?: Product[] }>(req);
  const text = body?.text?.trim();
  if (!text) return badRequest("text is required");
  const products = Array.isArray(body?.products) ? body.products : [];
  try {
    const spec = await structured("filter_spec", FilterSpecSchema, FILTER_SYSTEM, text);
    if (!spec) return NextResponse.json({ error: "Couldn't understand that filter" }, { status: 422 });
    return NextResponse.json({ spec, products: applyFilter(products, spec) });
  } catch (err) {
    return serverError(err);
  }
}
