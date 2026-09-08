// dCode — code with a timeline, and no server.
//
// A repository, a branch, a commit, a pull request and every LINE of the code
// being edited are nodes in a GenosDB graph that lives in each visitor's
// browser and syncs peer-to-peer over WebRTC. The editor is the block editor
// applied to code: one node per line, ordered by fractional keys, edited live
// by everyone on the branch with named carets — the shared buffer. History is
// owned: the Security Manager signs every write and every peer verifies it,
// so a commit can only be created by its author under an id that carries the
// author's address, and a branch head can only be moved by the branch's owner
// or an address the owner granted. Every commit is a whole single-file HTML
// project, so the buffer and every row of the timeline run, beside the code.
import { CONSTITUTION, DEMO_IDENTITIES, governanceRules } from "./constitution.js"
import { mountAgent } from "./agent.js"

const $ = (id) => document.getElementById(id)
const eqAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const AUTHORITY = CONSTITUTION.authority
let me = null, session = {}

// ── Theme: system → light → dark, the guide's toggle (index.html set the first paint) ──
// `data-pref` is what the reader asked for; `data-theme` is the palette in force, the only thing the CSS reads.
const THEME_ORDER = ["system", "light", "dark"], systemTheme = matchMedia("(prefers-color-scheme: light)")
const applyTheme = (pref) => {
  const root = document.documentElement
  root.dataset.pref = pref
  root.dataset.theme = pref === "system" ? (systemTheme.matches ? "light" : "dark") : pref
  localStorage.theme = pref
  const b = $("theme-btn"); if (b) b.title = `Theme: ${pref}`
}
systemTheme.addEventListener("change", () => { if (document.documentElement.dataset.pref === "system") applyTheme("system") }) // on `system` the OS can change under us
applyTheme(localStorage.theme ?? "system")

// The shell shows before a byte of the engine arrives; what follows can be
// slow (a CDN, the relays) or fail, and either must be visible.
const boot = async (step, fn) => {
  try { return await fn() }
  catch (err) { $("main").innerHTML = `<p class="loading">Could not ${esc(step)}: ${esc(err.message)}</p><p class="muted">Reload to try again. dCode needs cdn.jsdelivr.net for the engine and a relay to meet peers.</p>`; throw err }
}
const { gdb } = await boot("load the GenosDB engine from cdn.jsdelivr.net", () => import("https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.min.js"))

// `?room=` opens a private sandbox of the same site (the tests use it, so can
// you); `?relay=` points signalling at a relay of your own.
const params = new URLSearchParams(location.search)
const ROOM = params.get("room") ?? "dcode"
const RELAY = params.get("relay")
const PASSKEYS_AVAILABLE = window.isSecureContext && !!window.PublicKeyCredential && !/^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname)

// ── Boot: the constitution travels beside the root of trust ─────────────────
const db = await boot("open the graph on this device", () => gdb(ROOM, {
  rtc: RELAY ? { relayUrls: [RELAY] } : true,
  sm: { superAdmins: [AUTHORITY], customRoles: CONSTITUTION.roles, ...(governanceRules.length && { governanceRules }), acls: true },
}))
globalThis.db = db // console handle, as in the official examples

// ── The store: one subscription, every kind of node ─────────────────────────
const nodes = new Map() // id → { id, value, timestamp }
const of = (type) => [...nodes.values()].filter((n) => n.value.type === type)
const byNewest = (a, b) => b.value.at - a.value.at || (a.id < b.id ? -1 : 1)
const byOldest = (a, b) => a.value.at - b.value.at || (a.id < b.id ? -1 : 1)
const byOrder = (a, b) => a.value.order - b.value.order || (a.id < b.id ? -1 : 1) // the engine's rule: key, then id

// ── Derivations: pure functions of the store ────────────────────────────────
const repos = () => of("repo").sort(byNewest)
const branchesOf = (repo) => of("branch").filter((n) => n.value.repo === repo).sort(byOldest)
const commitsOf = (repo) => of("commit").filter((n) => n.value.repo === repo).sort(byNewest)
const prsOf = (repo) => of("pr").filter((n) => n.value.repo === repo).sort(byNewest)
const linesOf = (branch) => of("line").filter((n) => n.value.branch === branch).sort(byOrder)
const commitOf = (id) => (id && nodes.get(id)?.value.type === "commit" ? nodes.get(id) : null)
const contentOf = (id) => commitOf(id)?.value.content ?? plain.get(id) ?? ""
/** Every commit reachable from `id`, itself included. */
const ancestors = (id) => {
  const seen = new Set(), stack = id ? [id] : []
  while (stack.length) { const c = stack.pop(); if (!c || seen.has(c)) continue; seen.add(c); stack.push(...(commitOf(c)?.value.parents ?? [])) }
  return seen
}
const isAncestor = (a, b) => !!a && ancestors(b).has(a)
/** The newest common ancestor of two commits. */
const mergeBase = (a, b) => { const A = ancestors(a); return [...ancestors(b)].map(commitOf).filter(Boolean).sort(byNewest).find((c) => A.has(c.id))?.id ?? null }
const tipsAt = (branches, id) => branches.filter((b) => b.value.head === id)
/** The engine's rule for the branch node: its owner, or a `write`/`delete` collaborator. */
const canWriteBranch = (b) => !!me && !!b && (eqAddr(b.value.owner, me) || ["write", "delete"].includes(b.value.collaborators?.[me]))
/** Merged is a fact of the graph: the proposed commit is an ancestor of the target's head. */
const prStatus = (pr) => {
  if (pr.value.closed) return "withdrawn"
  const into = nodes.get(pr.value.into), from = nodes.get(pr.value.from)
  if (into && isAncestor(pr.value.commit, into.value.head)) return "merged"
  return from && from.value.head !== pr.value.commit ? "open, behind" : "open"
}
const defaultBranch = (repo, branches) => branches.find((b) => eqAddr(b.value.owner, repo.value.owner) && b.value.name === "main") ?? branches.find((b) => eqAddr(b.value.owner, repo.value.owner)) ?? branches[0] ?? null

