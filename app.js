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
import { gdb } from "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.min.js"
import { ALICE, BOB, CONSTITUTION, DEMO_IDENTITIES, governanceRules } from "@constitution"

export const $ = (id) => document.getElementById(id)
export const eqAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const AUTHORITY = CONSTITUTION.authority
export let me = null, session = {}

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

// The URL says where you are and nothing else: no feature ever writes to it.
// `?room=` opens a private sandbox of the same site — what the suite gives each
// run so it starts empty; `?relay=` points signalling at a relay of your own.
const params = new URLSearchParams(location.search)
const ROOM = params.get("room") ?? "dcode"
const RELAY = params.get("relay")
const PASSKEYS_AVAILABLE = window.isSecureContext && !!window.PublicKeyCredential && !/^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname)

// ── Boot: the constitution travels beside the root of trust ─────────────────
// The database first, and nothing wired before it (design guide §5.1).
export const db = await gdb(ROOM, {
  rtc: RELAY ? { relayUrls: [RELAY] } : true, debug: params.has("debug"), // `?debug`: the engine's own log — refusals, sync, persistence — the only way to see why something did not arrive
  sm: { superAdmins: [AUTHORITY], customRoles: CONSTITUTION.roles, ...(governanceRules.length && { governanceRules }), acls: true },
})
globalThis.db = db // what the suite writes through to act as a tampered client and to read the graph back; the preview runs sandboxed on an opaque origin, so nothing it hosts reaches this

// ── The store: one subscription, every kind of node ─────────────────────────
export const nodes = new Map() // id → { id, value, timestamp }
// A set per kind beside the store. A room's lines outnumber everything else by
// an order of magnitude, and without this every list on the index walked over
// all of them — six times per repository drawn, on every keystroke.
const byKind = new Map() // type → Set of ids
const of = (type) => { const out = []; for (const id of byKind.get(type) ?? []) { const n = nodes.get(id); if (n) out.push(n) } return out }
const byNewest = (a, b) => b.value.at - a.value.at || (a.id < b.id ? -1 : 1)
const byOldest = (a, b) => a.value.at - b.value.at || (a.id < b.id ? -1 : 1)
const byOrder = (a, b) => a.value.order - b.value.order || (a.id < b.id ? -1 : 1) // the engine's rule: key, then id

// ── Derivations: pure functions of the store ────────────────────────────────
const repos = () => of("repo").sort(byNewest)
export const branchesOf = (repo) => of("branch").filter((n) => n.value.repo === repo).sort(byOldest)
export const commitsOf = (repo) => of("commit").filter((n) => n.value.repo === repo).sort(byNewest)
export const prsOf = (repo) => of("pr").filter((n) => n.value.repo === repo).sort(byNewest)
const starsOf = (repo) => of("star").filter((n) => n.value.repo === repo)
const myStar = (repo) => starsOf(repo).find((n) => eqAddr(n.value.owner, me))
/** A fork here is a branch someone else owns in the repository — the shape dCode already had. */
const forksOf = (repo, branches) => new Set(branches.filter((b) => !eqAddr(b.value.owner, repo.value.owner)).map((b) => b.value.owner.toLowerCase())).size
export const linesOf = (branch) => of("line").filter((n) => n.value.branch === branch).sort(byOrder)
export const commitOf = (id) => (id && nodes.get(id)?.value.type === "commit" ? nodes.get(id) : null)
export const contentOf = (id) => commitOf(id)?.value.content ?? plain.get(id) ?? ""
/** Every commit reachable from `id`, itself included. */
const ancestors = (id) => {
  const seen = new Set(), stack = id ? [id] : []
  while (stack.length) { const c = stack.pop(); if (!c || seen.has(c)) continue; seen.add(c); stack.push(...(commitOf(c)?.value.parents ?? [])) }
  return seen
}
export const isAncestor = (a, b) => !!a && ancestors(b).has(a)
/** The newest common ancestor of two commits. */
export const mergeBase = (a, b) => { const A = ancestors(a); return [...ancestors(b)].map(commitOf).filter(Boolean).sort(byNewest).find((c) => A.has(c.id))?.id ?? null }
export const tipsAt = (branches, id) => branches.filter((b) => b.value.head === id)
/** The engine's rule for the branch node: its owner, or a `write`/`delete` collaborator. */
export const canWriteBranch = (b) => !!me && !!b && (eqAddr(b.value.owner, me) || ["write", "delete"].includes(b.value.collaborators?.[me]))
/** Merged is a fact of the graph: the proposed commit is an ancestor of the target's head. */
export const prStatus = (pr) => {
  if (pr.value.closed) return "withdrawn"
  const into = nodes.get(pr.value.into), from = nodes.get(pr.value.from)
  if (into && isAncestor(pr.value.commit, into.value.head)) return "merged"
  return from && from.value.head !== pr.value.commit ? "open, behind" : "open"
}
export const defaultBranch = (repo, branches) => branches.find((b) => eqAddr(b.value.owner, repo.value.owner) && b.value.name === "main") ?? branches.find((b) => eqAddr(b.value.owner, repo.value.owner)) ?? branches[0] ?? null
/** The address of a place in a repository. A branch that is the repository's default is where you land anyway, so it stays out of the address; a commit needs its branch beside it, since the segments are read by position. */
export const at = (repoId, branchId, commitId) => {
  const repo = nodes.get(repoId), implied = !commitId && repo && defaultBranch(repo, branchesOf(repoId))?.id === branchId
  return `#/r/${repoId}${branchId && !implied ? `/${branchId}` : ""}${commitId ? `/${commitId}` : ""}`
}

