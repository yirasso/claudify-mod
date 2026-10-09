// The pane's dashboard, as one SVG, after Shamnad's "Infinity Widgets" (Dribbble 27235886 and 27236345):
// pure black, flat #262626 tiles with big radii, ring gauges, a red hero tile with concentric circles, a pill
// tile and round badges, with mono numerals. This file is the design: change it here, not in a mock-up.
//
// It is drawn at the pane's own size (480 wide) so the type stays at its real size; the Svg element scales
// it to the slot. The pane's boxes have no background or border, so the tiles live in the SVG; the real
// buttons and the session lists (which an SVG cannot make clickable) go below it.

const SANS = "Inter,'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif"
const MONO = "'Geist Mono','JetBrains Mono','Cascadia Mono',Consolas,ui-monospace,monospace"
const INK = '#f4f4f4'
const MUTED = '#9c9c9c'
const TILE = '#262626'
const TILE_HI = '#303030'
const RING = '#3d3d3d'
const RED = '#ff0a0a'
const CORAL = '#ff5a5a'
const YELLOW = '#f6ff00'

export type Ring = { label: string; percent: number | null; icon: 'clock' | 'calendar' | 'spark' }
export type Badge = { name: string; ok: boolean; mark: 'graph' | 'github' | 'ponytail' | 'npm' | 'claude' }
export type Dashboard = {
  /** Whether the project's script is running (the first button is then a stop button). */
  running: boolean
  /** The usage ring gauges: the session, the week and the spend limit, when the plan has them. */
  rings: Ring[]
  /** The pill in the usage tile's corner (when the session window resets). */
  reset: string
  /** The context window's fill, and its size in small print. */
  context: { percent: number | null; detail: string }
  score: { value: number; of: number }
  /** The project's checks, one line each under the score. */
  checks: { name: string; note: string }[]
  /** The repository paragraph: runs of text, the bold ones marked. */
  insight: { text: string; bold?: boolean }[]
  badges: Badge[]
}

function esc(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** Cuts a mono string to `max` characters, with an ellipsis. */
const fit = (s: string, max: number): string => (s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s)

/** A flat tile. */
const tile = (x: number, y: number, w: number, h: number, r: number, fill = TILE): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`

/** A small uppercase caption. */
const cap = (x: number, y: number, text: string, fill = MUTED): string =>
  `<text x="${x}" y="${y}" font-family="${SANS}" font-size="11" letter-spacing=".6" fill="${fill}">${esc(text.toUpperCase())}</text>`

/**
 * The actions tile: a dotted field with the mark in a black disc and four square buttons below it, drawn here
 * without their labels (an SVG cannot be pressed): the pane lays real Buttons over the labels' row, 150px down
 * (8 rows of 18px), centred on the four columns.
 */
const ACTION_ICONS: Record<'start' | 'stop' | 'save' | 'setup' | 'compact', string> = {
  compact: '<path d="M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M4 12h16"/>',
  start: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M10 8.6l5.2 3.4-5.2 3.4z"/>',
  stop: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  save: '<path d="M5 5.5A1.5 1.5 0 016.5 4h9.2L19 7.3v10.2a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 17.5z"/><path d="M8.5 4v4.5h6V4M8.5 19v-5h7v5"/>',
  setup: '<path d="M4 7h8M18 7h2M4 12h2M12 12h8M4 17h8M18 17h2"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="12" r="2.2"/><circle cx="15" cy="17" r="2.2"/>',
}
function actions(w: number, h: number, running: boolean): string {
  const dots: string[] = []
  for (let row = 0; row < 4; row++) {
    for (let x = 18 + 0.8; x < w - 18; x += 15.6) {
      if (Math.abs(x - w / 2) < 38) continue
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${24 + row * 16}" r="1" fill="#7a7a7a"/>`)
    }
  }
  return `${tile(0, 0, w, h, 28)}
${dots.join('')}
<circle cx="${w / 2}" cy="44" r="20" fill="#000"/>
<g transform="translate(${w / 2 - 12} 32)"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></g>
${actionSquares(w, 88, 50, running)}`
}

