import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/products";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readJson<{ query?: string }>(req);
  const query = body?.query?.trim();
  if (!query) return badRequest("query is required");
  try {
    const products = await searchProducts(query);
    return NextResponse.json({ query, products });
  } catch (err) {
    return serverError(err);
  }
}
