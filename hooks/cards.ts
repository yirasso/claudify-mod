// The pane's dashboard, as one SVG, after Outcrowd's "Investment Dashboard Widget" (Dribbble 26970884):
// near-black rounded cards with a hairline edge, small grey titles, a round arrow button in each corner,
// bars in hatched wells (orange-red, yellow, white), a big score over a thick arc with a knob and a needle,
// and an insights card with bold highlights and a pill of round badges.
//
// It is drawn at the pane's own size (480 wide) so the type stays at its real size; the Svg element scales
// it to the slot. The pane's boxes have no background or border, so the cards live in the SVG and the real
// buttons go below it.

const FONT = "Inter,'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif"
const INK = '#f2f2f2'
const MUTED = '#9b9b9b'
const DIM = '#6f6f6f'
const CARD = '#1a1a1a'
const CARD_TOP = '#1f1f1f'
const EDGE = '#2c2c2c'
const RAISED = '#262626'
const WELL = '#1e1e1e'
const STRIPE = '#2a2a2a'
const RED = '#ec4a1c'
const YELLOW = '#fdd329'
const WHITE = '#f1f1f1'
const GREEN = '#43d17f'

export type Bar = { label: string; sub: string; percent: number | null; color: 'red' | 'yellow' | 'white' }
export type Badge = { name: string; ok: boolean; mark: 'graph' | 'github' | 'ponytail' | 'npm' | 'claude' }
export type Dashboard = {
  bars: Bar[]
  /** The pill in the usage card's corner (when the session window resets). */
  pill: string
  score: { value: number; of: number; caption: string }
  /** The insights paragraph: runs of text, the bold ones marked. */
  insight: { text: string; bold?: boolean }[]
  badges: Badge[]
}