/** The four square buttons, centred on four equal columns, `size` px wide, their tops at `y`. */
function actionSquares(w: number, y: number, size: number, running: boolean): string {
  return ([running ? 'stop' : 'start', 'save', 'setup', 'compact'] as const)
    .map((k, i) => {
      const cx = (w / 8) * (1 + 2 * i)
      const icon = size * 0.46
      return `<rect x="${(cx - size / 2).toFixed(1)}" y="${y}" width="${size}" height="${size}" rx="${Math.round(size * 0.28)}" fill="#3a3a3a"/>
${iconG(ACTION_ICONS[k], cx - icon / 2, y + (size - icon) / 2, icon, '#ececec')}`
    })
    .join('\n')
}

/**
 * The actions tile as a slim band for above the prompt: the same dotted tile and squares without the mark,
 * 84px tall. Its labels sit 3 rows down (54px), where the band lays the real Buttons.
 */
export function actionsBar(running: boolean): string {
  const W = 480
  const H = 84
  const dots: string[] = []
  for (let row = 0; row < 3; row++) {
    for (let x = 18 + 0.8; x < W - 18; x += 15.6) {
      const cy = 14 + row * 16
      // Not behind a square (their columns are 120px wide, the squares 44px); the labels' row stays clear.
      if ([1, 3, 5, 7].some(k => Math.abs(x - (W / 8) * k) < 30)) continue
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${cy}" r="1" fill="#7a7a7a"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
${tile(0, 0, W, H, 28)}
${dots.join('')}
${actionSquares(W, 8, 44, running)}
</svg>`
}

/** The ring gauges' icons, on a 24 grid. */
const ICONS: Record<Ring['icon'], string> = {
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
}
const ICON_LINES = '<path d="M5 7h14M5 12h14M5 17h9"/>'
const iconG = (body: string, x: number, y: number, size: number, stroke: string): string =>
  `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${size / 24})" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g>`

/** The usage tile: a ring gauge per limit, filled in yellow (coral from 85%), with the percent and the name. */
function usage(d: Dashboard, y: number, w: number, h: number): string {
  const n = Math.max(1, d.rings.length)
  const colW = (w - 24) / n
  const R = 31
  const C = 2 * Math.PI * R
  const rings = d.rings
    .map((r, i) => {
      const cx = 12 + colW * (i + 0.5)
      const cy = 54 + 37
      const p = r.percent === null ? null : Math.max(0, Math.min(100, r.percent))
      const dash = p === null || p < 0.5 ? '' : `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="${R}" fill="none" stroke="${p >= 85 ? CORAL : YELLOW}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${((C * p) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx.toFixed(1)} ${cy})"/>`
      return `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="${R}" fill="none" stroke="${RING}" stroke-width="6"/>
${dash}
${iconG(ICONS[r.icon], cx - 11, cy - 11, 22, INK)}
<text x="${cx.toFixed(1)}" y="${cy + 37 + 12 + 12}" text-anchor="middle" font-family="${MONO}" font-size="16" fill="${p === null ? '#6a6a6a' : INK}">${p === null ? '—' : `${Math.round(p)}%`}</text>
<text x="${cx.toFixed(1)}" y="${cy + 37 + 12 + 12 + 18}" text-anchor="middle" font-family="${SANS}" font-size="11" fill="${MUTED}">${esc(r.label)}</text>`
    })
    .join('\n')
  const pw = Math.max(80, d.reset.length * 6.9 + 24)
  const pill = d.reset
    ? `<rect x="${w - 18 - pw}" y="12" width="${pw}" height="26" rx="13" fill="${TILE_HI}"/>
<text x="${w - 18 - pw / 2}" y="29" text-anchor="middle" font-family="${MONO}" font-size="11.5" fill="${INK}">${esc(d.reset)}</text>`
    : ''
  return `<g transform="translate(0 ${y})">${tile(0, 0, w, h, 28)}${cap(22, 30, 'Usage limits')}${pill}
${rings}</g>`
}

/** The hero tile: red, with concentric circles and a soft light, the score in mono and the checks below. */
function project(d: Dashboard, x: number, y: number, w: number, h: number): string {
  const cx = w / 2
  const cy = 82
  const circles = [30, 56, 82, 108, 134].map(r => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".26"/>`).join('')
  const lines = d.checks
    .slice(0, 3)
    .map((c, i, all) => {
      const room = Math.floor((w - 40) / 6.9)
      const name = fit(c.name, room)
      const note = fit(c.note, Math.max(0, room - name.length - 3))
      const by = h - 18 - 5 - 20 * (all.length - 1 - i)
      return `<text x="20" y="${by}" font-family="${MONO}" font-size="11.5" letter-spacing=".5" fill="#fff" xml:space="preserve">${esc(name)}${note ? `<tspan fill-opacity=".65"> · ${esc(note)}</tspan>` : ''}</text>`
    })
    .join('\n')
  return `<g transform="translate(${x} ${y})">
<clipPath id="heroClip"><rect width="${w}" height="${h}" rx="30"/></clipPath>
<rect width="${w}" height="${h}" rx="30" fill="${RED}"/>
<g clip-path="url(#heroClip)"><rect width="${w}" height="${h}" fill="url(#heroGlow)"/>${circles}</g>
${cap(20, 30, 'Project', 'rgba(255,255,255,.8)')}
<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-family="${MONO}" font-size="44" font-weight="500" letter-spacing="-2" fill="#fff">${d.score.value}<tspan font-size="16" letter-spacing="0" fill-opacity=".8">/${d.score.of}</tspan></text>
${lines}
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

/** The repository tile: a short paragraph with bold facts, and a row of round badges. */
function repo(d: Dashboard, x: number, y: number, w: number, h: number): string {
  const size = 12
  const lines = wrap(d.insight, w - 36, size)
    .slice(0, 3)
    .map(
      (line, i) =>
        `<text x="18" y="${56 + i * 17}" font-family="${SANS}" font-size="${size}" fill="#d6d6d6">${line
          .map(run => (run.bold ? `<tspan font-weight="600" fill="#fff">${esc(run.text)}</tspan>` : esc(run.text)))
          .join('')}</text>`,
    )
    .join('\n')
  const by = h - 14 - 32
  const badges = d.badges
    .map((b, i) => {
      const bx = 18 + i * 40
      return `<g transform="translate(${bx} ${by})"><circle cx="16" cy="16" r="16" fill="${TILE_HI}"/><g transform="translate(7.5 7.5) scale(.71)" opacity="${b.ok ? 1 : 0.35}">${MARKS[b.mark]}</g>${b.ok ? '' : `<circle cx="29" cy="3" r="4.5" fill="${CORAL}" stroke="${TILE}" stroke-width="2"/>`}</g>`
    })
    .join('')
  return `<g transform="translate(${x} ${y})">${tile(0, 0, w, h, 28)}${cap(18, 32, 'Repository')}
${lines}
${badges}</g>`
}

/** The context tile: a pill with a light disc and the reading in mono. */
function context(d: Dashboard, x: number, y: number, w: number, h: number): string {
  const p = d.context.percent
  const reading = p === null ? '—' : `${Math.round(p)}`
  const detail = p === null ? d.context.detail : `% · ${d.context.detail}`
  return `<g transform="translate(${x} ${y})">${tile(0, 0, w, h, h / 2)}
<circle cx="40" cy="${h / 2}" r="18" fill="#d9d9d9"/>${iconG(ICON_LINES, 30, h / 2 - 10, 20, TILE)}
${cap(72, h / 2 - 8, 'Context')}
<text x="72" y="${h / 2 + 20}" font-family="${MONO}" font-size="24" fill="${INK}">${reading}<tspan font-size="13" fill="${MUTED}">${esc(detail)}</tspan></text>
</g>`
}

/** The whole dashboard: the actions tile, the usage rings, then the project hero beside the repository and context tiles. */
export function dashboard(d: Dashboard): string {
  const W = 480
  const gap = 8
  const headH = 186
  const usageH = 188
  const rowH = 236
  const half = (W - gap) / 2
  const repoH = 148
  const pillH = rowH - repoH - gap
  const y1 = headH + gap
  const y2 = y1 + usageH + gap
  const H = y2 + rowH
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<radialGradient id="heroGlow" cx=".5" cy=".35" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
${actions(W, headH, d.running)}
${usage(d, y1, W, usageH)}
${project(d, 0, y2, half, rowH)}
${repo(d, half + gap, y2, half, repoH)}
${context(d, half + gap, y2 + repoH + gap, half, pillH)}
</svg>`
}
