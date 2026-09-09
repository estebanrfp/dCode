// Text, by lines: the longest common subsequence two files share, the diff a
// commit shows, and the three-way merge a pull request needs. Pure functions
// over arrays of strings — no DOM, no database, nothing of dCode in them —
// which is why they live apart: the file that reads them is the one place a
// reader has to understand ordering, and it can be read on its own.
/** Longest common subsequence of two line arrays, as matched index pairs. */
export const lcs = (a, b) => {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const pairs = []
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}
/** Unified rows: { kind: "ctx" | "del" | "add", text }. */
export const diffLines = (a, b) => {
  const rows = []
  let i = 0, j = 0
  for (const [pi, pj] of [...lcs(a, b), [a.length, b.length]]) {
    while (i < pi) rows.push({ kind: "del", text: a[i++] })
    while (j < pj) rows.push({ kind: "add", text: b[j++] })
    if (pi < a.length) { rows.push({ kind: "ctx", text: a[pi] }); i = pi + 1; j = pj + 1 }
  }
  return rows
}
/**
 * diff3 by lines: a region changed on one side takes that side; changed the
 * same way on both, once; changed differently, conflict markers. Regions
 * are bounded by lines both sides left in place — adjacent changes are one
 * region, and a conflict, as in git.
 */
export const merge3 = (base, ours, theirs) => {
  const B = base.split("\n"), O = ours.split("\n"), T = theirs.split("\n")
  const mo = new Map(lcs(B, O)), mt = new Map(lcs(B, T))
  const same = (x, y) => x.length === y.length && x.every((l, k) => l === y[k])
  const out = []
  let conflicts = 0, bi = 0, oi = 0, ti = 0
  while (bi < B.length || oi < O.length || ti < T.length) {
    if (bi < B.length && mo.get(bi) === oi && mt.get(bi) === ti) { out.push(B[bi]); bi++; oi++; ti++; continue }
    let end = bi
    while (end < B.length && !(mo.has(end) && mt.has(end))) end++
    const oEnd = end < B.length ? mo.get(end) : O.length, tEnd = end < B.length ? mt.get(end) : T.length
    const bChunk = B.slice(bi, end), oChunk = O.slice(oi, oEnd), tChunk = T.slice(ti, tEnd)
    if (same(oChunk, bChunk)) out.push(...tChunk)
    else if (same(tChunk, bChunk) || same(oChunk, tChunk)) out.push(...oChunk)
    else { conflicts++; out.push("<<<<<<< ours", ...oChunk, "=======", ...tChunk, ">>>>>>> theirs") }
    bi = end; oi = oEnd; ti = tEnd
  }
  return { text: out.join("\n"), conflicts }
}