function esc(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** A card: the body with a faint lift at the top, the hairline edge, the title and the round arrow button. */
function card(x: number, y: number, w: number, h: number, title: string, fill = 'url(#cardFill)', titleIcon = ''): string {
  return `<g transform="translate(${x} ${y})">
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="22" fill="${fill}" stroke="${EDGE}"/>
${titleIcon}<text x="${titleIcon ? 38 : 18}" y="30" font-family="${FONT}" font-size="12.5" fill="${MUTED}" letter-spacing=".1">${esc(title)}</text>
<circle cx="${w - 30}" cy="26" r="14.5" fill="${RAISED}" stroke="#333"/>
<path d="M${w - 34} 30l8-8M${w - 32.5} 22h6.5v6.5" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</g>`
}

/** The usage card: one hatched well per bar, filled from the bottom in its colour, with the percent inside. */
function usage(d: Dashboard, x: number, y: number, w: number): string {
  const h = 222
  const pad = 16
  const gap = 8
  const top = 54
  const wellH = 112
  const n = Math.max(1, d.bars.length)
  const colW = (w - pad * 2 - gap * (n - 1)) / n
  const colour = { red: RED, yellow: YELLOW, white: WHITE }
  const bars = d.bars
    .map((b, i) => {
      const bx = pad + i * (colW + gap)
      const p = b.percent === null ? 0 : Math.max(0, Math.min(100, b.percent))
      const fillH = b.percent === null || p < 0.5 ? 0 : Math.max(24, Math.round((p / 100) * wellH))
      const fy = top + wellH - fillH
      const ink = b.color === 'red' ? '#fff3ee' : '#1a1a1a'
      return `<rect x="${bx}" y="${top}" width="${colW}" height="${wellH}" rx="7" fill="url(#hatch)"/>
${fillH ? `<rect x="${bx}" y="${fy}" width="${colW}" height="${fillH}" rx="7" fill="${colour[b.color]}"/>` : `<rect x="${bx}" y="${top + wellH - 10}" width="${colW}" height="10" rx="5" fill="url(#hatchStrong)"/>`}
<text x="${bx + 9}" y="${fillH ? fy + 18 : top + wellH - 18}" font-family="${FONT}" font-size="11.5" font-weight="500" fill="${fillH ? ink : DIM}">${b.percent === null ? '—' : `${Math.round(p)}%`}</text>
<text x="${bx + colW / 2}" y="${top + wellH + 20}" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="${INK}">${esc(b.label)}</text>
<text x="${bx + colW / 2}" y="${top + wellH + 36}" text-anchor="middle" font-family="${FONT}" font-size="10.5" fill="${DIM}">${esc(b.sub)}</text>`
    })
    .join('\n')
  const pillW = Math.max(84, d.pill.length * 6.2 + 26)
  const pill = `<rect x="${w - 52 - pillW}" y="11.5" width="${pillW}" height="29" rx="14.5" fill="${RAISED}" stroke="#333"/>
<text x="${w - 52 - pillW / 2}" y="30" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="${INK}">${esc(d.pill)}</text>`
  return `${card(x, y, w, h, 'Usage limits')}<g transform="translate(${x} ${y})">${pill}${bars}</g>`
}

/**
 * The project card: the score as a big number over its total, and a thick arc in the lower right (a hatched
 * track, the green part up to the score, a dark knob at the start, a white knob with a needle at the score).
 */
function score(d: Dashboard, x: number, y: number, w: number, h: number): string {
  const { value, of } = d.score
  const frac = of ? Math.max(0, Math.min(1, value / of)) : 0
  // A half ring standing on the card's bottom edge, a little right of centre, as in the reference.
  const cx = w * 0.56
  const cy = h + 4
  const r = 86
  const a0 = Math.PI * 1.06
  const a1 = Math.PI * 1.94
  const pt = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  const [sx, sy] = pt(a0)
  const [ex, ey] = pt(a1)
  const av = a0 + (a1 - a0) * Math.max(0.04, frac)
  const [vx, vy] = pt(av)
  const big = (av - a0) > Math.PI ? 1 : 0
  const arc = `<g clip-path="url(#scoreClip)">
<path d="M${sx.toFixed(1)} ${sy.toFixed(1)}A${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="url(#hatch)" stroke-width="26"/>
<path d="M${sx.toFixed(1)} ${sy.toFixed(1)}A${r} ${r} 0 ${big} 1 ${vx.toFixed(1)} ${vy.toFixed(1)}" fill="none" stroke="${GREEN}" stroke-width="26" stroke-linecap="round"/>
</g>
<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9" fill="#101010" stroke="#3a3a3a" stroke-width="4"/>
${vy < h - 70 ? `<line x1="${vx.toFixed(1)}" y1="${vy.toFixed(1)}" x2="${vx.toFixed(1)}" y2="${(vy + 40).toFixed(1)}" stroke="#d9d9d9" stroke-width="1.5"/>` : ''}
<circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="10" fill="#f4fff7" stroke="${GREEN}" stroke-width="5"/>`
  return `${card(x, y, w, h, 'Project')}<g transform="translate(${x} ${y})">
<clipPath id="scoreClip"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="21"/></clipPath>
<text x="18" y="84" font-family="${FONT}" font-size="40" font-weight="500" fill="${INK}" letter-spacing="-1">${value}<tspan font-size="15" fill="${MUTED}" dx="6" letter-spacing="0">/${of}</tspan></text>
${arc}
<text x="${cx.toFixed(1)}" y="${h - 14}" text-anchor="middle" font-family="${FONT}" font-size="10.5" fill="${MUTED}">${esc(d.score.caption)}</text>
</g>`
}

/** The round badges' marks, on a 24 grid, in white. */
const MARKS: Record<Badge['mark'], string> = {
  graph: '<path d="M7 7l10-1M7 7l5 10M17 6l-5 11M12 17l7-1" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="7" cy="7" r="2.1" fill="#fff"/><circle cx="17" cy="6" r="2.1" fill="#fff"/><circle cx="12" cy="17" r="2.1" fill="#fff"/><circle cx="19" cy="16" r="2.1" fill="#fff"/>',
  github:
    '<path fill="#fff" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.3-.5-1.5.2-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>',
  ponytail: '<path d="M8 9.5a4 4 0 1 0 8 0a4 4 0 1 0-8 0M15.5 8c3 .5 4.8 3 4.3 6.3-.3 2.6-1.8 4.6-3.8 5.5.8-1.8.9-3.8-.2-5.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  npm: '<path d="M3 7h18v9h-9v2H8v-2H3zM6 10v4M6 10h3v4M12 10v5M12 10h3v4M18 10v4" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>',
  claude: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
}

/** Wraps runs of text (some bold) into lines of at most `max` px, by an average glyph width. */
function wrap(runs: { text: string; bold?: boolean }[], max: number, size: number): { text: string; bold?: boolean }[][] {
  const words = runs.flatMap(r => r.text.split(/(\s+)/).filter(Boolean).map(t => ({ text: t, ...(r.bold ? { bold: true } : {}) })))
  const lines: { text: string; bold?: boolean }[][] = [[]]
  let width = 0
  for (const word of words) {
    const wpx = word.text.length * size * (word.bold ? 0.58 : 0.54)
    if (width + wpx > max && word.text.trim() && width > 0) {
      lines.push([])
      width = 0
    }
    if (!word.text.trim() && width === 0) continue
    ;(lines[lines.length - 1] as { text: string; bold?: boolean }[]).push(word)
    width += wpx
  }
  return lines
}

/** The insights card: a short paragraph with bold highlights, and a dark pill of round badges. */
function insights(d: Dashboard, x: number, y: number, w: number, h: number): string {
  const sparkle = `<path d="M24 19.5l1.6 4.1 4.1 1.6-4.1 1.6-1.6 4.1-1.6-4.1-4.1-1.6 4.1-1.6z" fill="${INK}"/>`
  const size = 12
  const lines = wrap(d.insight, w - 36, size)
    .slice(0, 5)
    .map(
      (line, i) =>
        `<text x="18" y="${70 + i * 17}" font-family="${FONT}" font-size="${size}" fill="#d6d6d6">${line
          .map(run => (run.bold ? `<tspan font-weight="600" fill="${INK}">${esc(run.text)}</tspan>` : esc(run.text)))
          .join('')}</text>`,
    )
    .join('\n')
  const n = d.badges.length
  const bd = 30
  const gapB = 6
  const pillW = 12 + n * bd + (n - 1) * gapB
  const px = (w - pillW) / 2
  const py = h - 56
  const badges = d.badges
    .map((b, i) => {
      const bx = px + 6 + i * (bd + gapB)
      return `<g transform="translate(${bx.toFixed(1)} ${py + 6})"><circle cx="15" cy="15" r="15" fill="${b.ok ? '#0e0e0e' : '#2e2e2e'}" stroke="${b.ok ? '#3b3b3b' : '#454545'}"/><g transform="translate(6.5 6.5) scale(.71)" opacity="${b.ok ? 1 : 0.35}">${MARKS[b.mark]}</g>${b.ok ? '' : `<circle cx="26" cy="5" r="4.5" fill="${RED}" stroke="#262626" stroke-width="2"/>`}</g>`
    })
    .join('')
  return `${card(x, y, w, h, 'Repository', 'url(#raisedFill)', `<g transform="translate(-6 0)">${sparkle}</g>`)}<g transform="translate(${x} ${y})">
${lines}
<rect x="${px.toFixed(1)}" y="${py}" width="${pillW}" height="42" rx="21" fill="#141414" stroke="#303030"/>
${badges}
</g>`
}

/** The whole dashboard: usage across the top, the project score and the repository insights below. */
export function dashboard(d: Dashboard): string {
  const W = 480
  const gap = 10
  const topH = 222
  const rowH = 214
  const half = (W - gap) / 2
  const H = topH + gap + rowH
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<linearGradient id="cardFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${CARD_TOP}"/><stop offset="1" stop-color="${CARD}"/></linearGradient>
<linearGradient id="raisedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2b2b"/><stop offset="1" stop-color="#232323"/></linearGradient>
<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${WELL}"/><rect width="2.6" height="7" fill="${STRIPE}"/></pattern>
<pattern id="hatchStrong" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#3a3a3a"/><rect width="2.4" height="6" fill="#4d4d4d"/></pattern>
</defs>
${usage(d, 0, 0, W)}
${score(d, 0, topH + gap, half, rowH)}
${insights(d, half + gap, topH + gap, half, rowH)}
</svg>`
}
