// A small, dependency-free SVG-path rasterizer and PNG codec, so `pnpm brand` renders the PNG
// assets the same way on every machine without a browser, librsvg or native modules.
// Supports the path commands the brand uses (M L H V Q C A Z, absolute and relative).
import { crc32, deflateSync, inflateSync } from "node:zlib"

type Pt = readonly [number, number]
export interface Transform {
  readonly scale: number
  readonly x: number
  readonly y: number
}
const identity: Transform = { scale: 1, x: 0, y: 0 }

type Token = { readonly cmd: string } | { readonly num: number; readonly raw: string }

const TOKEN = /([A-Za-z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([\s,]+)|(.)/gy

/** Splits path data into commands and numbers; throws on any character it cannot read. */
const tokenize = (d: string): Token[] => {
  const out: Token[] = []
  for (const m of d.matchAll(TOKEN)) {
    if (m[1] !== undefined) out.push({ cmd: m[1] })
    else if (m[2] !== undefined) out.push({ num: Number(m[2]), raw: m[2] })
    else if (m[4] !== undefined)
      throw new Error(`path data: unexpected ${JSON.stringify(m[4])} at offset ${m.index}`)
  }
  return out
}

/** Flattens a path into closed polygons, in device coordinates. */
export const flatten = (d: string, t: Transform = identity): Pt[][] => {
  const tokens = tokenize(d)
  const polys: Pt[][] = []
  let poly: Pt[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let cmd = ""
  let i = 0
  let closed = false
  const num = (): number => {
    const tok = tokens[i]
    if (tok === undefined || !("num" in tok))
      throw new Error(
        `path data: ${cmd} needs a number, got ${tok === undefined ? "the end" : tok.cmd} (token ${i})`,
      )
    i++
    return tok.num
  }
  // An arc flag is one digit, 0 or 1. Optimizers write flags without separators ("A4 4 0 008 52"),
  // which this parser does not split, so refuse anything else rather than draw the wrong arc.
  const flag = (): boolean => {
    const tok = tokens[i]
    if (tok === undefined || !("num" in tok) || (tok.raw !== "0" && tok.raw !== "1"))
      throw new Error(
        `path data: arc flag must be 0 or 1, got ${tok === undefined ? "the end" : "num" in tok ? tok.raw : tok.cmd} (token ${i}); write arc flags with separators`,
      )
    i++
    return tok.num !== 0
  }
  const tol = 0.1 / t.scale
  const push = (x: number, y: number) => poly.push([x * t.scale + t.x, y * t.scale + t.y])
  const close = () => {
    if (poly.length > 2) polys.push(poly)
    poly = []
  }
  const steps = (len: number) => Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tol) / 2)))
  while (i < tokens.length) {
    const tok = tokens[i] as Token
    if ("cmd" in tok) {
      cmd = tok.cmd
      i++
    } else if (cmd === "" || cmd.toUpperCase() === "Z")
      throw new Error(`path data: number ${tok.raw} with no command before it (token ${i})`)
    if (closed && cmd.toUpperCase() !== "M" && cmd.toUpperCase() !== "Z")
      throw new Error(
        `path data: subpath continues after Z with ${cmd}; start it with M (token ${i})`,
      )
    closed = false
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0
    switch (cmd.toUpperCase()) {
      case "M": {
        close()
        cx = ox + num()
        cy = oy + num()
        sx = cx
        sy = cy
        push(cx, cy)
        cmd = rel ? "l" : "L"
        break
      }
      case "L":
        cx = ox + num()
        cy = oy + num()
        push(cx, cy)
        break
      case "H":
        cx = ox + num()
        push(cx, cy)
        break
      case "V":
        cy = oy + num()
        push(cx, cy)
        break
      case "Q": {
        const x1 = ox + num()
        const y1 = oy + num()
        const x = ox + num()
        const y = oy + num()
        const n = steps(Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x - x1, y - y1))
        for (let k = 1; k <= n; k++) {
          const u = k / n
          const a = (1 - u) * (1 - u)
          const b = 2 * (1 - u) * u
          const c = u * u
          push(a * cx + b * x1 + c * x, a * cy + b * y1 + c * y)
        }
        cx = x
        cy = y
        break
      }
      case "C": {
        const x1 = ox + num()
        const y1 = oy + num()
        const x2 = ox + num()
        const y2 = oy + num()
        const x = ox + num()
        const y = oy + num()
        const len =
          Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2)
        const n = steps(len)
        for (let k = 1; k <= n; k++) {
          const u = k / n
          const v = 1 - u
          push(
            v * v * v * cx + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x,
            v * v * v * cy + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y,
          )
        }
        cx = x
        cy = y
        break
      }
      case "A": {
        const rx0 = num()
        const ry0 = num()
        const phi = (num() * Math.PI) / 180
        const large = flag()
        const sweep = flag()
        const x = ox + num()
        const y = oy + num()
        arc(cx, cy, rx0, ry0, phi, large, sweep, x, y, tol, push)
        cx = x
        cy = y
        break
      }
      case "Z":
        cx = sx
        cy = sy
        close()
        closed = true
        break
      default:
        throw new Error(`path data: unsupported command ${cmd} (supported: M L H V Q C A Z)`)
    }
  }
  close()
  return polys
}

