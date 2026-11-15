import { NextResponse } from "next/server";
import { createEbayListing } from "@/lib/ebay";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson<{ title?: string; description?: string; price?: number; condition?: string; imageUrls?: string[] }>(req);
  if (!body?.title || !body.description || !(Number(body.price) > 0)) return badRequest("title, description and price are required");
  if (!process.env.EBAY_OAUTH_TOKEN) {
    return NextResponse.json({ error: "eBay posting isn't set up: add an eBay seller user token as EBAY_OAUTH_TOKEN in .env" }, { status: 503 });
  }
  const imageUrls = (body.imageUrls ?? []).filter((u) => /^https:\/\//.test(u));
  if (!imageUrls.length) return badRequest("eBay needs at least one public https photo URL (a photo uploaded on localhost isn't public)");
  try {
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
