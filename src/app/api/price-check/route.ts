import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { priceCheck } from "@/lib/listings";
import { badRequest, serverError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

async function savePhoto(file: File): Promise<string | null> {
  const ext = IMAGE_TYPES[file.type];
  if (!ext || file.size === 0 || file.size > 10 * 1024 * 1024) return null;
  const buf = Buffer.from(await file.arrayBuffer());
  const name = `${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16)}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  return `/uploads/${name}`;
}

export async function POST(req: Request) {
  let item = "";
  let condition = "";
  let notes = "";
  let photoUrl: string | null = null;

  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      item = String(form.get("item") ?? "");
      condition = String(form.get("condition") ?? "");
      notes = String(form.get("notes") ?? "");
      const photo = form.get("photo");
      if (photo instanceof File) photoUrl = await savePhoto(photo);
    } else {
      const body = await req.json();
      item = String(body.item ?? "");
      condition = String(body.condition ?? "");
      notes = String(body.notes ?? "");
    }
  } catch {
    return badRequest("Invalid request body");
  }

  item = item.trim();
  if (!item) return badRequest("item is required");
  if (!condition.trim()) condition = "Good";

  try {
    const result = await priceCheck({ item, condition, notes });
    return NextResponse.json({ ...result, photoUrl });
  } catch (err) {
    return serverError(err);
  }
}
