// Warm the SQLite cache with demo queries so the demo is instant (and works offline).
// Usage: start the app (npm run dev), then: npm run seed
const BASE = process.env.SEED_BASE_URL || "http://localhost:3000";

const jobs = [
  ["deals", "/api/deals", { query: "Best Buy" }],
  ["search", "/api/search", { query: "AirPods Pro" }],
  ["search", "/api/search", { query: "Nintendo Switch OLED" }],
  ["search", "/api/search", { query: "Kindle Paperwhite" }],
  ["listing", "/api/price-check", { item: "iPhone 13, 128GB", condition: "Good" }],
];

for (const [kind, path, body] of jobs) {
  const t = Date.now();
  process.stdout.write(`${kind.padEnd(8)} ${JSON.stringify(body)} ... `);
  try {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.status);
    const n = json.products?.length ?? json.deals?.length ?? json.markets?.reduce((a, m) => a + m.comps.length, 0);
    console.log(`${n} results in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
  }
}