// ── Text: a diff by lines and a three-way merge, enough for one file ────────
/** Longest common subsequence of two line arrays, as matched index pairs. */
const lcs = (a, b) => {
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
const diffLines = (a, b) => {
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
const merge3 = (base, ours, theirs) => {
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
const sha = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("")

// ── Private repositories: the engine keeps the key, the app seals the code ──
// A private repository has a vault: one encrypted node (`db.sm.put`) holding
// its key ring, newest key first. The owner grants `read` on that one node to
// each member — a key envelope per reader, wrapped and rotated by the engine —
// and every line and every commit of the repository is sealed with the current
// key before it is written as an ordinary node. Members open it on arrival;
// everyone else syncs ciphertext. Revoking a member turns both keys: the
// vault's, by the engine, and the repository's, a new one on the ring, so
// what is written afterwards is unreadable to them.
const keyRings = new Map()  // repo id → CryptoKey[] newest first · null = asked, no envelope · absent = not asked yet
const unlocking = new Set() // repositories whose vault is being fetched
const plain = new Map()     // commit id → content, for a sealed commit this session wrote
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const newKeyHex = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")
const importKey = (hex) => crypto.subtle.importKey("raw", Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16)), "AES-GCM", false, ["encrypt", "decrypt"])
const seal = async (repo, text) => {
  const key = keyRings.get(repo)?.[0]; if (!key) throw new Error("No key for this repository on this device")
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return `${b64(iv)}.${b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text))))}`
}
const unseal = async (repo, sealed) => {
  const [iv, ct] = sealed.split(".").map(unb64)
  for (const key of keyRings.get(repo) ?? []) { try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)) } catch {} }
  return null
}
/** Fetch the vault: with an envelope the ring opens; without one the repository stays sealed for this identity. */
const unlock = async (repoId) => {
  const repo = nodes.get(repoId); if (!repo?.value.vault || !me || unlocking.has(repoId)) return false
  unlocking.add(repoId)
  try {
    const { result } = await db.sm.get(repo.value.vault).catch(() => ({ result: null }))
    if (!result?.decrypted || !Array.isArray(result.value.keys)) { keyRings.set(repoId, null); return false }
    keyRings.set(repoId, await Promise.all(result.value.keys.map(importKey)))
    await decryptStored(repoId)
    return true
  } finally { unlocking.delete(repoId); scheduleRender() }
}
/** Open every sealed line and commit of the repository already in the store, then redraw. */
const decryptStored = async (repoId) => {
  for (const n of [...nodes.values()]) {
    if (n.value.repo !== repoId || n.value.ct === undefined) continue
    const text = await unseal(repoId, n.value.ct)
    if (text === null) continue
    if (n.value.type === "line") n.value.text = text; else if (n.value.type === "commit") n.value.content = text
  }
  if (current?.repo === repoId) mountBuffer(current.repo, current.branch)
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const abbr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "")
const DEMO_NAMES = Object.fromEntries(DEMO_IDENTITIES.map((i) => [i.address.toLowerCase(), i.name]))
const nameOf = (addr) => DEMO_NAMES[addr?.toLowerCase()] || abbr(addr)
const short = (id) => (id ? id.split(":").pop().slice(0, 7) : "—")
const branchLabel = (repo, b) => (eqAddr(b.value.owner, repo.value.owner) ? b.value.name : `${nameOf(b.value.owner)}/${b.value.name}`)
const ago = (at) => {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return "just now"
  const [n, u] = s < 3600 ? [Math.floor(s / 60), "minute"] : s < 86400 ? [Math.floor(s / 3600), "hour"] : [Math.floor(s / 86400), "day"]
  return `${n} ${u}${n === 1 ? "" : "s"} ago`
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`
const say = (id, text) => { const el = $(id); if (el) el.textContent = text }
let noticeTimer
const notice = (text) => { const el = $("notice"); el.textContent = text; el.classList.remove("hidden"); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => el.classList.add("hidden"), 7000) }
const pendingMerge = new Map() // branch id → { parents, message } of a merge waiting for its conflicts to be resolved

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Hello, dCode</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0f12; color: #e8eaed; font: 18px system-ui, sans-serif; text-align: center; }
  button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 1px solid #4c8dff; background: none; color: inherit; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Hello from dCode</h1>
  <p>This page is one commit. Edit it, commit, and run any version from the timeline.</p>
  <button id="count">Clicked 0 times</button>
</main>
<script>
  let n = 0
  document.getElementById("count").onclick = (e) => { e.target.textContent = "Clicked " + (++n) + (n === 1 ? " time" : " times") }
</script>
</body>
</html>
`

// ── Writes ──────────────────────────────────────────────────────────────────
// History is owned. No id: with `owner` on the value the engine names the
// node `${owner}:${uuid}`, an owned id every peer enforces. A commit names
// itself: the author's address and a hash of what it holds — nobody else can
// create it, on any peer. The buffer is shared: a line is a plain node
// anyone on the branch may rewrite, which is what a shared editor is.
const create = async (value, id) => {
  await db.sm.executeWithPermission("write") // the engine's own verdict, before the write
  return db.sm.acls.set({ ...value, at: Date.now() }, id)
}
const patch = (id, fields) => db.sm.acls.set(fields, id) // the owner, or a `write` collaborator; the engine merges into the stored node
const newCommit = async ({ repo, branch, parents, message, content }) => {
  const at = Date.now()
  const id = `${me}:${(await sha([repo, parents.join(","), message, content, at].join("\n"))).slice(0, 40)}`
  await db.sm.executeWithPermission("write")
  const body = keyRings.get(repo) ? { ct: await seal(repo, content) } : { content } // a private repository's code travels sealed
  if (body.ct) plain.set(id, content)
  await db.sm.acls.set({ type: "commit", repo, branch, parents, message, ...body, at }, id)
  return id
}
// Fresh keys strictly between two neighbours: the gap is split once into n
// equal slots and each key lands at a random point of its slot, so
// concurrent inserts into the same gap almost never tie — and a paste of a
// thousand lines costs the precision of one insert, not one halving per line.
const keysBetween = (prev, next, n = 1) => {
  const lo = prev ?? 0, step = ((next ?? lo + n) - lo) / n
  return Array.from({ length: n }, (_, i) => lo + step * (i + 0.25 + Math.random() * 0.5))
}
const keyBetween = (prev, next) => keysBetween(prev, next)[0]
const putLine = async (repo, branch, text, order, id) =>
  db.put(keyRings.get(repo) ? { type: "line", repo, branch, order, ct: await seal(repo, text) } : { type: "line", repo, branch, text, order }, id)
/** A branch's buffer, from a file: one node per line, keys 1…n. */
const seedLines = (repo, branch, content) => Promise.all(content.split("\n").map((text, i) => putLine(repo, branch, text, i + 1)))
const newRepo = async (name, description, content, isPrivate) => {
  const repo = await create({ type: "repo", name, description })
  if (isPrivate) { // the vault: one encrypted node with this session's envelope on it, and the first key on the ring
    const hex = newKeyHex()
    const vault = await db.sm.put({ type: "vault", repo, keys: [hex] })
    keyRings.set(repo, [await importKey(hex)])
    await patch(repo, { vault })
  }
  const branch = await create({ type: "branch", repo, name: "main", head: null })
  await seedLines(repo, branch, content)
  const head = await newCommit({ repo, branch, parents: [], message: "Initial commit", content })
  await patch(branch, { head })
  return { repo, branch }
}
/** A commit on a branch you may move: the new head, with the branch's head (and any merge parents) as parents. */
const commitTo = async (branch, message, content, extraParents = []) => {
  const parents = [...(branch.value.head ? [branch.value.head] : []), ...extraParents]
  const id = await newCommit({ repo: branch.value.repo, branch: branch.id, parents, message, content })
  await patch(branch.id, { head: id })
  return id
}
/** A branch you own in this repository, from the branch you stood on: its buffer copied, your commit on it. */
const forkAndCommit = async (from, message, content) => {
  const branch = await create({ type: "branch", repo: from.value.repo, name: from.value.name, head: from.value.head })
  await seedLines(from.value.repo, branch, content)
  const id = await newCommit({ repo: from.value.repo, branch, parents: from.value.head ? [from.value.head] : [], message, content })
  await patch(branch, { head: id })
  return { branch, id }
}
/**
 * Bring a branch's buffer to `text` with the fewest writes: lines both have
 * stay (their ids, their carets); a replaced line is rewritten in place;
 * the rest are inserted between their neighbours or removed.
 */
const applyText = async (branchId, text) => {
  const repo = nodes.get(branchId)?.value.repo
  const cur = linesOf(branchId), A = cur.map((n) => n.value.text), B = text.split("\n")
  const ops = []
  let i = 0, j = 0
  for (const [pi, pj] of [...lcs(A, B), [A.length, B.length]]) {
    const gone = cur.slice(i, pi), fresh = B.slice(j, pj), reuse = Math.min(gone.length, fresh.length)
    for (let k = 0; k < reuse; k++) if (gone[k].value.text !== fresh[k]) ops.push(db.put({ ...gone[k].value, text: fresh[k] }, gone[k].id))
    for (let k = reuse; k < gone.length; k++) ops.push(db.remove(gone[k].id))
    if (fresh.length > reuse) {
      const lo = (reuse ? gone[reuse - 1] : cur[i - 1])?.value.order, hi = cur[pi]?.value.order
      const keys = keysBetween(lo, hi, fresh.length - reuse)
      fresh.slice(reuse).forEach((t, k) => ops.push(putLine(repo, branchId, t, keys[k])))
    }
    if (pi < A.length) { i = pi + 1; j = pj + 1 } else { i = pi; j = pj }
  }
  await Promise.all(ops)
}
const mergePR = async (pr) => {
  const repo = nodes.get(pr.value.repo), into = nodes.get(pr.value.into), from = nodes.get(pr.value.from), theirs = commitOf(pr.value.commit)
  if (!repo || !into || !from || !theirs) return notice("The pull request's branch or commit has not synced here yet.")
  if (!canWriteBranch(into)) return notice(`Only the owner of ${branchLabel(repo, into)} can merge into it.`)
  const ours = commitOf(into.value.head)
  if (!ours || isAncestor(ours.id, theirs.id)) {
    await patch(into.id, { head: theirs.id })
    await applyText(into.id, theirs.value.content)
    return notice(`Fast-forwarded ${branchLabel(repo, into)} to ${short(theirs.id)}.`)
  }
  const message = `Merge ${branchLabel(repo, from)} into ${branchLabel(repo, into)}`
  const { text, conflicts } = merge3(contentOf(mergeBase(ours.id, theirs.id)), ours.value.content, theirs.value.content)
  if (!conflicts) {
    const id = await commitTo(into, message, text, [theirs.id])
    await applyText(into.id, text)
    return notice(`Merged as ${short(id)}: both sides' changes, no conflicts.`)
  }
  // The conflicts go to the target's shared buffer, marked; the commit made from there is the merge.
  pendingMerge.set(into.id, { parents: [theirs.id], message })
  await applyText(into.id, text)
  location.hash = `#/r/${repo.id}/${into.id}`
  render()
  notice(`${plural(conflicts, "conflict")}. Resolve the marked lines in the editor and commit: that commit will be the merge.`)
}

// ── The buffer: the block editor, for code ──────────────────────────────────
// One node per line `{ text, order }`, keyed fractionally, edited by everyone
// on the branch. Line-level LWW: two people on different lines never collide;
// two on the SAME line keep both edits when they touch different places (the
// engine's rescue, painted under the caret by updateLine). Enter splits a line into two
// nodes, Backspace at its start merges it back, Alt+↑/↓ moves it with a new
// key, a multi-line paste mints its keys in one batch. Live typing and the
// carets ride one ephemeral channel; the debounced put is the truth.
let current = null // { repo, branch } of the mounted buffer
const buffer = () => $("buffer")
const orderOf = (li) => parseFloat(li.dataset.order)
const isLine = (el) => !!el?.classList?.contains("line")
const shown = (el) => isLine(el) && el.offsetParent !== null // a neighbour the current view shows: the caret never hops into a hidden line
const fieldOf = (li) => li?.querySelector("textarea")
function placeSorted(li) {
  const next = [...buffer().children].find((el) => el !== li && (orderOf(el) > orderOf(li) || (orderOf(el) === orderOf(li) && el.id > li.id)))
  buffer().insertBefore(li, next ?? null)
}
const caretTo = (li, pos) => { const ta = fieldOf(li); if (!ta) return; if (li.offsetParent === null && li.dataset.lang) showView(li.dataset.lang); ta.focus(); ta.setSelectionRange(pos, pos) } // a line the view hides pulls its view up
// "The user is typing here RIGHT NOW" — a window that lost the system focus
// keeps naming its last textarea, so the line would freeze in the second window.
const isMine = (ta) => ta === document.activeElement && document.hasFocus()
const paint = (ta, text) => {
  const { selectionStart: from, selectionEnd: to } = ta
  ta.value = text
  ta.setSelectionRange(Math.min(from, text.length), Math.min(to, text.length))
  highlight(ta.closest(".line"))
}
/** The buffer as you see it: what a commit takes, what the dirty flag compares. */
const domText = () => [...buffer().children].map((li) => fieldOf(li).value).join("\n")

// One debounced save per line, so typing costs one put per pause. A commit
// flushes them first: what you see is what it takes.

// The text the graph last confirmed for each line, and the same one-region
// merge the engine makes: when a value lands on the line being typed in, the
// keystrokes not yet written stay and the rest lands.
const known = new Map()
const region = (base, text) => {
  let from = 0; while (from < base.length && from < text.length && base[from] === text[from]) from++
  let tail = 0; while (tail < base.length - from && tail < text.length - from && base[base.length - 1 - tail] === text[text.length - 1 - tail]) tail++
  return { from, to: base.length - tail, ins: text.slice(from, text.length - tail) }
}
const mergeText = (base, mine, theirs) => {
  const m = region(base, mine), t = region(base, theirs)
  if (!t.ins && t.from === t.to) return mine // nothing new landed: the echo of this window's own save
  if (!m.ins && m.from === m.to) return theirs
  if (m.from === m.to && t.from === t.to && m.from === t.from) return base.slice(0, m.from) + t.ins + m.ins + base.slice(m.from) // both inserted at one point: what landed, then what is being typed
  const [a, b] = [m, t].sort((x, y) => x.from - y.from || x.to - y.to)
  if (a.to > b.from || (a.from === b.from && a.to === b.to)) return theirs // the same span changed twice: the graph's
  return base.slice(0, a.from) + a.ins + base.slice(a.to, b.from) + b.ins + base.slice(b.to)
}
const savers = new Map()
const saveNow = (id, li) => { savers.delete(id); known.set(id, fieldOf(li).value); return putLine(li.dataset.repo, li.dataset.branch, fieldOf(li).value, orderOf(li), id) }
function scheduleSave(id, li) { clearTimeout(savers.get(id)); savers.set(id, setTimeout(() => saveNow(id, li), 250)) }
const cancelSave = (id) => { clearTimeout(savers.get(id)); savers.delete(id) }
const flushSaves = () => Promise.all([...savers.keys()].map((id) => { clearTimeout(savers.get(id)); const li = $(id); return li ? saveNow(id, li) : savers.delete(id) }))

let focusNextId = null, focusNextPos = 0
const putHere = (text, order) => putLine(current.repo, current.branch, text, order)
async function insertAfter(li) {
  const next = li?.nextElementSibling
  focusNextId = await putHere("", keyBetween(li ? orderOf(li) : undefined, isLine(next) ? orderOf(next) : undefined))
  caretTo($(focusNextId), 0)
}
// Enter: the text left of the caret keeps this node; the text right of it
// becomes a NEW node in the gap below. Two ops on two nodes.
async function splitLine(li, ta) {
  const original = ta.value, before = original.slice(0, ta.selectionStart), after = original.slice(ta.selectionEnd)
  const unsaved = savers.has(li.id) // keystrokes the graph has not seen yet
  cancelSave(li.id)
  ta.value = before
  const next = li.nextElementSibling
  const order = keyBetween(orderOf(li), isLine(next) ? orderOf(next) : undefined)
  if (unsaved || before !== original) await putLine(li.dataset.repo, li.dataset.branch, before, orderOf(li), li.id)
  const indent = /^\s*/.exec(before)[0] // a code editor keeps the indentation
  focusNextPos = indent.length
  focusNextId = await putHere(indent + after, order)
  caretTo($(focusNextId), indent.length)
}
// Backspace at the start: this line joins the previous node, and this node is removed.
async function mergeLine(prevLi, li, ta) {
  const prevTa = fieldOf(prevLi)
  cancelSave(li.id); cancelSave(prevLi.id)
  const joinAt = prevTa.value.length
  prevTa.value += ta.value
  dropLine(li)
  prevTa.focus(); prevTa.setSelectionRange(joinAt, joinAt)
  await putLine(prevLi.dataset.repo, prevLi.dataset.branch, prevTa.value, orderOf(prevLi), prevLi.id)
  await db.remove(li.id)
}
// Alt+↑/↓: a line moves by taking a key between its new neighbours — one put on the same node.
async function moveLine(li, ta, dir) {
  const over = dir < 0 ? li.previousElementSibling : li.nextElementSibling
  if (!shown(over)) return
  const [prev, next] = dir < 0 ? [over.previousElementSibling, over] : [over, over.nextElementSibling]
  const order = keyBetween(isLine(prev) ? orderOf(prev) : undefined, isLine(next) ? orderOf(next) : undefined)
  focusNextId = li.id; focusNextPos = ta.selectionStart
  cancelSave(li.id)
  await putLine(li.dataset.repo, li.dataset.branch, ta.value, order, li.id)
}

function createLine(id, { repo, branch, text, order }) {
  const li = document.createElement("div")
  li.className = "line"; li.id = id
  Object.assign(li.dataset, { repo, branch, order })
  const ln = document.createElement("span"); ln.className = "ln"
  const cell = document.createElement("div"); cell.className = "cell"
  const hl = document.createElement("pre"); hl.className = "hl"; hl.setAttribute("aria-hidden", "true")
  const ta = document.createElement("textarea")
  ta.rows = 1; ta.wrap = "off"; ta.spellcheck = false; ta.value = text; known.set(id, text)
  ta.setAttribute("aria-label", "Line")

  ta.addEventListener("input", () => {
    scheduleSave(id, li)
    liveDirty = true // this keystroke travels the room NOW, not in 250 ms
    announce()
    renderMarks() // my typing shifts the text under a remote caret
    highlight(li); scheduleLayout() // the colours follow the keystroke; a tag typed here may move a language boundary
    afterChange()
  })
  ta.addEventListener("keydown", async (e) => {
    if (allSelected) return // buffer-selection mode: the document handles keys
    if (e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); extendRange(li, e.key === "ArrowUp" ? -1 : 1); return }
    if (range) { // whole lines selected: Backspace and Delete take them, Escape lets go, the clipboard shortcuts reach the document, anything else is the caret again
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); await deleteRange(); return }
      if (e.key === "Escape") { e.preventDefault(); setRange(null); return }
      if (e.key === "Shift" || e.metaKey || e.ctrlKey) return
      setRange(null)
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && ta.selectionStart === 0 && ta.selectionEnd === ta.value.length) {
      e.preventDefault(); setAllSelected(true); return // the second Ctrl/Cmd+A: the whole buffer
    }
    if (e.key === "Enter") { e.preventDefault(); await splitLine(li, ta) }
    else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input", { bubbles: true })) }
    else if (e.key === "Backspace" && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const prev = li.previousElementSibling
      if (!shown(prev)) return
      e.preventDefault(); await mergeLine(prev, li, ta)
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); await moveLine(li, ta, e.key === "ArrowUp" ? -1 : 1) }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const target = e.key === "ArrowUp" ? li.previousElementSibling : li.nextElementSibling
      if (!shown(target)) return
      e.preventDefault(); caretTo(target, Math.min(ta.selectionStart, fieldOf(target).value.length)) // the column survives the hop
    }
  })
  // Pasting multi-line text does what the model preaches: every line becomes
  // its own node. The first line joins the text left of the caret, the last
  // the text right of it, and the caret lands at the end of what was pasted.
  ta.addEventListener("paste", async (e) => {
    if (range) return // whole lines selected: the document replaces them
    const pasted = e.clipboardData?.getData("text/plain") ?? ""
    if (!pasted.includes("\n")) return
    e.preventDefault()
    const lines = pasted.replace(/\r/g, "").split("\n")
    const after = ta.value.slice(ta.selectionEnd)
    cancelSave(id)
    ta.value = ta.value.slice(0, ta.selectionStart) + lines[0]
    await putLine(li.dataset.repo, li.dataset.branch, ta.value, orderOf(li), id)
    const nextEl = li.nextElementSibling
    const keys = keysBetween(orderOf(li), isLine(nextEl) ? orderOf(nextEl) : undefined, lines.length - 1)
    for (let i = 1; i < lines.length; i++) {
      const isLast = i === lines.length - 1
      const text = isLast ? lines[i] + after : lines[i]
      if (isLast) { focusNextPos = lines[i].length; focusNextId = await putHere(text, keys[i - 1]) }
      else await putHere(text, keys[i - 1])
    }
    caretTo($(focusNextId), focusNextPos)
  })
  // While you type, your view is yours; on blur you rejoin the graph's truth,
  // which already holds the LWW outcome of any concurrent edit. A save still
  // pending is flushed first: your own keystrokes never revert.
  ta.addEventListener("blur", async () => {
    if (savers.has(id)) { clearTimeout(savers.get(id)); await saveNow(id, li); return }
    const { result } = await db.get(id)
    if (result && ta.value !== result.value.text) { ta.value = result.value.text; afterChange() }
  })

  cell.append(hl, ta); li.append(ln, cell)
  placeSorted(li)
  li.dataset.lang = li.previousElementSibling?.dataset.langNext ?? "html" // its language, until the layout pass confirms it: a new line inside <style> must be visible in the CSS view to take the caret
  highlight(li)
  if (id === focusNextId) { focusNextId = null; ta.focus(); ta.setSelectionRange(focusNextPos, focusNextPos); focusNextPos = 0 }
  scheduleLayout(); renderMarks(); afterChange()
}
function updateLine(id, { text, order }) {
  const li = $(id); if (!li) return
  if (orderOf(li) !== order) {
    li.dataset.order = order; placeSorted(li); scheduleLayout()
    if (id === focusNextId) { focusNextId = null; caretTo(li, focusNextPos); focusNextPos = 0 } // the move you asked for: the caret comes along
  }
  const ta = fieldOf(li)
  // The live channel may have painted this text already — then this is a
  // no-op; when it differs, the graph lands. On the line being typed in RIGHT
  // NOW it lands merged: the keystrokes not yet written stay and the caret
  // shifts by what landed before it — the next save carries both, so the
  // engine's rescue is never undone.
  if (ta.value !== text) {
    if (isMine(ta)) {
      const caret = ta.selectionStart, base = known.get(id) ?? ta.value, r = region(base, text)
      ta.value = mergeText(base, ta.value, text); highlight(li); scheduleLayout()
      const at = caret + (r.from <= caret ? r.ins.length - (r.to - r.from) : 0)
      ta.setSelectionRange(at, at)
    } else {
      paint(ta, text)
      li.classList.remove("remote"); void li.offsetWidth; li.classList.add("remote") // restart the flash
    }
    renderMarks()
  }
  known.set(id, text)
  afterChange()
}
function dropLine(li) { li.remove(); scheduleLayout(); renderMarks(); afterChange() }
/**
 * Line numbers are positions, derived; the buffer is as wide as its longest
 * line; and every line knows the language it is in — HTML, the CSS inside a
 * <style> block, the JavaScript inside a <script> block — for its colours and
 * for the views. The tag lines themselves are HTML.
 */
