/** Create a Stripe Payment Link for a one-off item via the REST API (no SDK needed). */
async function stripe<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${json?.error?.message ?? res.status}`);
  return json as T;
}

export async function createPaymentLink(name: string, price: number): Promise<string> {
  const p = await stripe<{ id: string }>("/prices", {
    currency: "usd",
    unit_amount: String(Math.round(price * 100)),
    "product_data[name]": name.slice(0, 250),
  });
  const link = await stripe<{ url: string }>("/payment_links", {
    "line_items[0][price]": p.id,
    "line_items[0][quantity]": "1",
  });
  return link.url;
}