// ── Private repositories: the engine keeps the key, the app seals the code ──
// A private repository has a vault: one encrypted node (`db.sm.put`) holding
// its key ring, newest key first. The owner grants `read` on that one node to
// each member — a key envelope per reader, wrapped and rotated by the engine —
// and every line and every commit of the repository is sealed with the current
// key before it is written as an ordinary node. Members open it on arrival;
// everyone else syncs ciphertext. Revoking a member turns both keys: the
// vault's, by the engine, and the repository's, a new one on the ring, so
// what is written afterwards is unreadable to them.
export const keyRings = new Map()  // repo id → CryptoKey[] newest first · null = asked, no envelope · absent = not asked yet
export const unlocking = new Set() // repositories whose vault is being fetched
const plain = new Map()     // commit id → content, for a sealed commit this session wrote
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
export const newKeyHex = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")
export const importKey = (hex) => crypto.subtle.importKey("raw", Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16)), "AES-GCM", false, ["encrypt", "decrypt"])
export const seal = async (repo, text) => {
  const key = keyRings.get(repo)?.[0]; if (!key) throw new Error("No key for this repository on this device")
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return `${b64(iv)}.${b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text))))}`
}
export const unseal = async (repo, sealed) => {
  const [iv, ct] = sealed.split(".").map(unb64)
  for (const key of keyRings.get(repo) ?? []) { try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)) } catch {} }
  return null
}
/** Fetch the vault: with an envelope the ring opens; without one the repository stays sealed for this identity. */
export const unlock = async (repoId) => {
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
  view?.remount(repoId) // the buffer on screen, if it is this repository's, now has text to show
}

// ── Helpers ─────────────────────────────────────────────────────────────────
export const abbr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "")
const DEMO_NAMES = Object.fromEntries(DEMO_IDENTITIES.map((i) => [i.address.toLowerCase(), i.name]))
// What each identity calls itself: the `name` field of its own `user:` node,
// which the engine ties to its key — only its subject can write it, every peer
// recovers the signature, and the same gate refuses the write if it tries to
// touch the role. A name nobody signed is the address, abbreviated.
const names = new Map() // address (lowercase) → the name it signed
export const nameOf = (addr) => names.get(addr?.toLowerCase()) || DEMO_NAMES[addr?.toLowerCase()] || abbr(addr)
/** Your name, on your own node: `role` travels untouched or every peer refuses the write. */
const setMyName = async (name) => {
  const { result } = await db.get(`user:${me}`), value = result?.value ?? {}
  await db.put({ ...value, ethAddress: me, role: value.role ?? "guest", name }, `user:${me}`)
}
export const short = (id) => (id ? id.split(":").pop().slice(0, 7) : "—")
export const branchLabel = (repo, b) => (eqAddr(b.value.owner, repo.value.owner) ? b.value.name : `${nameOf(b.value.owner)}/${b.value.name}`)
export const ago = (at) => {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return "just now"
  const [n, u] = s < 3600 ? [Math.floor(s / 60), "minute"] : s < 86400 ? [Math.floor(s / 3600), "hour"] : [Math.floor(s / 86400), "day"]
  return `${n} ${u}${n === 1 ? "" : "s"} ago`
}
export const plural = (n, w, many) => `${n} ${n === 1 ? w : many ?? `${w}s`}`
const say = (id, text) => { const el = $(id); if (el) el.textContent = text }
const TOAST_ICONS = { info: "ⓘ", success: "✓", error: "✕" }
/** Events belong here; what is TRUE stays on the page — the repository bar, the timeline, the buffer. */
export const toast = (message, kind = "info") => {
  const item = document.createElement("div")
  item.className = `toast ${kind}`
  const icon = document.createElement("span")
  icon.className = "toast-icon"
  icon.textContent = TOAST_ICONS[kind] ?? TOAST_ICONS.info
  icon.setAttribute("aria-hidden", "true") // the text alone is the message
  const text = document.createElement("span")
  text.className = "toast-text"
  text.textContent = message
  item.append(icon, text)
  $("toasts").append(item)
  while ($("toasts").children.length > 3) $("toasts").firstElementChild.remove() // three at a time, rotating: more than that is scanned, not read
  // Re-enter the top layer on every toast: order there is order of entry, so a
  // dialog opened later would sit above the stack.
  if ($("toasts").matches(":popover-open")) $("toasts").hidePopover()
  $("toasts").showPopover?.()
  setTimeout(() => {
    item.classList.add("out")
    item.addEventListener("transitionend", () => { item.remove(); if (!$("toasts").children.length) $("toasts").hidePopover?.() }, { once: true })
  }, 3200)
}
export const pendingMerge = new Map() // branch id → { parents, message } of a merge waiting for its conflicts to be resolved

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
export const create = async (value, id) => {
  await db.sm.executeWithPermission("write") // the engine's own verdict, before the write
  return db.sm.acls.set({ ...value, at: Date.now() }, id)
}
export const patch = (id, fields) => db.sm.acls.set(fields, id) // the owner, or a `write` collaborator; the engine merges into the stored node
const sha = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("")
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
export const keysBetween = (prev, next, n = 1) => {
  const lo = prev ?? 0, step = ((next ?? lo + n) - lo) / n
  return Array.from({ length: n }, (_, i) => lo + step * (i + 0.25 + Math.random() * 0.5))
}
export const keyBetween = (prev, next) => keysBetween(prev, next)[0]
export const putLine = async (repo, branch, text, order, id) =>
  db.put(keyRings.get(repo) ? { type: "line", repo, branch, order, ct: await seal(repo, text) } : { type: "line", repo, branch, text, order }, id)
