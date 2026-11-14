import { NextResponse } from "next/server";
import { createEbayListing } from "@/lib/ebay";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson<{ title?: string; description?: string; price?: number; condition?: string; imageUrls?: string[] }>(req);
  if (!body?.title || !body.description || !(Number(body.price) > 0)) return badRequest("title, description and price are required");
  try {
    const imageUrls = (body.imageUrls ?? []).filter((u) => /^https:\/\//.test(u));
    const result = await createEbayListing({
      title: body.title,
      description: body.description,
      price: Number(body.price),
      condition: body.condition ?? "Good",
      imageUrls,
    });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err);
  }
}