function relayout() {
  paintRange() // a line that arrived or left under the selection
  const list = [...buffer().children]
  const seen = { html: 0, css: 0, js: 0 }
  let longest = 60, state = "html", opener = null, pull = null
  list.forEach((li, i) => {
    const t = fieldOf(li).value
    li.firstChild.textContent = i + 1; longest = Math.max(longest, t.length)
    let lang = state
    if (state === "html") { if (/<style\b/i.test(t)) state = /<\/style>/i.test(t) ? "html" : "css"; else if (/<script\b(?![^>]*\bsrc=)/i.test(t)) state = /<\/script>/i.test(t) ? "html" : "js" }
    else if (state === "css" && /<\/style>/i.test(t)) { state = "html"; lang = "html" }
    else if (state === "js" && /<\/script>/i.test(t)) { state = "html"; lang = "html" }
    if (li.dataset.lang !== lang) { li.dataset.lang = lang; highlight(li) }
    li.dataset.langNext = state
    seen[lang]++
    // The HTML view folds the two blocks to their tag lines: the opener says how much it hides, and where it is edited.
    if (lang === "html") { if (opener) { opener.dataset.fold = `${plural(seen[opener.dataset.langNext] - opener.dataset.seen, "line")} of ${opener.dataset.langNext.toUpperCase()} — the ${opener.dataset.langNext.toUpperCase()} view`; opener = null } if (state !== "html") { opener = li; li.dataset.seen = seen[state]; li.style.setProperty("--fold-at", `${t.length}ch`) } else delete li.dataset.fold }
    else if (li.contains(document.activeElement)) pull = lang // typing into a block from the HTML view: the view follows the caret
  })
  if (opener) opener.dataset.fold = `${plural(seen[opener.dataset.langNext] - opener.dataset.seen, "line")} of ${opener.dataset.langNext.toUpperCase()} — the ${opener.dataset.langNext.toUpperCase()} view`
  if (pull && (buffer().dataset.view ?? "html") === "html") { showView(pull); return }
  buffer().style.setProperty("--cols", longest + 2)
  const view = buffer().dataset.view ?? "html"
  $("view-hint").textContent = view !== "html" && !seen[view] ? `no <${view === "css" ? "style" : "script"}> block in this file — add one in the HTML view` : ""
}
let layoutQueued = false
const scheduleLayout = () => { if (layoutQueued) return; layoutQueued = true; requestAnimationFrame(() => { layoutQueued = false; if (buffer()) relayout() }) }