/** A branch's buffer, from a file: one node per line, keys 1…n. */
export const seedLines = (repo, branch, content) => Promise.all(content.split("\n").map((text, i) => putLine(repo, branch, text, i + 1)))
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
export const commitTo = async (branch, message, content, extraParents = []) => {
  const parents = [...(branch.value.head ? [branch.value.head] : []), ...extraParents]
  const id = await newCommit({ repo: branch.value.repo, branch: branch.id, parents, message, content })
  await patch(branch.id, { head: id })
  return id
}
/** A branch you own in this repository, from the branch you stood on: its buffer copied, your commit on it. */
export const forkAndCommit = async (from, message, content) => {
  const branch = await create({ type: "branch", repo: from.value.repo, name: from.value.name, head: from.value.head })
  await seedLines(from.value.repo, branch, content)
  const id = await newCommit({ repo: from.value.repo, branch, parents: from.value.head ? [from.value.head] : [], message, content })
  await patch(branch, { head: id })
  return { branch, id }
}

// ── Views ───────────────────────────────────────────────────────────────────
let repoQuery = "", repoWho = "all", repoSort = "recent" // the filters live here; only the results are redrawn when they change
// The search is a query, not a loop: `$text` matches per field, folding accents
// and case, so «cafe» finds «café», and it is a SUBSCRIPTION — a repository
// another peer creates, renames or removes while you read the results enters or
// leaves them on its own. One live query at a time: typing replaces it, emptying
// the box drops it. The owners whose name matches travel in the same query as an
// `$in`, because a name lives on its identity's own node, not on the repository.
let matching = null, searchSub = null, searchTimer = null
const renderResults = () => { const box = $("repo-list"); if (box) box.innerHTML = repoList() }
/** What the room is being asked for: every repository, or the ones a search matches. */
const repoWhere = (q) => {
  if (!q) return { type: "repo" }
  const owners = repos().filter((r) => nameOf(r.value.owner).toLowerCase().includes(q.toLowerCase())).map((r) => r.value.owner)
  return { type: "repo", $or: [{ name: { $text: q } }, { description: { $text: q } }, ...(owners.length ? [{ owner: { $in: owners } }] : [])] }
}
const searchRepos = async (q) => {
  searchSub?.unsubscribe?.(); searchSub = null; matching = null
  if (repoSort === "new") newestPage()
  if (!q) return renderResults()
  const found = matching = new Set()
  // `initial` arrives one event per match: the set it describes is the `results`
  // the call returns, so it is taken in one go and the list is drawn once. What
  // the callback is for is everything after — the repository a peer creates,
  // renames out of the results, or removes while you are reading them.
  const { results, unsubscribe } = await db.map({ query: repoWhere(q) },
    ({ id, action }) => { if (matching !== found || action === "initial") return; action === "removed" ? found.delete(id) : found.add(id); renderResults() })
  if (matching !== found) return unsubscribe() // the next keystroke got here first: this query says nothing
  for (const n of results) found.add(n.id)
  searchSub = { unsubscribe }
  renderResults()
}
const SORTS = { recent: "Recently active", new: "Newest", stars: "Most starred", name: "Name" }
// A room only grows, so the list is a window and the window grows as you reach
// the end of the column — examples/infinite-scroll.html, where it earns its keep.
// Under «Newest» the pages are the ENGINE'S: `field` and `order` make the cursor
// deterministic between peers (without them `$after` walks each peer's own
// insertion order), `$limit` is the page, and the next one is asked for by the id
// of the last row. The other three orders are the application's own — the newest
// commit's time and a count of stars live on other nodes, and the engine cannot
// order by what it cannot compute — so there the window is a slice of the store.
const PAGE = 24
let shown = PAGE, newest = [], newestMore = false, loadingPage = false
const newestPage = async (more = false) => {
  if (loadingPage) return
  loadingPage = true
  const limit = more ? PAGE : Math.max(newest.length, PAGE)
  const { results } = await db.map({ query: repoWhere(repoQuery.trim()), field: "at", order: "desc", $limit: limit, ...(more && newest.length ? { $after: newest.at(-1) } : {}) })
  newest = more ? [...newest, ...results.map((n) => n.id)] : results.map((n) => n.id)
  newestMore = results.length === limit
  loadingPage = false
  renderResults()
}
/** The end of the column asks for the next page — of the engine's order, or of the app's. */
const moreRepos = () => {
  if (repoSort === "new") return newestMore && newestPage(true)
  if (shown < repos().length) { shown += PAGE; renderResults() }
}
document.addEventListener("scroll", (e) => { // scroll does not bubble: the column is caught on the way down
  const col = e.target
  if (col?.classList?.contains("results") && col.scrollTop + col.clientHeight >= col.scrollHeight - 240) moreRepos()
}, true)
const WHO = { all: "All", mine: "Mine", starred: "Starred by me" }
/** The results alone, so a keystroke or a filter costs a list and not a page. */
const repoList = () => {
  const q = repoQuery.trim()
  const at = (r) => commitsOf(r.id)[0]?.value.at ?? 0
  const mine = (r) => repoWho === "all" || (repoWho === "mine" ? eqAddr(r.value.owner, me) : !!myStar(r.id))
  const all = repos().filter((r) => !matching || matching.has(r.id)).filter(mine)
  const page = repoSort === "new"
    ? newest.map((id) => nodes.get(id)).filter((n) => n && mine(n)) // the engine's window, in the engine's order
    : all.sort((a, b) => (repoSort === "stars" ? starsOf(b.id).length - starsOf(a.id).length : repoSort === "name" ? a.value.name.localeCompare(b.value.name) : at(b) - at(a))).slice(0, shown)
  const rows = page.map((r) => {
    const branches = branchesOf(r.id), stars = starsOf(r.id).length, forks = forksOf(r, branches), last = commitsOf(r.id)[0]
    return `<li>
<div class="repo-head"><a class="name" href="#/r/${esc(r.id)}">${esc(r.value.name)}</a>${r.value.vault ? `<span class="lock" title="Private: the code is sealed for its members">private</span>` : ""}
<button class="star${myStar(r.id) ? " on" : ""}" data-act="star" data-repo="${esc(r.id)}" title="${myStar(r.id) ? "Starred — click to take it back" : "Star this repository"}" ${me ? "" : "disabled"}>★ ${stars}</button></div>
<p class="desc">${esc(r.value.description) || `<span class="dim">no description</span>`}</p>
<p class="repo-meta"><span title="Branches">⑂ ${plural(branches.length, "branch", "branches")}</span>${forks ? `<span title="People with a branch of their own here">${plural(forks, "fork")}</span>` : ""}<span title="Commits">${plural(commitsOf(r.id).length, "commit")}</span><span class="by">by ${esc(nameOf(r.value.owner))}</span>${last ? `<span class="when">${ago(last.value.at)}</span>` : ""}</p></li>`
  })
  const more = repoSort === "new" ? newestMore : page.length < all.length
  return `<p class="results-count">${plural(all.length, "repository", "repositories")}${q ? ` matching “${esc(repoQuery)}”` : ""}</p>
${rows.length ? `<ul class="repos">${rows.join("")}</ul>` : `<div class="empty">${q || repoWho !== "all" ? "Nothing here matches." : `No repositories in this room yet${me ? ` — <a href="#/new">create the first</a>` : ""}.`}</div>`}
${more ? `<p class="results-more">${page.length} of ${all.length} — keep scrolling</p>` : ""}`
}
const reposPage = () => `<div class="page repos-page">
<aside class="filters">
  <input type="search" id="repo-search" class="repo-search" placeholder="Search repositories" aria-label="Search repositories" value="${esc(repoQuery)}">
  <h2>Owner</h2>
  <div class="filter-group" data-filter="who">${Object.entries(WHO).map(([k, label]) => `<button class="chip-btn${repoWho === k ? " on" : ""}" data-who="${k}"${k !== "all" && !me ? " disabled" : ""}>${label}</button>`).join("")}</div>
  <h2>Sort</h2>
  <div class="filter-group" data-filter="sort">${Object.entries(SORTS).map(([k, label]) => `<button class="chip-btn${repoSort === k ? " on" : ""}" data-sort="${k}">${label}</button>`).join("")}</div>
  ${me ? `<a class="btn primary new-repo" href="#/new">New repository</a>` : `<a class="btn new-repo" href="#/login">Sign in to create one</a>`}
  ${repos().some((r) => eqAddr(r.value.owner, me)) ? `<p class="testing">Testing: <button type="button" class="small ghost" data-act="delete-mine" title="Remove the repositories you own — the lines, the branches, the commits and pull requests you signed — as writes every peer accepts">Delete my repositories</button></p>` : ""}
</aside>
<section class="results">
  <h1>Repositories</h1>
  <p class="lede">Single-file HTML projects — HTML, CSS and JavaScript in one editor — with branches, forks and pull requests. The editor is shared line by line, live; every commit is a node its author owns and a page you can run; nothing here is hosted by anyone.</p>
  <div id="repo-list">${repoList()}</div>
</section></div>`
/** New repository: a dialog over the index, because it is a form and not a place. */
const newDialog = () => (me ? `<form id="new-form" class="formtable" method="dialog">
<h2>New repository</h2>
<p class="lede">A repository is a node you own: a name and a description. It opens in the editor with a starter page in its shared buffer — HTML, CSS and JavaScript in one file — on its <code>main</code> branch, as its first commit.</p>
<label for="nf-name">name</label><input id="nf-name" type="text" name="name" maxlength="60" pattern="[A-Za-z0-9._\\-]{1,60}" required autocomplete="off" placeholder="my-project">
<label for="nf-desc">description</label><input id="nf-desc" type="text" name="description" maxlength="160" autocomplete="off" placeholder="What it is, in a line">
<label class="check"><input type="checkbox" name="private" id="nf-private"> Private — the code is sealed with a key only the members you grant can hold; the name, the branches and the pull request titles stay visible</label>
<div class="actions"><button type="button" class="ghost" data-act="close-new">Cancel</button><button type="submit" class="primary">Create repository and open the editor</button></div>
<p class="note">The first commit will be signed by ${esc(nameOf(me))} (${esc(me)}). Nobody else can move <code>main</code> until you grant them write.</p></form>`
  : `<div class="signed-out"><h2>New repository</h2><p class="lede">A repository is a node you own, so it needs an identity. <a href="#/login">Sign in</a> and it opens here.</p><div class="actions"><button type="button" class="ghost" data-act="close-new">Close</button></div></div>`)
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
  const mine = of("commit").filter((c) => eqAddr(c.value.owner, me))
  const owned = repos().filter((r) => eqAddr(r.value.owner, me))
  return `<div class="page session-page"><aside class="identity"><h1>Your identity</h1>
<p class="lede">A key pair on this device. Every commit you make is signed with it. A mnemonic recovers it anywhere; a passkey keeps the session on this browser and never types the phrase again.</p>
<form id="name-form" class="row name-form"><label for="my-name">name</label><input id="my-name" type="text" name="name" maxlength="32" autocomplete="off" placeholder="${esc(abbr(me))}" value="${esc(names.get(me.toLowerCase()) ?? DEMO_NAMES[me.toLowerCase()] ?? "")}"><button type="submit" class="small">Save</button></form>
<table class="facts">
<tr><td>address</td><td><code id="my-address">${esc(me)}</code> <button class="small" data-act="copy-address">Copy</button></td></tr>
<tr><td>role</td><td>${eqAddr(me, AUTHORITY) ? "superadmin" : "guest"}</td></tr>
<tr><td>unlocked by</td><td id="unlocked-by">${s.isWebAuthnProtected ? "passkey" : "mnemonic"}</td></tr>
<tr><td>protected by a passkey</td><td>${yn(s.isWebAuthnProtected)}</td></tr>
<tr><td>passkey on this browser</td><td>${yn(s.hasWebAuthnHardwareRegistration)}</td></tr>
</table>
<div class="actions">${canProtect ? `<button class="primary" id="protect-btn">Protect this identity with a passkey</button>` : ""}<button id="signout-btn">Sign out</button></div>
<p class="note">${!PASSKEYS_AVAILABLE ? "Passkeys need HTTPS or localhost — an IP address is never a valid Relying Party ID." : s.isWebAuthnProtected ? "Sign out and back in with the passkey: the phrase is never typed again." : s.hasVolatileIdentity ? "Until a passkey holds it, the phrase is the only way to open this identity again — here or anywhere." : "This session was opened by a passkey."}</p>
<p class="note">A name is a label you sign: it lives on your own <code>user:</code> node, so nobody can set yours and every peer verifies who wrote it — and the same gate refuses the write if it tries to touch your role. Two identities may pick the same name; the address underneath is the one that cannot be copied. Leave it empty and you are your address again. A demo identity arrives named by the constitution, which is the app talking, not a signature — save it and the name becomes yours, signed like any other write.</p>
<p class="note status" id="login-status"></p></aside>
<section class="activity">
  <h2>Activity</h2>
  <p class="lede">Every commit you have signed, from the graph on this device. Nothing was collected to draw it: the timestamps are the ones the commits carry.</p>
  <div id="calendar" class="calendar-slot"></div>
  <dl class="tallies">
    <div><dt>commits signed</dt><dd>${mine.length}</dd></div>
    <div><dt>repositories owned</dt><dd>${owned.length}</dd></div>
    <div><dt>stars given</dt><dd>${of("star").filter((n) => eqAddr(n.value.owner, me)).length}</dd></div>
    <div><dt>branches of yours</dt><dd>${of("branch").filter((b) => eqAddr(b.value.owner, me)).length}</dd></div>
  </dl>
</section></div>`
}
/** The calendar arrives on demand: only this page asks for it, and only when it is open. */
const paintActivity = async () => {
  const slot = $("calendar"); if (!slot || !me) return
  const { activityCalendar } = await import("@activity")
  if ($("calendar") !== slot) return // navigated away while the module loaded
  slot.innerHTML = activityCalendar(of("commit").filter((c) => eqAddr(c.value.owner, me)).map((c) => c.value.at))
}
const constitutionPage = () => `<div class="page constitution">
<h1>Constitution</h1><p class="lede">This page is <code>constitution.js</code>, rendered. The rules you read are the rules that run — on every peer, with nobody in between.</p>
<h2>The authority</h2><p><code>${esc(AUTHORITY)}</code> — its only power is restricting an identity, with its signature. It cannot touch a repository, a branch or a commit it does not own: every one is owned by its author, and the engine refuses anyone else's edit or deletion, the authority included.</p>
<h2>Roles — enforced by the engine on every peer</h2><table>${Object.entries(CONSTITUTION.roles).map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(JSON.stringify(v))}</code><br><span class="rule">${esc(CONSTITUTION.roleText[k] ?? "")}</span></td></tr>`).join("")}</table>
<h2>What ownership means here</h2><table>${CONSTITUTION.principles.map(([t, text]) => `<tr><td>${esc(t)}</td><td><span class="rule">${esc(text)}</span></td></tr>`).join("")}</table>
<h2>Amendment</h2><p>${esc(CONSTITUTION.amendment)} <a href="https://github.com/estebanrfp/dCode/blob/main/constitution.js">The file.</a></p>
${me ? `<h2>You, under it</h2><p>${esc(nameOf(me))} · <code>${esc(me)}</code> · role <b>${eqAddr(me, AUTHORITY) ? "superadmin" : "guest"}</b></p>` : ""}</div>`

// ── Router and render ───────────────────────────────────────────────────────
export const route = () => {
  const seg = location.hash.slice(1).split("/").filter(Boolean).map(decodeURIComponent)
  return { page: seg[0] ?? "", repo: seg[1] ?? null, branch: seg[2] ?? null, commit: seg[3] ?? null }
}
export const currentBranch = () => { const r = route(); const repo = nodes.get(r.repo); if (!repo) return null; const branches = branchesOf(repo.id); return branches.find((b) => b.id === r.branch) ?? defaultBranch(repo, branches) }
let renderQueued = false, dirtyWhileTyping = false, subscribed = false
export const scheduleRender = () => { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render() }) }
// Never repaint a form under the reader's caret. The buffer and the commit
// message live in the skeleton, which a store change never rebuilds; the
// dock's forms do not, so a render waits while one is being typed in.
const typing = () => document.hasFocus() && $("main").contains(document.activeElement) && !!document.activeElement.closest(".dock, .page") &&
  document.activeElement.matches("textarea, select, input:not([type=submit]):not([type=button]):not([type=checkbox])")

// The repository view — the dock, the timeline, the diff and the merges — is a
// third of this application, and none of it belongs to the index: the router
// asks for the module the first time a repository is on screen and renders
// again when it lands. The agent comes with it, because it edits in there.
// Everything the shell calls on `view` afterwards is reachable only from
// inside a repository, where the module is already here.
let view = null, viewLoading = null
const loadView = () => (viewLoading ??= import("@repo").then((m) => { view = m; render() },
  () => { viewLoading = null; toast("The repository view did not arrive. It is a file of this page and the next attempt refetches it.", "error") })) // offline, or a CDN that did not answer: say so instead of a blank page

export const render = () => {
  if (!subscribed) return
  if (typing()) { dirtyWhileTyping = true; return }
  const r = route(), main = $("main")
  renderNav(r.page); renderSession()
  // Decided before anything returns: a dialog left open would swallow every click
  // behind it. It opens whether or not the session has arrived — without one it
  // says so — and its contents are rewritten only when that changes.
  const wantNew = r.page === "new", modal = $("new-modal")
  if (wantNew && modal.dataset.me !== (me ?? "")) { modal.dataset.me = me ?? ""; modal.innerHTML = newDialog(); $("nf-name")?.focus() }
  if (wantNew && !modal.open) { modal.showModal(); $("nf-name")?.focus() }
  if (!wantNew && modal.open) { modal.close(); modal.dataset.me = "-" }
  if (r.page === "r" && r.repo) return view ? view.renderRepo(r, main) : void loadView()
  main.dataset.repo = ""; view?.unmountBuffer()
  main.classList.toggle("full", ["", "login", "new", "session"].includes(r.page)) // the index and the identity fill the window, like the repository view
  if (r.page === "login" && !me && !door.open) door.showModal() // a contextual "Sign in" re-opens the door; the page behind it stays
  const page = r.page === "login" || r.page === "new" ? "" : r.page // login and new are dialogs over the index, not pages of their own
  const titles = { "": "dCode", new: "New repository · dCode", session: "Your identity · dCode", constitution: "Constitution · dCode" }
  main.innerHTML = { "": reposPage, session: sessionPage, constitution: constitutionPage }[page]?.() ?? `<div class="page"><p class="muted">No such page.</p></div>`
  if (page === "session") paintActivity()
  // No session yet: the index stands, and the dialog opens by itself the moment
  // the session callback brings one — never a redirect out from under the route.
  document.title = titles[page] ?? "dCode"
}
const renderNav = (page) => {
  $("nav").innerHTML = [["", "repositories"], ["new", "new"], ["constitution", "constitution"]].map(([p, label]) => `<a href="#/${p}" data-nav="${p}"${page === p ? ' class="sel"' : ""}>${label}</a>`).join("")
}
const renderSession = () => { // the pill: name · abbreviated address, opening the identity view; the logout icon beside the theme
  const pill = $("session-addr"), label = me && names.get(me.toLowerCase()) // the name you signed, else the demo's, else nothing but the address
    || DEMO_NAMES[me?.toLowerCase()]
  pill.textContent = me ? (label ? `${label} · ${session.abbrAddr}` : session.abbrAddr ?? me) : ""
  pill.title = me ? `${me} — your identity` : ""
  show($("logout-btn"), !!me)
}

// ── Events: the chrome's own ────────────────────────────────────────────────
// The theme, the door and what belongs to no page. A view owns its gestures:
// the repository's are in `repo.js`, the buffer's in `editor.js`.
document.addEventListener("click", async (e) => {
  const a = e.target.closest("a, button"); if (!a) return
  const act = a.dataset.act
  try {
    if (a.id === "theme-btn") { applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(document.documentElement.dataset.pref) + 1) % THEME_ORDER.length]); return }
    if (act === "copy-address") { try { await navigator.clipboard.writeText(me); say("login-status", "Address copied.") } catch { say("login-status", "Clipboard unavailable — select the address and copy it.") } return }
    if (act === "close-new") { location.hash = "#/"; return }
    if (act === "star") {
      if (!me) return toast("Sign in to star a repository.", "error")
      const mine = myStar(a.dataset.repo)
      await (mine ? db.remove(mine.id) : create({ type: "star", repo: a.dataset.repo }))
      return // the subscription repaints: a star is a node like any other, and everyone counts the same set
    }
    if (act === "delete-mine") { // testing, on the home page: what you own, removed as writes every peer accepts. `db.clear()` would wipe
      // this device alone and the room would hand the graph straight back, so what leaves has to leave as signed removals: the lines of
      // every branch, then the branches, commits and pull requests you signed, the vault of a private one, and last the repository node.
      if (!a.dataset.armed) { a.dataset.armed = "1"; a.textContent = "Delete them, really?"; setTimeout(() => { a.dataset.armed = ""; a.textContent = "Delete my repositories" }, 4000); return }
      a.disabled = true
      for (const r of repos().filter((x) => eqAddr(x.value.owner, me))) {
        const branches = branchesOf(r.id)
        await Promise.all(branches.flatMap((b) => linesOf(b.id).map((n) => db.remove(n.id))))
        await Promise.all([...commitsOf(r.id), ...prsOf(r.id), ...branches].filter((n) => eqAddr(n.value.owner, me)).map((n) => db.remove(n.id)))
        if (r.value.vault) await db.sm.remove(r.value.vault).catch(() => {})
        await db.remove(r.id)
      }
      toast("Your repositories are gone, on every peer. What others forked or committed of them is theirs and stays.")
      a.disabled = false; a.dataset.armed = ""; a.textContent = "Delete my repositories"; scheduleRender(); return
    }
    if (a.id === "logout-btn" || a.id === "signout-btn") { e.preventDefault(); return db.sm.clearSecurity() }
    if (a.id === "seed-btn") { e.preventDefault(); await seedExamples(a); return }
    if (a.id === "reset-btn") { // testing, in the door: this device's copy of the graph, gone. It is not a reset of the room and cannot be —
      // every other peer still holds what it holds and hands back whatever it has on the next connection. What lived only here does go,
      // which is what makes it worth a button: a graph from an older shape of the app, or ops nobody accepts any more, leave with it.
      e.preventDefault(); a.disabled = true
      await db.clear()
      say("door-status", "This device's copy is gone. What other peers still hold comes back on its own.")
      a.disabled = false; return
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
  } catch (err) { toast(err.message) }
})
document.addEventListener("submit", async (e) => {
  const f = e.target; if (f.id !== "new-form" && f.id !== "name-form") return
  e.preventDefault()
  const field = (name) => (new FormData(f).get(name) ?? "").toString().trim()
  if (!me) { sessionStorage.dcodeGoto = location.hash; location.hash = "#/login"; return }
  try {
    if (f.id === "name-form") { await setMyName(field("name")); toast(field("name") ? `You are ${field("name")} on every peer.` : "Your address is your name again.", "success"); return }
    const { repo } = await newRepo(field("name"), field("description"), TEMPLATE, new FormData(f).get("private") === "on")
    location.hash = `#/r/${repo}` // its `main` is the branch you land on: the address does not have to say so
  } catch (err) { toast(err.message) }
})

