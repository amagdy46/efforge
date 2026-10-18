type Op = { readonly kind: " " | "-" | "+"; readonly line: string }

const CONTEXT = 3

const lines = (text: string): string[] => {
  if (text === "") return []
  const parts = text.split("\n")
  if (parts.at(-1) === "") parts.pop()
  return parts
}

/** Line-level edit script via a longest-common-subsequence table (files here are small). */
const script = (a: string[], b: string[]): Op[] => {
  const n = a.length
  const m = b.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (table[i] as number[])[j] =
        a[i] === b[j]
          ? ((table[i + 1] as number[])[j + 1] as number) + 1
          : Math.max(
              (table[i + 1] as number[])[j] as number,
              (table[i] as number[])[j + 1] as number,
            )
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i] as string })
      i++
      j++
    } else if (
      ((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number)
    ) {
      ops.push({ kind: "-", line: a[i++] as string })
    } else {
      ops.push({ kind: "+", line: b[j++] as string })
    }
  }
  while (i < n) ops.push({ kind: "-", line: a[i++] as string })
  while (j < m) ops.push({ kind: "+", line: b[j++] as string })
  return ops
}

/** Unified diff of `before` -> `after` with 3 lines of context; empty string when equal. */
export const unifiedDiff = (
  file: string,
  before: string,
  after: string,
  labels: { before: string; after: string } = { before: "on disk", after: "efforge" },
): string => {
  const ops = script(lines(before), lines(after))
  const changed = ops.flatMap((op, i) => (op.kind === " " ? [] : [i]))
  if (changed.length === 0) return ""

  // group changes whose context windows touch into hunks
  const ranges: Array<[number, number]> = []
  for (const idx of changed) {
    const start = Math.max(0, idx - CONTEXT)
    const end = Math.min(ops.length, idx + CONTEXT + 1)
    const last = ranges.at(-1)
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  }

  const out = [`--- ${file} (${labels.before})`, `+++ ${file} (${labels.after})`]
  for (const [start, end] of ranges) {
    const slice = ops.slice(start, end)
    const before0 = ops.slice(0, start).filter((o) => o.kind !== "+").length
    const after0 = ops.slice(0, start).filter((o) => o.kind !== "-").length
    const bCount = slice.filter((o) => o.kind !== "+").length
    const aCount = slice.filter((o) => o.kind !== "-").length
    out.push(
      `@@ -${bCount === 0 ? before0 : before0 + 1},${bCount} +${aCount === 0 ? after0 : after0 + 1},${aCount} @@`,
    )
    for (const op of slice) out.push(`${op.kind}${op.line}`)
  }
  return `${out.join("\n")}\n`
}