// ── Colours: a small tokenizer per language, painted under the transparent text ──
const tok = (cls, s) => `<span class="t-${cls}">${esc(s)}</span>`
const paintTokens = (s, re, classify) => {
  let out = "", last = 0
  for (const m of s.matchAll(re)) { out += esc(s.slice(last, m.index)) + classify(m); last = m.index + m[0].length }
  return out + esc(s.slice(last))
}
const ATTRS = /([^\s=\/>]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s>]+)?/g
const HL = {
  html: (s) => paintTokens(s, /(<!--.*?(?:-->|$))|(<!DOCTYPE\b[^>]*>)|(<\/?)([a-zA-Z][\w:.-]*)([^>]*?)(\/?>|$)|(&[a-zA-Z#0-9]+;)/gi, (m) =>
    m[1] ? tok("com", m[1]) : m[2] ? tok("kw", m[2]) : m[7] ? tok("num", m[7])
      : tok("punct", m[3]) + tok("tag", m[4]) + paintTokens(m[5], ATTRS, (a) => tok("attr", a[1]) + esc(a[2] ?? "") + (a[3] ? tok("str", a[3]) : "")) + tok("punct", m[6])),
  css: (s) => paintTokens(s, /(\/\*.*?(?:\*\/|$))|("[^"]*"|'[^']*')|([^{};:\s][^{;]*?)(?=\s*\{)|([-\w]+)(?=\s*:)|(#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+[a-z%]*)|([{}();,:])/g, (m) =>
    m[1] ? tok("com", m[1]) : m[2] ? tok("str", m[2]) : m[3] ? tok("sel", m[3]) : m[4] ? tok("prop", m[4]) : m[5] ? tok("num", m[5]) : tok("punct", m[6])),
  js: (s) => paintTokens(s, /(\/\/.*$|\/\*.*?(?:\*\/|$))|(`(?:\\.|[^`\\])*`?|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)|\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|of|in|this|null|undefined|true|false|yield|static|delete|void)\b|(\b\d[\w.]*)|([A-Za-z_$][\w$]*)(?=\s*\()|([{}()[\];,.=+\-*\/%<>!&|?:^~]+)/g, (m) =>
    m[1] ? tok("com", m[1]) : m[2] ? tok("str", m[2]) : m[3] ? tok("kw", m[3]) : m[4] ? tok("num", m[4]) : m[5] ? tok("fn", m[5]) : tok("punct", m[6])),
}
const highlight = (li) => { const pre = li?.querySelector(".hl"); if (pre) pre.innerHTML = HL[li.dataset.lang ?? "html"](fieldOf(li).value) }

/** The editor shows this branch's lines; the store keeps feeding it while it is mounted. */
function mountBuffer(repo, branch) {
  current = { repo, branch }
  buffer().replaceChildren()
  for (const n of linesOf(branch)) if (n.value.text !== undefined) createLine(n.id, n.value) // a sealed line waits for its key
  relayout()
  runPreview(domText(), "the buffer")
  afterChange()
}
// A change to the buffer, local or remote: the dirty flag and the running
// page follow, a moment after the last keystroke.
let changeTimer = null, previewTimer = null, lastRun = null
function afterChange() {
  clearTimeout(changeTimer); changeTimer = setTimeout(renderRepoBar, 120)
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => { if ($("autorun")?.checked && current) { const text = domText(); if (text !== lastRun) runPreview(text, "the buffer") } }, 600)
}
const runPreview = (html, what) => { lastRun = html; $("preview").srcdoc = html; $("preview-what").textContent = what }
// The project is one file, so it leaves as one file: the buffer, or any commit, as .html.
const download = (html, name) => {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const fileName = (repo, suffix = "") => `${repo?.value.name ?? "index"}${suffix}.html`

// ── Whole-line selection: Shift+↑/↓, or the line numbers ────────────────────
// A line is a node, so a selection that crosses lines is a set of nodes: the
// lines between an anchor and a head, in order, the ones the view hides aside.
// Copy joins their texts; cut and Backspace remove the nodes; a paste replaces
// them — the first line keeps its node and takes the first pasted line, the
// rest are removed, extra lines are minted between the first and whatever
// follows. Every step is the same put or remove the caret makes, so the other
// peers see it line by line, live, under their own carets. The caret stays in
// the anchor line, which is what the room sees of you meanwhile.
let range = null // { anchor, head }: line ids
const rangeSet = () => {
  if (!range) return new Set()
  const a = $(range.anchor), h = $(range.head)
  if (!a || !h) { range = null; return new Set() } // an end went away under a remote edit: nothing is selected
  const list = [...buffer().children], i = list.indexOf(a), j = list.indexOf(h)
  return new Set(list.slice(Math.min(i, j), Math.max(i, j) + 1).filter(shown))
}
const paintRange = () => { const set = rangeSet(); for (const li of buffer()?.children ?? []) li.classList.toggle("sel", set.has(li)) }
const setRange = (r) => { range = r; paintRange() }
const rangeLines = () => [...rangeSet()]
const rangeText = () => rangeLines().map((li) => fieldOf(li).value).join("\n")
const extendRange = (li, dir) => {
  const from = (range && $(range.head)) ?? li
  let next = from
  do next = dir < 0 ? next.previousElementSibling : next.nextElementSibling; while (isLine(next) && !shown(next))
  setRange({ anchor: range?.anchor ?? li.id, head: isLine(next) ? next.id : from.id })
}
async function deleteRange() {
  const sel = rangeLines(); setRange(null); if (!sel.length) return
  if (![...buffer().children].some((li) => !sel.includes(li))) return replaceRange(sel, "") // the last lines standing: the first stays, empty
  const landing = sel.at(-1).nextElementSibling ?? sel[0].previousElementSibling
  for (const li of sel) { cancelSave(li.id); dropLine(li) }
  if (isLine(landing)) caretTo(landing, 0)
  await Promise.all(sel.map((li) => db.remove(li.id)))
}
async function replaceRange(sel, text) {
  setRange(null); if (!sel.length) return
  const [first, ...rest] = sel, parts = text.split("\n"), after = sel.at(-1).nextElementSibling
  const nextOrder = isLine(after) ? orderOf(after) : undefined
  for (const li of rest) { cancelSave(li.id); dropLine(li) }
  cancelSave(first.id); fieldOf(first).value = parts[0]; highlight(first); scheduleLayout(); afterChange()
  const ops = [putLine(first.dataset.repo, first.dataset.branch, parts[0], orderOf(first), first.id), ...rest.map((li) => db.remove(li.id))]
  if (parts.length === 1) caretTo(first, parts[0].length)
  else {
    const keys = keysBetween(orderOf(first), nextOrder, parts.length - 1)
    for (let i = 1; i < parts.length - 1; i++) ops.push(putHere(parts[i], keys[i - 1]))
    focusNextPos = parts.at(-1).length; focusNextId = await putHere(parts.at(-1), keys.at(-1))
    caretTo($(focusNextId), focusNextPos)
  }
  await Promise.all(ops)
}
// The line numbers select whole lines: click one, then Shift+click or drag to another.
let numberDrag = false
document.addEventListener("pointerdown", (e) => {
  setAllSelected(false)
  const li = e.target.closest?.(".ln")?.closest(".line")
  if (!li) { setRange(null); return }
  e.preventDefault(); numberDrag = true // the focus stays in the buffer: the anchor line takes it
  if (e.shiftKey && range) setRange({ anchor: range.anchor, head: li.id })
  else { setRange({ anchor: li.id, head: li.id }); caretTo(li, 0) }
})
document.addEventListener("pointerover", (e) => { const li = numberDrag && range && e.target.closest?.(".ln")?.closest(".line"); if (li && li.id !== range.head) setRange({ anchor: range.anchor, head: li.id }) })
document.addEventListener("pointerup", () => { numberDrag = false })

// ── Whole-buffer selection: Ctrl/Cmd+A twice ────────────────────────────────
let allSelected = false
const setAllSelected = (on) => { allSelected = on; if (on) setRange(null); buffer()?.classList.toggle("all-selected", on) }
document.addEventListener("copy", (e) => { const text = allSelected ? domText() : range ? rangeText() : null; if (text === null) return; e.preventDefault(); e.clipboardData.setData("text/plain", text) })
document.addEventListener("cut", (e) => {
  if (allSelected) { e.preventDefault(); e.clipboardData.setData("text/plain", domText()); setAllSelected(false); applyText(current.branch, ""); return }
  if (range) { e.preventDefault(); e.clipboardData.setData("text/plain", rangeText()); deleteRange() }
})
document.addEventListener("paste", (e) => {
  const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r/g, "")
  if (allSelected) { e.preventDefault(); setAllSelected(false); applyText(current.branch, text); return }
  if (range) { e.preventDefault(); replaceRange(rangeLines(), text) }
})
document.addEventListener("keydown", (e) => {
  if (!allSelected) return
  if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); setAllSelected(false); applyText(current.branch, "") }
  else if (e.key === "Escape") setAllSelected(false)
  else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) setAllSelected(false)
})

// ── Awareness + live typing: ONE ephemeral channel, two kinds ───────────────
// Channel traffic never touches the database. 'caret' carries where you are;
// 'text' carries the line you are typing, keystroke by keystroke, so the room
// sees each character the moment it lands — the debounced put remains the
// truth that persists and repairs.
const presenceChannel = db.room.channel("presence")
const peerAt = new Map() // peerId -> { block, start, end }
const hueOf = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
const colorOf = (id) => `hsl(${hueOf(id)} 75% 70%)`
function renderMarks() {
  document.querySelectorAll(".mirror").forEach((m) => m.remove())
  for (const [peerId, mark] of peerAt) {
    const li = mark.block && $(mark.block), ta = fieldOf(li)
    if (!ta) continue
    const text = ta.value, start = Math.min(mark.start ?? 0, text.length), end = Math.min(Math.max(mark.end ?? start, start), text.length)
    const mirror = document.createElement("div"); mirror.className = "mirror"
    mirror.append(text.slice(0, start))
    if (end > start) { const sel = document.createElement("span"); sel.className = "remote-sel"; sel.style.background = `hsl(${hueOf(peerId)} 75% 70% / .25)`; sel.textContent = text.slice(start, end); mirror.append(sel) }
    const caret = document.createElement("span"); caret.className = "remote-caret"; caret.style.borderColor = colorOf(peerId)
    const label = document.createElement("span"); label.className = "caret-label"; label.style.background = colorOf(peerId); label.textContent = peerId.slice(0, 4)
    caret.append(label); mirror.append(caret, text.slice(end))
    li.querySelector(".cell").append(mirror)
  }
}
let lastSent = null, announceQueued = false, liveDirty = false
function announce() {
  if (announceQueued) return
  announceQueued = true
  requestAnimationFrame(() => {
    announceQueued = false
    const ta = document.activeElement, li = ta?.closest?.(".line")
    const msg = li ? { kind: liveDirty ? "text" : "caret", block: li.id, start: ta.selectionStart, end: ta.selectionEnd, ...(liveDirty && { text: ta.value }) } : { kind: "caret", block: null }
    liveDirty = false
    if (msg.kind === "caret" && lastSent && lastSent.block === msg.block && lastSent.start === msg.start && lastSent.end === msg.end) return
    lastSent = msg
    if (msg.kind === "text" && keyRings.get(li.dataset.repo)) { // a private repository's keystrokes travel sealed too
      const { text, ...rest } = msg
      seal(li.dataset.repo, text).then((ct) => presenceChannel.send({ ...rest, ct }))
      return
    }
    presenceChannel.send(msg)
  })
}
document.addEventListener("selectionchange", announce)
presenceChannel.on("message", async (msg, fromPeerId) => {
  if (msg.kind === "text") {
    const li = $(msg.block), ta = fieldOf(li)
    const text = msg.ct !== undefined ? (ta ? await unseal(li.dataset.repo, msg.ct) : null) : msg.text
    if (ta && text !== null && !isMine(ta) && ta.value !== text) { paint(ta, text); afterChange() }
  }
  peerAt.set(fromPeerId, { block: msg.block, start: msg.start, end: msg.end })
  renderMarks()
})
let leftBursts = 0
setInterval(() => { // after the caret leaves the buffer, "left" is repeated twice, then silence
  if (document.activeElement?.closest?.(".line")) { leftBursts = 0; return }
  if (lastSent && leftBursts < 2) { leftBursts++; presenceChannel.send({ kind: "caret", block: null }) }
}, 2000)

// ── Views ───────────────────────────────────────────────────────────────────
const reposPage = () => {
  const rows = repos().map((r) => {
    const branches = branchesOf(r.id), commits = commitsOf(r.id)
    return `<li><a class="name" href="#/r/${esc(r.id)}">${esc(r.value.name)}</a>${r.value.vault ? `<span class="lock" title="Private: the code is sealed for its members">private</span>` : ""}<span class="meta">${plural(branches.length, "branch")} · ${plural(commits.length, "commit")}${commits[0] ? ` · ${ago(commits[0].value.at)}` : ""}</span><span class="desc">${esc(r.value.description) || "<span class=\"dim\">no description</span>"} <span class="dim">— by ${esc(nameOf(r.value.owner))}</span></span></li>`
  })
  return `<div class="page"><h1>Repositories</h1><p class="lede">Single-file HTML projects — HTML, CSS and JavaScript in one editor — with branches, forks and pull requests. The editor is shared line by line, live; every commit is a node its author owns and a page you can run; nothing here is hosted by anyone. ${me ? `<a href="#/new">Create one</a>.` : `<a href="#/login">Sign in</a> to create one.`}</p>
${rows.length ? `<ul class="repos">${rows.join("")}</ul>` : `<div class="empty">No repositories in this room yet${me ? ` — <a href="#/new">create the first</a>` : ""}.</div>`}</div>`
}
const newPage = () => (me
  ? `<div class="page"><h1>New repository</h1><p class="lede">A repository is a node you own: a name and a description. It opens in the editor with a starter page in its shared buffer — HTML, CSS and JavaScript in one file — on its <code>main</code> branch, as its first commit. Replace the page from there: everyone on the branch edits it live, and every commit of it runs.</p>
<form id="new-form" class="formtable"><label for="nf-name">name</label><input id="nf-name" type="text" name="name" maxlength="60" pattern="[A-Za-z0-9._\\-]{1,60}" required autocomplete="off" placeholder="my-project">
<label for="nf-desc">description</label><input id="nf-desc" type="text" name="description" maxlength="160" autocomplete="off" placeholder="What it is, in a line">
<label class="check"><input type="checkbox" name="private" id="nf-private"> Private — the code is sealed with a key only the members you grant can hold; the name, the branches and the pull request titles stay visible</label>
<div class="actions"><button type="submit" class="primary">Create repository and open the editor</button></div>
<p class="note">The first commit will be signed by ${esc(nameOf(me))} (${esc(me)}). Nobody else can move <code>main</code> until you grant them write.</p></form></div>`
  : `<div class="page"><h1>New repository</h1><p class="lede"><a href="#/login">Sign in</a> to create a repository.</p></div>`)
// ── The identity door (design guide §4.1), rendered from the security state ──
// One textarea does both jobs, every button is derived from the state on each
// call, nothing here remembers anything — the SM reports several times while
// an identity is generated, and a callback that only redraws cannot misfire.
const door = $("identity-modal")
const el = { mnemonic: $("mnemonic-input"), clip: $("mnemonic-clip"), generate: $("generate-btn"), passkeyProtect: $("passkey-protect-btn"), passkeyLogin: $("passkey-login-btn"), demo: $("demo-logins"), warning: $("phrase-warning") }
const show = (node, visible) => node.classList.toggle("hidden", !visible)
el.demo.innerHTML = DEMO_IDENTITIES.map((i) => `<button type="button" class="ghost demo-login" data-address="${esc(i.address)}">${i.emoji} ${esc(i.name)} (demo)</button>`).join("") // the guide's demo shortcut, one per identity the demo uses
const autoGrow = () => { const f = el.mnemonic; f.style.height = "auto"; const borders = f.offsetHeight - f.clientHeight; f.style.height = `${f.scrollHeight + borders}px` }
const syncClipAffordance = () => show(el.clip, !!el.mnemonic.value.trim())
const renderDoor = ({ isActive, hasVolatileIdentity, hasWebAuthnHardwareRegistration, isWebAuthnProtected }) => {
  const onboarding = hasVolatileIdentity && !isActive // a fresh phrase, not yet saved
  show(el.generate, !onboarding)
  show(el.passkeyProtect, onboarding && PASSKEYS_AVAILABLE && !isWebAuthnProtected)
  show(el.passkeyLogin, !onboarding && PASSKEYS_AVAILABLE && hasWebAuthnHardwareRegistration)
  show(el.demo, !onboarding)   // never invite abandoning an unsaved phrase
  show(el.warning, onboarding) // only a fresh phrase can still be lost
  el.mnemonic.readOnly = onboarding
  if (onboarding) el.mnemonic.value = db.sm.getMnemonicForDisplayAfterRegistrationOrRecovery() ?? el.mnemonic.value
  else if (isActive || document.activeElement !== el.mnemonic) el.mnemonic.value = "" // signed in: always clear; signed out: never mid-paste
  syncClipAffordance(); autoGrow()
}
door.onclick = (e) => { if (e.target === door) door.close() } // dismissible: the backdrop is the dialog itself as event target
el.clip.onclick = async () => { try { await navigator.clipboard.writeText(el.mnemonic.value); say("door-status", "Phrase copied.") } catch { say("door-status", "Clipboard unavailable — select the phrase and copy it.") } }
el.mnemonic.addEventListener("input", () => { syncClipAffordance(); autoGrow() })
// The identity view: the session pill opens it. Protecting an identity with a
// passkey is offered here, not only at onboarding — a session opened with a
// phrase still holds its key in memory, and the engine can wrap it any time.
const sessionPage = () => {
  if (!me) return `<div class="page session-page"><h1>Your identity</h1><p class="lede">No session on this device. <a href="#/login">Sign in</a>.</p></div>`
  const s = session, canProtect = PASSKEYS_AVAILABLE && !s.isWebAuthnProtected && s.hasVolatileIdentity
  const yn = (v) => `<span class="${v ? "yes" : "no"}">${v ? "yes" : "no"}</span>`
  return `<div class="page session-page"><h1>Your identity</h1>
<p class="lede">A key pair on this device. Every commit you make is signed with it. A mnemonic recovers it anywhere; a passkey keeps the session on this browser and never types the phrase again.</p>
<table class="facts">
<tr><td>name</td><td>${esc(nameOf(me))}</td></tr>
<tr><td>address</td><td><code id="my-address">${esc(me)}</code> <button class="small" data-act="copy-address">Copy</button></td></tr>
<tr><td>role</td><td>${eqAddr(me, AUTHORITY) ? "superadmin" : "guest"}</td></tr>
<tr><td>unlocked by</td><td id="unlocked-by">${s.isWebAuthnProtected ? "passkey" : "mnemonic"}</td></tr>
<tr><td>protected by a passkey</td><td>${yn(s.isWebAuthnProtected)}</td></tr>
<tr><td>passkey on this browser</td><td>${yn(s.hasWebAuthnHardwareRegistration)}</td></tr>
</table>
<div class="actions">${canProtect ? `<button class="primary" id="protect-btn">Protect this identity with a passkey</button>` : ""}<button id="signout-btn">Sign out</button></div>
<p class="note">${!PASSKEYS_AVAILABLE ? "Passkeys need HTTPS or localhost — an IP address is never a valid Relying Party ID." : s.isWebAuthnProtected ? "Sign out and back in with the passkey: the phrase is never typed again." : s.hasVolatileIdentity ? "Until a passkey holds it, the phrase is the only way to open this identity again — here or anywhere." : "This session was opened by a passkey."}</p>
<p class="note status" id="login-status"></p></div>`
}
const lockedPage = (repo, opening) => `<div class="page locked"><h1>${esc(repo.value.name)} <span class="lock">private</span></h1><p class="lede">${esc(repo.value.description)}</p>
<p class="lede">${opening ? "Opening the vault…" : me ? `This repository is private: its code is sealed with a key only its members hold, and ${esc(nameOf(repo.value.owner))} has not granted this identity one. Ask for access — a grant reaches this page on its own.` : `This repository is private: its code is sealed with a key only its members hold. <a href="#/login">Sign in</a> — if you are a member, it opens.`}</p></div>`
const constitutionPage = () => `<div class="page constitution">
<h1>Constitution</h1><p class="lede">This page is <code>constitution.js</code>, rendered. The rules you read are the rules that run — on every peer, with nobody in between.</p>
<h2>The authority</h2><p><code>${esc(AUTHORITY)}</code> — its only power is restricting an identity, with its signature. It cannot touch a repository, a branch or a commit it does not own: every one is owned by its author, and the engine refuses anyone else's edit or deletion, the authority included.</p>
<h2>Roles — enforced by the engine on every peer</h2><table>${Object.entries(CONSTITUTION.roles).map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(JSON.stringify(v))}</code><br><span class="rule">${esc(CONSTITUTION.roleText[k] ?? "")}</span></td></tr>`).join("")}</table>
<h2>What ownership means here</h2><table>${CONSTITUTION.principles.map(([t, text]) => `<tr><td>${esc(t)}</td><td><span class="rule">${esc(text)}</span></td></tr>`).join("")}</table>
<h2>Amendment</h2><p>${esc(CONSTITUTION.amendment)} <a href="https://github.com/estebanrfp/dCode/blob/main/constitution.js">The file.</a></p>
${me ? `<h2>You, under it</h2><p>${esc(nameOf(me))} · <code>${esc(me)}</code> · role <b>${eqAddr(me, AUTHORITY) ? "superadmin" : "guest"}</b></p>` : ""}</div>`

// The repository page: a skeleton built once per repository. The buffer and
// the running page are never rebuilt under you; the bar and the dock's
// regions are redrawn from the store.
const repoSkeleton = (repo) => `<section class="repo">
<div class="repo-bar">
  <a class="repo-name" id="repo-name" href="#/r/${esc(repo.id)}" title="${esc(repo.value.description)}">${esc(repo.value.name)}</a><span id="repo-lock" class="lock hidden" title="Private: the code is sealed for its members">private</span>
  <button type="button" class="small hidden" id="edit-repo" data-act="edit-repo" title="Rename or describe the repository — a write on a node you own">Edit</button>
  <select id="branch-select" aria-label="Branch"></select>
  <span class="head" id="head-label"></span><span class="dirty hidden" id="dirty">· uncommitted changes</span>
  <form id="commit-form" class="commit-form"><input type="text" name="message" id="message" maxlength="120" autocomplete="off" placeholder="Commit message" required><button type="submit" class="primary" id="commit-btn">Commit</button></form>
  <span class="hint" id="commit-hint"></span>
  <form id="repo-form" class="repo-form row hidden"><input type="text" name="name" maxlength="60" pattern="[A-Za-z0-9._\\-]{1,60}" required autocomplete="off" aria-label="Name"><input type="text" name="description" maxlength="160" autocomplete="off" placeholder="What it is, in a line" aria-label="Description"><button type="submit" class="small primary">Save</button><button type="button" class="small" data-act="cancel-repo">Cancel</button></form>
  <div id="merge-banner" class="merge-banner hidden"></div>
</div>
<div class="bench" id="bench">
  <section class="panel edit-panel"><nav class="views" aria-label="View"><button type="button" data-view="html">HTML</button><button type="button" data-view="css">CSS</button><button type="button" data-view="js">JS</button><span class="view-hint" id="view-hint"></span></nav><div id="buffer" class="buffer" aria-label="The shared buffer"></div></section>
  <div id="splitter" class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize the panels" tabindex="0"></div>
  <section class="panel right">
    <div class="dock">
      <nav class="tabs" aria-label="Repository"><button type="button" data-tab="preview">Preview</button><button type="button" data-tab="history">History</button><button type="button" data-tab="pulls">Pull requests</button><button type="button" data-tab="branches">Branches</button></nav>
      <div class="tab preview-tab" id="tab-preview">
    <div class="preview-head">running <span class="what" id="preview-what">—</span><label><input type="checkbox" id="autorun" checked> auto</label><button class="small" data-act="run">Run</button><button class="small" data-act="download" title="The buffer as one .html file — HTML, CSS and JavaScript together, ready to open anywhere">Download .html</button><button class="small" data-act="discard" id="discard">Discard changes</button></div>
    <iframe id="preview" class="preview" sandbox="allow-scripts" title="The running project"></iframe>
      </div>
      <div class="tab" id="tab-history"><div class="graph"><svg id="graph" aria-hidden="true"></svg><ol id="commits"></ol></div><div id="commit-panel" class="commit-panel"></div></div>
      <div class="tab" id="tab-pulls"><ul id="prs" class="prs"></ul><div id="pr-form-box"></div></div>
      <div class="tab" id="tab-branches"><ul id="branches"></ul><div id="branch-form-box"></div><h2 id="collabs-title">Collaborators</h2><ul id="collabs" class="collabs"></ul><div id="collab-form-box"></div><h2 id="members-title" class="hidden">Members</h2><ul id="members" class="members hidden"></ul><div id="member-form-box"></div></div>
    </div>
  </section>
</div></section>`

const showTab = (name) => {
  sessionStorage.dcodeTab = name
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("sel", b.dataset.tab === name))
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== `tab-${name}`))
}
// The views are filters over the one file: CSS shows the lines inside <style>,
// JS the lines inside <script>, HTML everything — the same nodes, the file's
// own line numbers, edited and synced the same way.
const showView = (name) => {
  sessionStorage.dcodeView = name
  if (buffer()) buffer().dataset.view = name
  document.querySelectorAll(".views button").forEach((b) => b.classList.toggle("sel", b.dataset.view === name))
  if (buffer()) relayout()
}
const renderBranches = (repo, branches, branch, commits, fromId) => {
  const counts = new Map()
  for (const c of commits) counts.set(c.value.branch, (counts.get(c.value.branch) ?? 0) + 1)
  $("branches").innerHTML = branches.map((b) => `<li class="${b.id === branch?.id ? "sel" : ""}" data-branch="${esc(b.id)}"><a href="#/r/${esc(repo.id)}/${esc(b.id)}">${esc(branchLabel(repo, b))}</a>${canWriteBranch(b) && !eqAddr(b.value.owner, me) ? `<span class="who" title="you were granted write">write</span>` : ""}<span class="n" title="head · commits">${esc(short(b.value.head))} · ${counts.get(b.id) ?? 0}</span>${eqAddr(b.value.owner, me) && b.id !== defaultBranch(repo, branches)?.id ? `<button class="small ghost" data-act="delete-branch" data-branch="${esc(b.id)}" title="Delete this branch: its buffer goes, its commits stay">Delete</button>` : ""}</li>`).join("") || `<li class="dim">no branches</li>`
  $("branch-form-box").innerHTML = me && fromId ? `<form id="branch-form" class="row"><input type="text" name="name" placeholder="new branch" pattern="[A-Za-z0-9._\\-]{1,40}" required autocomplete="off"><button type="submit" class="small">Branch from ${esc(short(fromId))}</button></form>` : ""
  const select = $("branch-select")
  select.innerHTML = branches.map((b) => `<option value="${esc(b.id)}"${b.id === branch?.id ? " selected" : ""}>${esc(branchLabel(repo, b))}${eqAddr(b.value.owner, me) ? "" : ` · ${esc(nameOf(b.value.owner))}`}</option>`).join("")
}
const renderPRs = (repo, branches, branch, prs) => {
  $("prs").innerHTML = prs.map((pr) => {
    const from = nodes.get(pr.value.from), into = nodes.get(pr.value.into), st = prStatus(pr), open = st.startsWith("open")
    const actions = []
    if (open && canWriteBranch(into)) actions.push(`<button class="small" data-act="merge" data-pr="${esc(pr.id)}">Merge</button>`)
    if (open && st === "open, behind" && eqAddr(pr.value.owner, me)) actions.push(`<button class="small" data-act="update-pr" data-pr="${esc(pr.id)}">Update to ${esc(short(from?.value.head))}</button>`)
    if (open && eqAddr(pr.value.owner, me)) actions.push(`<button class="small" data-act="withdraw" data-pr="${esc(pr.id)}">Withdraw</button>`)
    return `<li data-pr="${esc(pr.id)}"><span class="pr-title">${esc(pr.value.title)}</span><div class="pr-meta">${from ? esc(branchLabel(repo, from)) : "?"} → ${into ? esc(branchLabel(repo, into)) : "?"} · ${esc(short(pr.value.commit))} · by ${esc(nameOf(pr.value.owner))} · <span class="st ${open ? "open" : st}">${esc(st)}</span></div>${actions.length ? `<div class="pr-actions">${actions.join("")}</div>` : ""}</li>`
  }).join("") || `<li class="dim">none</li>`
  const targets = branch && eqAddr(branch.value.owner, me) ? branches.filter((b) => b.id !== branch.id) : []
  $("pr-form-box").innerHTML = targets.length && branch.value.head
    ? `<form id="pr-form" class="row"><select name="into">${targets.map((b) => `<option value="${esc(b.id)}">into ${esc(branchLabel(repo, b))}</option>`).join("")}</select><input type="text" name="title" placeholder="title" maxlength="120" required autocomplete="off"><button type="submit" class="small">Propose ${esc(branchLabel(repo, branch))}</button></form>`
    : ""
}
const renderCollabs = (repo, branch) => {
  const mine = !!branch && eqAddr(branch.value.owner, me), entries = Object.entries(branch?.value.collaborators ?? {})
  $("collabs-title").textContent = branch ? `Collaborators on ${branchLabel(repo, branch)}` : "Collaborators"
  $("collabs").innerHTML = entries.map(([addr, level]) => `<li><span class="addr" title="${esc(addr)}">${esc(nameOf(addr))}</span><span class="n">${esc(level)}</span>${mine ? `<button class="small" data-act="revoke" data-address="${esc(addr)}">Revoke</button>` : ""}</li>`).join("") || `<li class="dim">${mine ? "nobody else can move this head" : "only its owner moves this head"}</li>`
  $("collab-form-box").innerHTML = mine ? `<form id="collab-form" class="row"><input type="text" name="address" class="mono" placeholder="0x… address" pattern="0x[0-9a-fA-F]{40}" required autocomplete="off"><button type="submit" class="small">Grant write</button></form>` : ""
}
// A private repository's members: the addresses holding an envelope on its
// vault. The owner grants and revokes them there; a revocation turns the key.
const renderMembers = async (repo) => {
  const list = $("members"); if (!list) return
  const vault = repo.value.vault
  $("members-title").classList.toggle("hidden", !vault); list.classList.toggle("hidden", !vault); $("member-form-box").innerHTML = ""
  if (!vault) return
  const perms = await db.sm.acls.getPermissions(vault).catch(() => null)
  if (!$("members") || $("main").dataset.repo !== repo.id) return // navigated away while reading
  const mine = eqAddr(repo.value.owner, me)
  const rows = [[perms?.owner ?? repo.value.owner, "owner"], ...Object.keys(perms?.collaborators ?? {}).map((a) => [a, "read"])]
  $("members").innerHTML = rows.map(([addr, level]) => `<li data-member="${esc(addr)}"><span class="addr" title="${esc(addr)}">${esc(nameOf(addr))}</span><span class="n">${esc(level)}</span>${mine && level !== "owner" ? `<button class="small" data-act="revoke-member" data-address="${esc(addr)}">Revoke</button>` : ""}</li>`).join("")
  $("member-form-box").innerHTML = mine ? `<form id="member-form" class="row"><input type="text" name="address" class="mono" placeholder="0x… address — must have signed in once" pattern="0x[0-9a-fA-F]{40}" required autocomplete="off"><button type="submit" class="small">Grant read</button></form><p class="dim">A member holds a key envelope on the repository's vault. Revoking one turns the key: what is written afterwards stays unreadable to them.</p>` : ""
}
function renderRepoBar() {
  const branch = currentBranch(); if (!branch || !$("head-label")) return
  const repo = nodes.get(branch.value.repo), dirty = domText() !== contentOf(branch.value.head), writable = canWriteBranch(branch), merging = pendingMerge.get(branch.id)
  $("repo-name").textContent = repo.value.name; $("repo-name").title = repo.value.description
  $("repo-lock").classList.toggle("hidden", !repo.value.vault)
  $("edit-repo").classList.toggle("hidden", !eqAddr(repo.value.owner, me))
  $("head-label").textContent = `@ ${short(branch.value.head)}`
  $("dirty").classList.toggle("hidden", !dirty)
  $("discard").disabled = !dirty
  $("commit-btn").textContent = !me ? "Sign in to commit" : merging ? `Commit merge to ${branchLabel(repo, branch)}` : writable ? `Commit to ${branchLabel(repo, branch)}` : "Fork and commit"
  $("commit-btn").disabled = !me
  $("commit-hint").textContent = !me || writable ? "" : `Everyone edits this buffer; only ${nameOf(branch.value.owner)} moves ${branchLabel(repo, branch)}. Your commit will go to a branch of yours, forked from here.`
  const banner = $("merge-banner")
  banner.classList.toggle("hidden", !merging)
  if (merging) banner.textContent = `Merging ${short(merging.parents[0])}: resolve the conflict markers (<<<<<<<, =======, >>>>>>>) and commit. The commit will have two parents.`
  if (merging && !$("message").value) $("message").value = merging.message
}
const renderTimeline = (repo, branches, commits, selected) => {
  const ROW = 30, X0 = 10, DX = 12
  const lanes = new Map(branches.map((b, i) => [b.id, i])), index = new Map(commits.map((c, i) => [c.id, i]))
  const x = (c) => X0 + DX * (lanes.get(c.value.branch) ?? 0), y = (i) => i * ROW + ROW / 2
  const width = X0 * 2 + DX * Math.max(1, lanes.size), height = Math.max(ROW, ROW * commits.length)
  const lines = commits.flatMap((c, i) => (c.value.parents ?? []).map((p) => {
    const j = index.get(p); if (j === undefined) return ""
    const x1 = x(c), y1 = y(i), x2 = x(commits[j]), y2 = y(j), ym = (y1 + y2) / 2
    return `<path class="g-line" d="M${x1} ${y1} C${x1} ${ym}, ${x2} ${ym}, ${x2} ${y2}"/>`
  }))
  const dots = commits.map((c, i) => `<circle class="g-dot${tipsAt(branches, c.id).length ? " head" : ""}${c.id === selected ? " sel" : ""}" cx="${x(c)}" cy="${y(i)}" r="4"/>`)
  const g = $("graph")
  g.setAttribute("viewBox", `0 0 ${width} ${height}`); g.setAttribute("width", width); g.setAttribute("height", height)
  g.innerHTML = lines.join("") + dots.join("")
  $("commits").innerHTML = commits.map((c) => {
    const tips = tipsAt(branches, c.id)
    return `<li data-commit="${esc(c.id)}" class="${c.id === selected ? "sel" : ""}${tips.length ? " head" : ""}" title="${esc(c.value.message)} — ${esc(nameOf(c.value.owner))}, ${new Date(c.value.at).toLocaleString()}"><span class="msg">${esc(c.value.message)}</span>${tips.map((b) => `<span class="chip${eqAddr(b.value.owner, me) ? " mine" : ""}">${esc(branchLabel(repo, b))}</span>`).join("")}<span class="meta">${esc(short(c.id))} · ${esc(nameOf(c.value.owner))} · ${ago(c.value.at)}</span></li>`
  }).join("") || `<li class="dim">no commits yet</li>`
}
const renderCommitPanel = (repo, branch, id) => {
  const c = commitOf(id)
  if (!c) { $("commit-panel").innerHTML = `<p class="dim">Select a commit to read its diff and run it.</p>`; return }
  const parent = commitOf(c.value.parents?.[0])
  const rows = diffLines(parent ? parent.value.content.split("\n") : [], c.value.content.split("\n"))
  const added = rows.filter((r) => r.kind === "add").length, removed = rows.filter((r) => r.kind === "del").length
  const LIMIT = 400, shown = rows.slice(0, LIMIT)
  $("commit-panel").innerHTML = `<h3>${esc(short(c.id))} · ${esc(c.value.message)}</h3>
<p class="meta">${esc(nameOf(c.value.owner))} · ${new Date(c.value.at).toLocaleString()} · ${c.value.parents?.length ? `parent${c.value.parents.length > 1 ? "s" : ""} ${c.value.parents.map(short).map(esc).join(", ")}` : "root"} · <span title="${esc(c.id)}">${esc(abbr(c.value.owner))}:${esc(short(c.id))}…</span></p>
<div class="actions"><button class="small" data-act="run-commit" data-commit="${esc(c.id)}">Run this version</button><button class="small" data-act="download-commit" data-commit="${esc(c.id)}">Download this version</button>${branch && me ? `<button class="small" data-act="load-commit" data-commit="${esc(c.id)}">Load into the editor</button>` : ""}</div>
<div class="diff-summary">${parent ? `against ${esc(short(parent.id))}: ` : "the whole file: "}<span class="add">+${added}</span> <span class="del">−${removed}</span></div>
<pre class="diff">${shown.map((r) => `<div class="${r.kind}">${r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "} ${esc(r.text)}</div>`).join("")}${rows.length > LIMIT ? `<div class="more">… ${rows.length - LIMIT} more lines</div>` : ""}</pre>`
}

// ── Router and render ───────────────────────────────────────────────────────
const route = () => {
  const seg = location.hash.slice(1).split("/").filter(Boolean).map(decodeURIComponent)
  return { page: seg[0] ?? "", repo: seg[1] ?? null, branch: seg[2] ?? null, commit: seg[3] ?? null }
}
const currentBranch = () => { const r = route(); const repo = nodes.get(r.repo); if (!repo) return null; const branches = branchesOf(repo.id); return branches.find((b) => b.id === r.branch) ?? defaultBranch(repo, branches) }
let renderQueued = false, dirtyWhileTyping = false, subscribed = false
const scheduleRender = () => { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render() }) }
// Never repaint a form under the reader's caret. The buffer and the commit
// message live in the skeleton, which a store change never rebuilds; the
// dock's forms do not, so a render waits while one is being typed in.
const typing = () => document.hasFocus() && $("main").contains(document.activeElement) && !!document.activeElement.closest(".dock, .page") &&
  document.activeElement.matches("textarea, select, input:not([type=submit]):not([type=button]):not([type=checkbox])")

