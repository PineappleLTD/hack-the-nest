import { NextResponse } from "next/server";
import { createPaymentLink } from "@/lib/stripe";
import { badRequest, readJson, serverError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson<{ name?: string; price?: number }>(req);
  if (!body?.name || !(Number(body.price) > 0)) return badRequest("name and price are required");
  try {
    return NextResponse.json({ url: await createPaymentLink(body.name, Number(body.price)) });
  } catch (err) {
    return serverError(err);
  }
}