document.addEventListener("close", (e) => { if (e.target.id === "new-modal" && location.hash.startsWith("#/new")) location.hash = "#/" }, true)
document.addEventListener("input", (e) => { // one query per pause, not one per keystroke
  if (e.target.id !== "repo-search" || !$("repo-list")) return
  repoQuery = e.target.value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => searchRepos(repoQuery.trim()), 150)
})
document.addEventListener("click", (e) => { // a filter marks itself and redraws the results, never the page: the search box keeps its caret
  const btn = e.target.closest("[data-who], [data-sort]"); if (!btn || !$("repo-list")) return
  if (btn.dataset.who) repoWho = btn.dataset.who; else repoSort = btn.dataset.sort
  shown = PAGE
  $("repo-list")?.closest(".results")?.scrollTo(0, 0) // another order is another list: read it from its top, or its end asks for a page at once
  if (repoSort === "new") newestPage() // the engine owns this order: ask it for the first page
  for (const other of btn.parentElement.children) other.classList.toggle("on", other === btn)
  $("repo-list").innerHTML = repoList()
})
document.addEventListener("focusout", () => { if (dirtyWhileTyping) { dirtyWhileTyping = false; scheduleRender() } })
addEventListener("hashchange", () => { if (!document.activeElement?.closest(".line")) document.activeElement?.blur(); render() })