const render = () => {
  if (!subscribed) return
  if (typing()) { dirtyWhileTyping = true; return }
  const r = route(), main = $("main")
  renderNav(r.page); renderSession()
  if (r.page === "r" && r.repo) return renderRepo(r, main)
  main.dataset.repo = ""; main.classList.remove("full"); current = null
  if (r.page === "login" && !me && !door.open) door.showModal() // a contextual "Sign in" re-opens the door; the page behind it stays
  const page = r.page === "login" ? "" : r.page
  const titles = { "": "dCode", new: "New repository · dCode", session: "Your identity · dCode", constitution: "Constitution · dCode" }
  main.innerHTML = { "": reposPage, new: newPage, session: sessionPage, constitution: constitutionPage }[page]?.() ?? `<div class="page"><p class="muted">No such page.</p></div>`
  document.title = titles[page] ?? "dCode"
}
const renderRepo = (r, main) => {
  const repo = nodes.get(r.repo)
  if (!repo) { main.dataset.repo = ""; main.classList.remove("full"); current = null; main.innerHTML = `<div class="page"><p class="muted">No such repository here yet. If it exists in this room, it will appear when it syncs.</p></div>`; return }
  if (repo.value.vault && !Array.isArray(keyRings.get(repo.id))) { // private: without the key there is nothing to show but the door
    if (!keyRings.has(repo.id) && me) unlock(repo.id)
    main.dataset.repo = ""; main.classList.remove("full"); current = null
    main.innerHTML = lockedPage(repo, unlocking.has(repo.id))
    document.title = `${repo.value.name} · dCode`
    return
  }
  const branches = branchesOf(repo.id), commits = commitsOf(repo.id), prs = prsOf(repo.id)
  const branch = branches.find((b) => b.id === r.branch) ?? defaultBranch(repo, branches)
  const selected = commitOf(r.commit)?.id ?? branch?.value.head ?? null
  if (main.dataset.repo !== repo.id) { main.innerHTML = repoSkeleton(repo); main.dataset.repo = repo.id; main.dataset.branch = ""; main.classList.add("full"); showTab(sessionStorage.dcodeTab ?? "preview"); showView(sessionStorage.dcodeView ?? "html"); if (localStorage.dcodeSplit) setDocWidth(Number(localStorage.dcodeSplit), false) }
  if (branch && main.dataset.branch !== branch.id) { main.dataset.branch = branch.id; mountBuffer(repo.id, branch.id) }
  renderBranches(repo, branches, branch, commits, selected)
  renderPRs(repo, branches, branch, prs)
  renderCollabs(repo, branch)
  renderMembers(repo)
  renderRepoBar()
  renderTimeline(repo, branches, commits, selected)
  renderCommitPanel(repo, branch, selected)
  document.title = `${repo.value.name}${branch ? ` · ${branchLabel(repo, branch)}` : ""} · dCode`
}
const renderNav = (page) => {
  $("nav").innerHTML = [["", "repositories"], ["new", "new"], ["constitution", "constitution"]].map(([p, label]) => `<a href="#/${p}" data-nav="${p}"${page === p ? ' class="sel"' : ""}>${label}</a>`).join("")
}
const renderSession = () => { // the pill: name · abbreviated address, opening the identity view; the logout icon beside the theme
  const pill = $("session-addr"), demo = me && DEMO_IDENTITIES.find((i) => eqAddr(i.address, me))
  pill.textContent = me ? (demo ? `${demo.name} · ${session.abbrAddr}` : session.abbrAddr ?? me) : ""
  pill.title = me ? `${me} — your identity` : ""
  show($("logout-btn"), !!me)
}