/** SVG endpoint arc to points (spec F.6.5). */
const arc = (
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phi: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
  tol: number,
  push: (x: number, y: number) => void,
) => {
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const xp = cos * dx + sin * dy
  const yp = -sin * dx + cos * dy
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
  const den = rx * rx * yp * yp + ry * ry * xp * xp
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * rx * yp) / ry
  const cyp = (-coef * ry * xp) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (2 * Math.acos(Math.max(0, 1 - tol / rx)))))
  for (let k = 1; k <= n; k++) {
    const a = t1 + (dt * k) / n
    push(
      cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
      cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
    )
  }
}

/** Per-pixel coverage (0..1) of polygons under a fill rule, with 16 sub-scanlines per row. */
export const coverage = (
  polys: ReadonlyArray<ReadonlyArray<Pt>>,
  w: number,
  h: number,
  rule: "nonzero" | "evenodd",
): Float32Array => {
  const S = 16
  const out = new Float32Array(w * h)
  const edges: Array<[number, number, number, number, number]> = []
  for (const p of polys)
    for (let k = 0; k < p.length; k++) {
      const [ax, ay] = p[k] as Pt
      const [bx, by] = p[(k + 1) % p.length] as Pt
      if (ay === by) continue
      edges.push(ay < by ? [ax, ay, bx, by, 1] : [bx, by, ax, ay, -1])
    }
  // active-edge list: edges sorted by top, added as the scanline reaches them
  edges.sort((a, b) => a[1] - b[1])
  let next = 0
  let active: typeof edges = []
  const xs: Array<[number, number]> = []
  for (let row = 0; row < h; row++)
    for (let s = 0; s < S; s++) {
      const y = row + (s + 0.5) / S
      while (next < edges.length && (edges[next] as (typeof edges)[number])[1] <= y)
        active.push(edges[next++] as (typeof edges)[number])
      active = active.filter((e) => e[3] > y)
      xs.length = 0
      for (const [ax, ay, bx, by, dir] of active)
        if (y >= ay) xs.push([ax + ((y - ay) * (bx - ax)) / (by - ay), dir])
      if (xs.length === 0) continue
      xs.sort((a, b) => a[0] - b[0])
      let wind = 0
      for (let k = 0; k < xs.length - 1; k++) {
        wind += (xs[k] as [number, number])[1]
        const inside = rule === "nonzero" ? wind !== 0 : (wind & 1) === 1
        if (!inside) continue
        const xa = Math.max(0, (xs[k] as [number, number])[0])
        const xb = Math.min(w, (xs[k + 1] as [number, number])[0])
        if (xb <= xa) continue
        const base = row * w
        const ia = Math.floor(xa)
        const ib = Math.min(w - 1, Math.floor(xb))
        if (ia === ib) out[base + ia] = (out[base + ia] as number) + (xb - xa) / S
        else {
          out[base + ia] = (out[base + ia] as number) + (ia + 1 - xa) / S
          for (let ix = ia + 1; ix < ib; ix++) out[base + ix] = (out[base + ix] as number) + 1 / S
          if (ib < w) out[base + ib] = (out[base + ib] as number) + (xb - ib) / S
        }
      }
    }
  return out
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/** An RGBA canvas you paint paths onto (source-over, in sRGB like browsers do). */
export class Canvas {
  readonly w: number
  readonly h: number
  readonly px: Float32Array
  constructor(w: number, h: number, background?: string) {
    this.w = w
    this.h = h
    this.px = new Float32Array(w * h * 4)
    if (background !== undefined) this.rect(0, 0, w, h, background)
  }

  fill(d: string, color: string, t?: Transform, rule: "nonzero" | "evenodd" = "nonzero"): this {
    return this.paint(coverage(flatten(d, t), this.w, this.h, rule), color)
  }

  rect(x: number, y: number, w: number, h: number, color: string): this {
    return this.fill(`M${x} ${y}H${x + w}V${y + h}H${x}Z`, color)
  }

  private paint(cov: Float32Array, color: string): this {
    const [r, g, b] = rgb(color)
    for (let i = 0; i < cov.length; i++) {
      const a = Math.min(1, cov[i] as number)
      if (a <= 0) continue
      const o = i * 4
      const da = this.px[o + 3] as number
      const oa = a + da * (1 - a)
      for (const [c, v] of [
        [0, r],
        [1, g],
        [2, b],
      ] as const)
        this.px[o + c] = (v * a + (this.px[o + c] as number) * da * (1 - a)) / oa
      this.px[o + 3] = oa
    }
    return this
  }

  /** 8-bit RGBA, rounded. */
  bytes(): Uint8Array {
    const out = new Uint8Array(this.px.length)
    for (let i = 0; i < out.length; i++)
      out[i] = Math.round(
        (i % 4 === 3 ? (this.px[i] as number) * 255 : (this.px[i] as number)) || 0,
      )
    return out
  }
}

const chunk = (type: string, data: Uint8Array): Buffer => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Encodes 8-bit RGBA as PNG (RGB when fully opaque), choosing a filter per row. */
export const encodePng = (w: number, h: number, rgba: Uint8Array): Buffer => {
  let opaque = true
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) opaque = false
  const bpp = opaque ? 3 : 4
  const stride = w * bpp
  const raw = Buffer.alloc((stride + 1) * h)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++)
      for (let c = 0; c < bpp; c++) cur[x * bpp + c] = rgba[(y * w + x) * 4 + c] as number
    let best = 0
    let bestSum = Infinity
    let bestRow = cur
    for (const f of [0, 1, 2]) {
      const row = new Uint8Array(stride)
      let sum = 0
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? (cur[i - bpp] as number) : 0
        const v = ((cur[i] as number) - (f === 0 ? 0 : f === 1 ? left : (prev[i] as number))) & 255
        row[i] = v
        sum += v < 128 ? v : 256 - v
      }
      if (sum < bestSum) {
        best = f
        bestSum = sum
        bestRow = row
      }
    }
    raw[y * (stride + 1)] = best
    raw.set(bestRow, y * (stride + 1) + 1)
    prev.set(cur)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = opaque ? 2 : 6
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ])
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG to RGBA. Enough for comparing our own output. */
export const decodePng = (png: Uint8Array): { w: number; h: number; rgba: Uint8Array } => {
  const buf = Buffer.from(png)
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG")
  let off = 8
  let w = 0
  let h = 0
  let type = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const kind = buf.toString("latin1", off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (kind === "IHDR") {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      type = data[9] as number
      if (data[8] !== 8 || data[12] !== 0 || (type !== 2 && type !== 6))
        throw new Error("unsupported PNG layout")
    }
    if (kind === "IDAT") idat.push(data)
    off += 12 + len
  }
  const bpp = type === 6 ? 4 : 3
  const stride = w * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const rgba = new Uint8Array(w * h * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] as number
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? (cur[i - bpp] as number) : 0
      const b = prev[i] as number
      const c = i >= bpp ? (prev[i - bpp] as number) : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const pred =
        f === 0
          ? 0
          : f === 1
            ? a
            : f === 2
              ? b
              : f === 3
                ? (a + b) >> 1
                : pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c
      cur[i] = ((line[i] as number) + pred) & 255
    }
    for (let x = 0; x < w; x++)
      for (let ch = 0; ch < 4; ch++)
        rgba[(y * w + x) * 4 + ch] = ch < bpp ? (cur[x * bpp + ch] as number) : 255
    prev = cur
  }
  return { w, h, rgba }
}