// ── Fifty projects, written from this browser ───────────────────────────────
// A room with nobody in it is empty, and that is the whole point of the model —
// so the door offers to fill this one. Sixteen kinds of small page over fifty
// subjects: landings, forms, to-do lists, boards, price lists, questions, a
// timer, a quiz, notes, a bill split, a chart, photographs, a menu, a week, a
// shelf and a waiting list. They are real repositories, made the way the New
// form makes them — a node per line, an initial commit signed by Alice or by
// Bob, nothing hosted by anyone. The pages arrive with the module and only when
// this is pressed. Pressing it twice writes nothing twice: a name already in the
// room is left alone.
const seedExamples = async (button) => {
  button.disabled = true
  try {
    const { examples } = await import("@examples")
    const all = examples()
    toast(`Writing ${all.length} projects into this room. Watch them arrive.`)
    const started = Date.now()
    for (const [i, project] of all.entries()) {
      const who = i < Math.ceil(all.length * 0.7) ? ALICE : BOB // two owners, so a fork has somewhere to come from
      if (!eqAddr(me, who.address)) await db.sm.loginOrRecoverUserWithMnemonic(who.mnemonic)
      if (!repos().some((r) => r.value.name === project.name)) await newRepo(project.name, project.description, project.html)
      // Every project is a node and fifty lines of signed writes: give the frame
      // back between them, so the room is seen filling instead of the page freezing.
      await new Promise((paint) => setTimeout(paint))
      if ((i + 1) % 40 === 0) toast(`${i + 1} of ${all.length} written…`)
    }
    toast(`${all.length} projects are in this room in ${Math.round((Date.now() - started) / 1000)}s, signed by ${ALICE.name} and ${BOB.name}. They live on whoever holds them — you, now.`, "success")
  } catch (err) { toast(err.message, "error") } finally { button.disabled = false }
}

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
// A sealed record shows no `type` — its whole value is ciphertext — so the query
// asks for our types or for a node without one, and a vault is recognised by the
// id its repository already holds. A grant or a revocation rewrites that record,
// which is how a member's page learns to ask for the key again, on its own.
const chains = new Map() // per node: sealed values open in arrival order
const inOrder = (id, fn) => { const p = (chains.get(id) ?? Promise.resolve()).then(fn, fn); chains.set(id, p); return p }
await db.map({ query: { $or: [{ type: { $in: ["repo", "branch", "commit", "pr", "line", "star"] } }, { type: { $exists: false } }] } }, ({ id, value: stored, timestamp, action }) => {
  const value = stored && { ...stored } // our copy: what is opened here is written on no disk — the engine's object is what it persists
  if (value && value.type === undefined) {
    if (id.startsWith("user:")) { // an identity's own node: what it calls itself, and nothing else this app reads
      const addr = id.slice(5).toLowerCase()
      if ((names.get(addr) ?? "") !== (value.name ?? "")) { value.name ? names.set(addr, value.name) : names.delete(addr); scheduleRender() }
      return
    }
    const repo = of("repo").find((r) => r.value.vault && id.endsWith(r.value.vault))
    if (repo && (keyRings.has(repo.id) || route().repo === repo.id)) { keyRings.delete(repo.id); view?.forgetMembers(); unlock(repo.id) }
    return
  }
  const known = nodes.get(id)
  const kind = (type) => byKind.get(type) ?? byKind.set(type, new Set()).get(type)
  if (action === "removed") { nodes.delete(id); if (known) kind(known.value.type).delete(id) }
  else { nodes.set(id, { id, value, timestamp }); kind(value.type).add(id) }
  const line = value?.type === "line" ? value : known?.value.type === "line" ? known.value : null
  const dispatchLine = () => view?.dispatchLine(id, value, action, line.branch)
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
  // The engine's window is a page it handed over: when the set under it changes, ask again.
  if (repoSort === "new" && (value?.type === "repo" || known?.value.type === "repo")) newestPage()
  scheduleRender()
})
subscribed = true

// ── Presence, in the footer, as on every GenosDB page ───────────────────────
const presence = () => { const n = Object.keys(db.room?.getPeers() ?? {}).length; $("presence").textContent = `${n} peer${n === 1 ? "" : "s"}` }
db.room?.on("peer:join", presence)
db.room?.on("peer:leave", presence) // the carets are the editor's business, and it listens for them itself
presence()

// The first paint, last of all: it may already be a repository, and that is
// what brings the view — and the agent inside it — in.
render()
