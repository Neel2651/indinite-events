/**
 * Generated placeholder artwork for the dev seed (SVG, 1600×900, Indinite brand palette from
 * apps/web/app/globals.css). Deterministic, so reseeding produces the same files.
 */

const W = 1600;
const H = 900;

const BRAND = {
  orange: "#eb5e28",
  orangeLight: "#f69852",
  yellow: "#ffe46a",
  indigo: "#697ff6",
  cream: "#fff6ef",
  navy: "#0a0e1f",
  navyDeep: "#05071a",
  navyRaised: "#1a2040",
} as const;

export interface Palette {
  sky: [string, string];
  glow: string;
  primary: string;
  secondary: string;
  accent: string;
}

export const PALETTES = {
  saffron: { sky: [BRAND.navy, BRAND.navyDeep], glow: BRAND.orange, primary: BRAND.orange, secondary: BRAND.yellow, accent: BRAND.orangeLight },
  twilight: { sky: [BRAND.navyRaised, BRAND.navyDeep], glow: BRAND.indigo, primary: BRAND.indigo, secondary: BRAND.orangeLight, accent: BRAND.yellow },
} satisfies Record<string, Palette>;

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

function defs(p: Palette, id: string) {
  return `<defs>
    <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient>
    <radialGradient id="${id}-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${p.glow}" stop-opacity="0.55"/><stop offset="0.6" stop-color="${p.glow}" stop-opacity="0.12"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-flame" cx="0.5" cy="0.65" r="0.5"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="${BRAND.yellow}"/><stop offset="1" stop-color="${BRAND.orange}"/></radialGradient>
  </defs>`;
}

function background(p: Palette, id: string, seed: number, glow: { x: number; y: number; r: number }) {
  const rand = rng(seed);
  const dots = Array.from({ length: 70 }, () => {
    const x = rand() * W;
    const y = rand() * H * 0.75;
    const r = 0.8 + rand() * 2.4;
    const c = rand() > 0.7 ? p.secondary : "#ffffff";
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${c}" opacity="${f(0.2 + rand() * 0.6)}"/>`;
  }).join("");
  return `<rect width="${W}" height="${H}" fill="url(#${id}-sky)"/>
    <circle cx="${glow.x}" cy="${glow.y}" r="${glow.r}" fill="url(#${id}-glow)"/>${dots}`;
}

/** Concentric rings of petals. */
function mandala(cx: number, cy: number, r: number, p: Palette, opacity = 1) {
  const rings = [
    { n: 24, rr: r, len: r * 0.28, w: r * 0.07, c: p.primary },
    { n: 16, rr: r * 0.72, len: r * 0.26, w: r * 0.09, c: p.secondary },
    { n: 12, rr: r * 0.46, len: r * 0.22, w: r * 0.1, c: p.accent },
  ];
  const petals = rings
    .map(({ n, rr, len, w, c }) =>
      Array.from({ length: n }, (_, i) => {
        const a = (360 / n) * i;
        return `<ellipse cx="0" cy="${f(-rr + len / 2)}" rx="${f(w)}" ry="${f(len / 2)}" fill="none" stroke="${c}" stroke-width="3" transform="rotate(${a})"/>`;
      }).join(""),
    )
    .join("");
  const dots = Array.from({ length: 36 }, (_, i) => {
    const a = ((Math.PI * 2) / 36) * i;
    return `<circle cx="${f(Math.cos(a) * r * 1.08)}" cy="${f(Math.sin(a) * r * 1.08)}" r="${f(r * 0.018)}" fill="${p.secondary}"/>`;
  }).join("");
  return `<g transform="translate(${cx} ${cy})" opacity="${opacity}">
    <circle r="${f(r * 1.0)}" fill="none" stroke="${p.primary}" stroke-width="2" opacity="0.5"/>
    <circle r="${f(r * 0.2)}" fill="${p.primary}" opacity="0.9"/>
    <circle r="${f(r * 0.12)}" fill="${p.secondary}"/>
    ${petals}${dots}
  </g>`;
}

/** Decorated dandiya stick. */
function dandiya(cx: number, cy: number, len: number, angle: number, p: Palette) {
  const bands = Array.from({ length: 7 }, (_, i) => {
    const y = -len / 2 + (len / 8) * (i + 1);
    const c = [p.primary, p.secondary, p.accent][i % 3];
    return `<rect x="-9" y="${f(y - 6)}" width="18" height="12" rx="3" fill="${c}"/>`;
  }).join("");
  return `<g transform="translate(${cx} ${cy}) rotate(${angle})">
    <rect x="-7" y="${f(-len / 2)}" width="14" height="${len}" rx="7" fill="${BRAND.cream}"/>${bands}
    <circle cy="${f(-len / 2)}" r="12" fill="${p.secondary}"/><circle cy="${f(len / 2)}" r="12" fill="${p.secondary}"/>
  </g>`;
}

