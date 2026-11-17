// The cart: basket's woven basket, put on wheels.

const BASKET = "M20 28 Q20 22 26 22 H88 Q95 22 94 29 L89 58 Q88 66 80 66 H36 Q29 66 28 59 Z";
const HANDLE = "M4 12 H11 Q15 12 16.5 16 L20 26";
const WEAVE_STEP = 18;
// Both diagonal families, cut through the basket as a lattice.
const WEAVE = Array.from({ length: 12 }, (_, i) => {
  const x = -60 + i * WEAVE_STEP;
  return `M${x} 0 L${x + 100} 100 M${x + 100} 0 L${x} 100`;
}).join(" ");

/** The cart as one shape with the weave cut through, for the glass reveal (only the silhouette is used). */
export const CART_SILHOUETTE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 6 100 86">
<defs><mask id="w"><rect x="0" y="0" width="100" height="100" fill="#fff"/><path d="${WEAVE}" stroke="#000" stroke-width="3.5" fill="none"/></mask></defs>
<path d="${HANDLE}" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${BASKET}" fill="#fff" mask="url(#w)"/>
<circle cx="39" cy="80" r="7" fill="#fff"/><circle cx="78" cy="80" r="7" fill="#fff"/>
</svg>`;