// ── The divider between the panels is the resize control ───────────────────
const MIN_DOC = 360, MIN_RIGHT = 320
const setDocWidth = (px, persist = true) => {
  const bench = $("bench"); if (!bench) return
  const available = bench.clientWidth, ceiling = available ? Math.max(available - MIN_RIGHT, MIN_DOC) : Infinity
  const width = Math.round(Math.min(Math.max(px, MIN_DOC), ceiling))
  bench.style.setProperty("--doc-width", `${width}px`)
  if (persist) localStorage.dcodeSplit = width
}
document.addEventListener("pointerdown", (event) => {
  const splitter = event.target.closest("#splitter"); if (!splitter) return
  event.preventDefault(); splitter.setPointerCapture(event.pointerId)
  const startX = event.clientX, startWidth = $("bench").firstElementChild.getBoundingClientRect().width
  const onMove = (move) => setDocWidth(startWidth + move.clientX - startX)
  splitter.addEventListener("pointermove", onMove)
  splitter.addEventListener("pointerup", () => splitter.removeEventListener("pointermove", onMove), { once: true })
})
document.addEventListener("keydown", (event) => {
  if (event.target.id !== "splitter") return
  const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key]; if (!step) return
  event.preventDefault(); setDocWidth($("bench").firstElementChild.getBoundingClientRect().width + step)
})