/** Clay lamp with flame. */
function diya(cx: number, cy: number, s: number, p: Palette, id: string) {
  return `<g transform="translate(${cx} ${cy}) scale(${s})">
    <ellipse cx="0" cy="-58" rx="60" ry="60" fill="url(#${id}-glow)"/>
    <path d="M -10 -30 C -22 -52 -6 -74 0 -92 C 6 -74 22 -52 10 -30 Z" fill="url(#${id}-flame)"/>
    <path d="M -80 -22 C -60 38 60 38 80 -22 Z" fill="${p.primary}"/>
    <path d="M -80 -22 L 80 -22 L 70 -30 L -70 -30 Z" fill="${p.accent}"/>
    <path d="M -52 2 Q 0 26 52 2" fill="none" stroke="${p.secondary}" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round"/>
  </g>`;
}

/** Stylised dancer: head, ghagra skirt, raised arms holding sticks. */
function dancer(cx: number, baseY: number, s: number, flip: boolean, colour: string, p: Palette) {
  const sx = flip ? -s : s;
  return `<g transform="translate(${cx} ${baseY}) scale(${f(sx)} ${f(s)})">
    <path d="M -46 0 Q 0 -18 46 0 L 16 -92 L -16 -92 Z" fill="${colour}"/>
    <path d="M -46 0 Q 0 -18 46 0" fill="none" stroke="${p.secondary}" stroke-width="5"/>
    <rect x="-13" y="-140" width="26" height="52" rx="10" fill="${colour}"/>
    <circle cx="0" cy="-156" r="15" fill="${colour}"/>
    <path d="M -10 -132 L -44 -176" stroke="${colour}" stroke-width="8" stroke-linecap="round"/>
    <path d="M 10 -132 L 36 -104" stroke="${colour}" stroke-width="8" stroke-linecap="round"/>
    <path d="M -58 -196 L -32 -160" stroke="${p.secondary}" stroke-width="6" stroke-linecap="round"/>
    <path d="M 30 -122 L 52 -92" stroke="${p.secondary}" stroke-width="6" stroke-linecap="round"/>
  </g>`;
}

function svg(id: string, p: Palette, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${defs(p, id)}${body}</svg>\n`;
}

export function coverArt(p: Palette, seed: number) {
  const id = "c";
  const colours = [p.primary, p.accent, BRAND.cream, p.primary, p.accent, BRAND.cream, p.primary];
  const dancers = colours.map((c, i) => dancer(200 + i * 200, 860 - (i % 2) * 18, 1.35 + (i % 3) * 0.08, i % 2 === 1, c, p)).join("");
  return svg(
    id,
    p,
    `${background(p, id, seed, { x: 800, y: 380, r: 620 })}
    ${mandala(800, 360, 250, p, 0.85)}
    <rect y="820" width="${W}" height="80" fill="${p.sky[1]}" opacity="0.6"/>
    ${dancers}`,
  );
}

export function mandalaArt(p: Palette, seed: number) {
  const id = "m";
  return svg(
    id,
    p,
    `${background(p, id, seed, { x: 800, y: 450, r: 700 })}
    ${mandala(800, 450, 360, p)}
    ${mandala(160, 140, 110, p, 0.5)}${mandala(1440, 760, 140, p, 0.5)}`,
  );
}

export function diyaArt(p: Palette, seed: number) {
  const id = "d";
  const lamps = [260, 530, 800, 1070, 1340].map((x, i) => diya(x, 700 - (i === 2 ? 30 : 0), i === 2 ? 1.6 : 1.2, p, id)).join("");
  return svg(
    id,
    p,
    `${background(p, id, seed, { x: 800, y: 620, r: 700 })}
    <path d="M 0 760 Q 800 700 ${W} 760 L ${W} ${H} L 0 ${H} Z" fill="${p.sky[1]}"/>
    ${lamps}`,
  );
}

export function dandiyaArt(p: Palette, seed: number) {
  const id = "s";
  const pairs = [
    [420, 450],
    [800, 430],
    [1180, 450],
  ]
    .map(([x, y]) => `${dandiya(x!, y!, 520, -28, p)}${dandiya(x!, y!, 520, 28, p)}`)
    .join("");
  return svg(id, p, `${background(p, id, seed, { x: 800, y: 450, r: 680 })}${pairs}`);
}
