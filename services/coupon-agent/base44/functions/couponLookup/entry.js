import { createClientFromRequest } from "npm:@base44/sdk";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default async function couponLookup(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    if (!(await createClientFromRequest(request).auth.me())) {
      return json({ error: "Sign in to look up coupons." }, 401);
    }
  } catch {
    return json({ error: "Sign in to look up coupons." }, 401);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Expected a JSON object." }, 400);
  }

  const origin = Deno.env.get("COUPON_API_URL");
  const token = Deno.env.get("COUPON_API_TOKEN");
  if (!origin || !token) return json({ error: "Coupon service is not configured." }, 503);

  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password) {
      return json({ error: "Coupon service requires an HTTPS URL." }, 503);
    }
    const headers = { Authorization: `Bearer ${token}` };
    const options = { headers, redirect: "error", signal: AbortSignal.timeout(30_000) };
    url.search = "";
    url.hash = "";

    if (Object.hasOwn(body, "question")) {
      if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 300) {
        return json({ error: "Enter a question of 1 to 300 characters." }, 400);
      }
      url.pathname = "/v1/ask";
      options.method = "POST";
      options.body = JSON.stringify({ question: body.question });
      headers["Content-Type"] = "application/json";
    } else {
      url.pathname = "/v1/coupons";
      if (body.merchant != null) {
        if (typeof body.merchant !== "string" || body.merchant.length > 100) {
          return json({ error: "Invalid merchant." }, 400);
        }
        url.searchParams.set("merchant", body.merchant.trim());
      }
    }

    const result = await fetch(url, options);
    if (!result.ok) return json({ error: "Coupon service is unavailable." }, 502);
    return json(await result.json());
  } catch {
    return json({ error: "Coupon service is unavailable." }, 502);
  }
}