// ── Events ──────────────────────────────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-commit]")
  if (li) { const r = route(); location.hash = `#/r/${r.repo}/${$("main").dataset.branch}/${li.dataset.commit}`; return }
  if (e.target === buffer() && !buffer().children.length && me) { await insertAfter(null); return } // an empty buffer: click to start a line
  if (e.target === buffer() || e.target.classList?.contains("edit-panel")) { // the space under the last line is the editor too: the caret goes to its end
    const last = [...buffer()?.children ?? []].filter(shown).at(-1); if (last) caretTo(last, fieldOf(last).value.length); return
  }
  const a = e.target.closest("a, button"); if (!a) return
  const act = a.dataset.act
  try {
    if (a.dataset.tab) { showTab(a.dataset.tab); return }
    if (a.dataset.view) { showView(a.dataset.view); return }
    if (a.id === "theme-btn") { applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(document.documentElement.dataset.pref) + 1) % THEME_ORDER.length]); return }
    if (act === "copy-address") { try { await navigator.clipboard.writeText(me); say("login-status", "Address copied.") } catch { say("login-status", "Clipboard unavailable — select the address and copy it.") } return }
    if (act === "revoke-member") {
      const repo = nodes.get(route().repo); if (!repo?.value.vault) return
      await db.sm.acls.revoke(repo.value.vault, a.dataset.address)              // the engine turns the vault's envelope key
      const { result } = await db.sm.get(repo.value.vault), hex = newKeyHex()   // and the repository key turns: a new one on the ring
      await db.sm.put({ ...result.value, keys: [hex, ...result.value.keys] }, repo.value.vault)
      keyRings.set(repo.id, [await importKey(hex), ...(keyRings.get(repo.id) ?? [])])
      notice(`${nameOf(a.dataset.address)} no longer holds the key. What is written from now on is sealed with a new one.`)
      renderMembers(repo); return
    }
    if (act === "edit-repo") {
      const repo = nodes.get(route().repo), f = $("repo-form"); if (!repo || !f) return
      f.elements.name.value = repo.value.name; f.elements.description.value = repo.value.description ?? ""
      f.classList.remove("hidden"); f.elements.name.focus(); return
    }
    if (act === "cancel-repo") { $("repo-form")?.classList.add("hidden"); return }
    if (act === "run") { runPreview(domText(), "the buffer"); showTab("preview"); return }
    if (act === "download") { const b = currentBranch(); download(domText(), fileName(b && nodes.get(b.value.repo))); return }
    if (act === "download-commit") { const c = commitOf(a.dataset.commit); if (c) download(c.value.content, fileName(nodes.get(c.value.repo), `-${short(c.id)}`)); return }
    if (act === "discard") { const b = currentBranch(); if (!b) return; pendingMerge.delete(b.id); await flushSaves(); await applyText(b.id, contentOf(b.value.head)); return }
    if (act === "run-commit") { const c = commitOf(a.dataset.commit); if (c) { runPreview(c.value.content, `${short(c.id)} — ${c.value.message}`); showTab("preview") } return }
    if (act === "load-commit") { const b = currentBranch(), c = commitOf(a.dataset.commit); if (!b || !c) return; await flushSaves(); await applyText(b.id, c.value.content); notice(`${short(c.id)} is now the buffer of ${branchLabel(nodes.get(b.value.repo), b)}. Commit it to make it the head again.`); return }
    if (act === "merge") { e.preventDefault(); const pr = nodes.get(a.dataset.pr); if (pr) await mergePR(pr); return }
    if (act === "update-pr") { const pr = nodes.get(a.dataset.pr), from = nodes.get(pr?.value.from); if (pr && from) await patch(pr.id, { commit: from.value.head }); return }
    if (act === "withdraw") { const pr = nodes.get(a.dataset.pr); if (pr) await patch(pr.id, { closed: true }); return }
    if (act === "delete-branch") { // yours, never the default: asked twice, then the buffer's lines go and the branch node goes; the commits are history and stay
      if (!a.dataset.armed) { a.dataset.armed = "1"; a.textContent = "Delete, really?"; setTimeout(() => { a.dataset.armed = ""; a.textContent = "Delete" }, 4000); return }
      const b = nodes.get(a.dataset.branch); if (!b) return
      const r = route(), standing = r.branch === b.id
      await Promise.all(linesOf(b.id).map((n) => db.remove(n.id))); await db.remove(b.id)
      notice(`Deleted ${branchLabel(nodes.get(b.value.repo), b)}. Its commits stay in the timeline.`)
      if (standing) location.hash = `#/r/${b.value.repo}`; return
    }
    if (act === "revoke") { const b = currentBranch(); if (b) { await db.sm.acls.revoke(b.id, a.dataset.address); notice(`Revoked ${nameOf(a.dataset.address)}.`) } return }
    if (a.id === "logout-btn" || a.id === "signout-btn") { e.preventDefault(); return db.sm.clearSecurity() }
    if (a.id === "reset-btn") { // testing, in the door — before anything is under way. A reset in a P2P database is a NEW ROOM: db.clear()
      // wipes this device's copy, but every other tab, browser and visitor still holds the graph and would hand it back on the next
      // connection. So this window moves to a fresh room, empty from its first second; its URL is what to open elsewhere to meet there.
      e.preventDefault(); a.disabled = true
      await db.clear()
      const next = new URLSearchParams(location.search); next.set("room", `test-${Date.now().toString(36)}`)
      location.replace(`${location.pathname}?${next}#/`); return
    }
    if (a.classList.contains("demo-login")) {
      e.preventDefault(); const id = DEMO_IDENTITIES.find((i) => eqAddr(i.address, a.dataset.address))
      try { await db.sm.loginOrRecoverUserWithMnemonic(id.mnemonic) } catch { say("door-status", "Could not sign in.") } return
    }
    if (a.id === "generate-btn") { e.preventDefault(); if (!await db.sm.startNewUserRegistration()) say("door-status", "Could not generate an identity."); return }
    if (a.id === "login-btn") {
      e.preventDefault(); const m = el.mnemonic.value.trim(); if (!m) return say("door-status", "Paste a mnemonic phrase first.")
      try { if (!await db.sm.loginOrRecoverUserWithMnemonic(m)) say("door-status", "That mnemonic is not valid.") } catch { say("door-status", "That mnemonic is not valid.") } return
    }
    if (a.id === "passkey-protect-btn" || a.id === "protect-btn") { // the door's button at onboarding, the identity view's afterwards: the same call
      e.preventDefault(); const out = a.id === "protect-btn" ? "login-status" : "door-status"
      try { if (!await db.sm.protectCurrentIdentityWithWebAuthn()) say(out, "Passkey registration cancelled.") } catch { say(out, "Could not register the passkey.") } return
    }
    if (a.id === "passkey-login-btn") { e.preventDefault(); try { if (!await db.sm.loginCurrentUserWithWebAuthn()) say("door-status", "Passkey sign-in cancelled.") } catch { say("door-status", "Could not sign in with the passkey.") } return }
  } catch (err) { notice(err.message) }
})

