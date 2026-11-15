import { NextResponse } from "next/server";
import { filterProducts, type Product } from "@/lib/products";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson<{ text?: string; products?: Product[] }>(req);
  const text = body?.text?.trim();
  if (!text) return badRequest("text is required");
  const products = Array.isArray(body?.products) ? body.products : [];
  if (!products.length) return NextResponse.json({ spec: null, products: [] });
  try {
    const result = await filterProducts(text, products);
    if (!result) return NextResponse.json({ error: "Couldn't understand that filter" }, { status: 422 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err);
  }
}