document.addEventListener("submit", async (e) => {
  const f = e.target; e.preventDefault()
  const field = (name) => (new FormData(f).get(name) ?? "").toString().trim()
  if (!me) { sessionStorage.dcodeGoto = location.hash; location.hash = "#/login"; return }
  try {
    if (f.id === "new-form") {
      const { repo, branch } = await newRepo(field("name"), field("description"), TEMPLATE, new FormData(f).get("private") === "on")
      location.hash = `#/r/${repo}/${branch}`; return
    }
    const branch = currentBranch(); if (!branch) return
    const repo = nodes.get(branch.value.repo)
    if (f.id === "member-form") { // an envelope on the vault: the engine wraps the key for an address that has signed in once
      const address = field("address")
      await db.sm.acls.grant(repo.value.vault, address, "read")
      f.reset(); notice(`${nameOf(address)} holds the key now; their page opens on its own.`); renderMembers(repo); return
    }
    if (f.id === "repo-form") { // the repository node is the owner's: a rename is one write on it
      await patch(repo.id, { name: field("name"), description: field("description") })
      f.classList.add("hidden"); notice("Repository updated."); scheduleRender(); return
    }
    if (f.id === "commit-form") {
      const message = field("message"); if (!message) return
      await flushSaves()
      const content = domText()
      if (content === contentOf(branch.value.head) && !pendingMerge.has(branch.id)) return notice("Nothing to commit: the buffer is the head.")
      if (pendingMerge.has(branch.id) && /^(<<<<<<<|=======|>>>>>>>)/m.test(content)) return notice("Conflict markers are still in the file.")
      let id
      if (canWriteBranch(branch)) {
        id = await commitTo(branch, message, content, pendingMerge.get(branch.id)?.parents ?? []); pendingMerge.delete(branch.id)
        f.reset(); notice(`Committed ${short(id)} to ${branchLabel(repo, branch)}.`); runPreview(content, `${short(id)}, the head`); scheduleRender()
      } else {
        const fork = await forkAndCommit(branch, message, content)
        f.reset(); location.hash = `#/r/${repo.id}/${fork.branch}`; notice(`Committed ${short(fork.id)} on your own branch: you cannot move ${branchLabel(repo, branch)}.`)
      }
      return
    }
    if (f.id === "branch-form") {
      const head = commitOf(route().commit)?.id ?? branch.value.head
      const id = await create({ type: "branch", repo: repo.id, name: field("name"), head })
      await seedLines(repo.id, id, contentOf(head))
      location.hash = `#/r/${repo.id}/${id}`; return
    }
    if (f.id === "pr-form") {
      await create({ type: "pr", repo: repo.id, from: branch.id, into: field("into"), title: field("title"), commit: branch.value.head })
      f.reset(); notice("Pull request opened. It is a node you own; the target's owner merges it."); return
    }
    if (f.id === "collab-form") {
      await db.sm.acls.grant(branch.id, field("address"), "write")
      f.reset(); notice(`${nameOf(field("address"))} can now move ${branchLabel(repo, branch)}.`); return
    }
  } catch (err) { notice(err.message) }
})
document.addEventListener("change", (e) => {
  if (e.target.id === "branch-select") { const r = route(); location.hash = `#/r/${r.repo}/${e.target.value}` }
  if (e.target.id === "autorun" && e.target.checked) afterChange()
})
document.addEventListener("focusout", () => { if (dirtyWhileTyping) { dirtyWhileTyping = false; scheduleRender() } })
addEventListener("hashchange", () => { if (!document.activeElement?.closest(".line")) document.activeElement?.blur(); render() })

// ── Session: the callback is the single source of truth ─────────────────────
let lastMe = null
db.sm.setSecurityStateChangeCallback((state) => {
  session = state
  me = state.isActive ? state.activeAddress : null
  if (me !== lastMe) { keyRings.clear(); lastMe = me } // a key ring belongs to a session: the next look at a private repository asks the vault again
  renderSession()
  renderDoor(state)
  if (state.isActive) { // the door closes itself; a sign-in asked for by a page goes back there, one with nowhere to go lands on the identity view
    door.close()
    if (route().page === "login") { location.hash = sessionStorage.dcodeGoto ?? "#/session"; sessionStorage.removeItem("dcodeGoto") }
  } else if (!door.open) door.showModal() // signed out *is* the door's state — dismissible, and any "Sign in" re-opens it
  $("main").dataset.repo = "" // what you may do on the page depends on who you are: rebuild it
  render()
})

// ── The subscription: after everything it may call, for a returning device ──
// Vault nodes travel as the engine's sealed wrappers: they are not stored here,
// they only tell whoever is looking at that repository to ask the vault again.
const chains = new Map() // per node: sealed values open in arrival order
const inOrder = (id, fn) => { const p = (chains.get(id) ?? Promise.resolve()).then(fn, fn); chains.set(id, p); return p }
await db.map({ query: { $or: [{ type: { $in: ["repo", "branch", "commit", "pr", "line"] } }, { _gdbWrapperType: { $exists: true } }] } }, ({ id, value: stored, timestamp, action }) => {
  const value = stored && { ...stored } // our copy: what is opened here is written on no disk — the engine's object is what it persists
  if (value?._gdbWrapperType) {
    const vault = id.replace(/^SM_ID_PREFIX_/, ""), repo = of("repo").find((r) => r.value.vault === vault)
    if (repo && (keyRings.has(repo.id) || route().repo === repo.id)) { keyRings.delete(repo.id); unlock(repo.id) }
    return
  }
  const known = nodes.get(id)
  if (action === "removed") nodes.delete(id); else nodes.set(id, { id, value, timestamp })
  const line = value?.type === "line" ? value : known?.value.type === "line" ? known.value : null
  const dispatchLine = () => {
    if (!current || line.branch !== current.branch || !buffer()) return
    if (action === "removed") { const li = $(id); if (li) dropLine(li) }
    else if ($(id)) updateLine(id, value); else createLine(id, value)
  }
  if (line) { // the buffer follows its branch's lines directly; nothing else redraws for a keystroke
    if (action !== "removed" && value.ct !== undefined) inOrder(id, async () => { // sealed: open it first
      const text = await unseal(value.repo, value.ct)
      if (text === null) { if (!keyRings.has(value.repo) && me) unlock(value.repo); return }
      value.text = text; dispatchLine()
    })
    else dispatchLine()
    return
  }
  if (action !== "removed" && value.type === "commit" && value.ct !== undefined && value.content === undefined) {
    const cached = plain.get(id)
    if (cached !== undefined) value.content = cached
    else inOrder(id, async () => { const text = await unseal(value.repo, value.ct); if (text !== null) { value.content = text; scheduleRender() } })
  }
  scheduleRender()
})
subscribed = true

// ── Presence, in the footer, as on every GenosDB page ───────────────────────
const presence = () => { const n = Object.keys(db.room?.getPeers() ?? {}).length; $("presence").textContent = `${n} peer${n === 1 ? "" : "s"}` }
db.room?.on("peer:join", (peerId) => { presence(); if (lastSent?.block) presenceChannel.send(lastSent, peerId) }) // late joiners learn where this caret is
db.room?.on("peer:leave", (peerId) => { peerAt.delete(peerId); renderMarks(); presence() })
presence()
render()

// ── The agent: a model in this browser, committing like anyone else ─────────
mountAgent({ currentBranch, me: () => me, flushSaves, bufferLines: () => [...buffer().children].map((li) => ({ id: li.id, text: fieldOf(li).value, order: orderOf(li) })), putLine, keysBetween, remove: (id) => db.remove(id), commit: async (message) => { // the buffer repaints a frame after the writes: press Commit once it shows them
  for (let i = 0; i < 30 && domText() === contentOf(currentBranch()?.value.head); i++) await new Promise((r) => requestAnimationFrame(r))
  $("message").value = message; $("commit-form").requestSubmit()
}, notice })
