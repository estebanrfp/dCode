// dCode — code with a timeline, and no server.
//
// A repository, a branch, a commit and a pull request are nodes in a GenosDB
// graph that lives in each visitor's browser and syncs peer-to-peer over
// WebRTC. The Security Manager signs every write and every peer verifies it:
// a commit can only be created by its author under an id that carries the
// author's address; a branch head can only be moved by the branch's owner or
// an address the owner granted; whether a pull request is merged is read from
// the graph, not written by anyone. Every commit is a whole single-file HTML
// project, so every row of the timeline runs. The working copy is local, like
// git's working tree: the commit is what travels.
import { CONSTITUTION, DEMO_IDENTITIES, governanceRules } from "./constitution.js"

const $ = (id) => document.getElementById(id)
const eqAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const AUTHORITY = CONSTITUTION.authority
let me = null, session = {}

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

// ── Derivations: pure functions of the store ────────────────────────────────
const repos = () => of("repo").sort(byNewest)
const branchesOf = (repo) => of("branch").filter((n) => n.value.repo === repo).sort(byOldest)
const commitsOf = (repo) => of("commit").filter((n) => n.value.repo === repo).sort(byNewest)
const prsOf = (repo) => of("pr").filter((n) => n.value.repo === repo).sort(byNewest)
const commitOf = (id) => (id && nodes.get(id)?.value.type === "commit" ? nodes.get(id) : null)
const contentOf = (id) => commitOf(id)?.value.content ?? ""
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
 * are bounded by lines both sides left in place.
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

// The working copy lives on this device, per branch — git's working tree.
const draftKey = (branch) => `dcode:${ROOM}:draft:${branch}`
const getDraft = (branch) => localStorage.getItem(draftKey(branch))
const setDraft = (branch, text) => localStorage.setItem(draftKey(branch), text)
const clearDraft = (branch) => localStorage.removeItem(draftKey(branch))
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

// ── Writes: every one a node you own ────────────────────────────────────────
// No id: with `owner` on the value the engine names the node `${owner}:${uuid}`,
// an owned id every peer enforces. A commit names itself: the author's address
// and a hash of what it holds — nobody else can create it, on any peer.
const create = async (value, id) => {
  await db.sm.executeWithPermission("write") // the engine's own verdict, before the write
  return db.sm.acls.set({ ...value, at: Date.now() }, id)
}
const patch = (id, fields) => db.sm.acls.set(fields, id) // the owner, or a `write` collaborator; the engine merges into the stored node
const newCommit = async ({ repo, branch, parents, message, content }) => {
  const at = Date.now()
  const id = `${me}:${(await sha([repo, parents.join(","), message, content, at].join("\n"))).slice(0, 40)}`
  await db.sm.executeWithPermission("write")
  await db.sm.acls.set({ type: "commit", repo, branch, parents, message, content, at }, id)
  return id
}
const newRepo = async (name, description, content) => {
  const repo = await create({ type: "repo", name, description })
  const branch = await create({ type: "branch", repo, name: "main", head: null })
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
/** A branch you own in this repository, from the commit you stand on, with your commit on it. */
const forkAndCommit = async (from, message, content) => {
  const branch = await create({ type: "branch", repo: from.value.repo, name: from.value.name, head: from.value.head })
  const id = await newCommit({ repo: from.value.repo, branch, parents: from.value.head ? [from.value.head] : [], message, content })
  await patch(branch, { head: id })
  return { branch, id }
}
const mergePR = async (pr) => {
  const repo = nodes.get(pr.value.repo), into = nodes.get(pr.value.into), from = nodes.get(pr.value.from), theirs = commitOf(pr.value.commit)
  if (!repo || !into || !from || !theirs) return notice("The pull request's branch or commit has not synced here yet.")
  if (!canWriteBranch(into)) return notice(`Only the owner of ${branchLabel(repo, into)} can merge into it.`)
  const ours = commitOf(into.value.head)
  if (!ours || isAncestor(ours.id, theirs.id)) { await patch(into.id, { head: theirs.id }); return notice(`Fast-forwarded ${branchLabel(repo, into)} to ${short(theirs.id)}.`) }
  const message = `Merge ${branchLabel(repo, from)} into ${branchLabel(repo, into)}`
  const { text, conflicts } = merge3(contentOf(mergeBase(ours.id, theirs.id)), ours.value.content, theirs.value.content)
  if (!conflicts) { const id = await commitTo(into, message, text, [theirs.id]); return notice(`Merged as ${short(id)}: both sides' changes, no conflicts.`) }
  // The conflicts go to the target owner's editor, marked; committing from there makes the merge commit.
  pendingMerge.set(into.id, { parents: [theirs.id], message })
  setDraft(into.id, text)
  location.hash = `#/r/${repo.id}/${into.id}`
  $("main").dataset.branch = "" // reload the editor from the draft — now, whether or not the hash changed
  render()
  notice(`${plural(conflicts, "conflict")}. Resolve the marked lines in the editor and commit: that commit will be the merge.`)
}

// ── Views ───────────────────────────────────────────────────────────────────
const reposPage = () => {
  const list = repos()
  const rows = list.map((r) => {
    const branches = branchesOf(r.id), commits = commitsOf(r.id)
    return `<li><a class="name" href="#/r/${esc(r.id)}">${esc(r.value.name)}</a><span class="meta">${plural(branches.length, "branch")} · ${plural(commits.length, "commit")}${commits[0] ? ` · ${ago(commits[0].value.at)}` : ""}</span><span class="desc">${esc(r.value.description) || "<span class=\"dim\">no description</span>"} <span class="dim">— by ${esc(nameOf(r.value.owner))}</span></span></li>`
  })
  return `<div class="page"><h1>Repositories</h1><p class="lede">Single-file HTML projects with branches, forks and pull requests. Every commit is a node its author owns and a page you can run; nothing here is hosted by anyone. ${me ? `<a href="#/new">Create one</a>.` : `<a href="#/login">Sign in</a> to create one.`}</p>
${rows.length ? `<ul class="repos">${rows.join("")}</ul>` : `<div class="empty">No repositories in this room yet${me ? ` — <a href="#/new">create the first</a>` : ""}.</div>`}</div>`
}

const newPage = () => (me
  ? `<div class="page"><h1>New repository</h1><p class="lede">A repository is a node you own: a name and a description. Its <code>main</code> branch and the first commit are created with it, and the commit is the whole project — one HTML file.</p>
<form id="new-form" class="formtable"><label for="nf-name">name</label><input id="nf-name" type="text" name="name" maxlength="60" pattern="[A-Za-z0-9._-]{1,60}" required autocomplete="off" placeholder="my-project">
<label for="nf-desc">description</label><input id="nf-desc" type="text" name="description" maxlength="160" autocomplete="off" placeholder="What it is, in a line">
<label for="nf-content">index.html</label><textarea id="nf-content" name="content" class="code" spellcheck="false">${esc(TEMPLATE)}</textarea>
<div class="actions"><button type="submit" class="primary">Create repository</button></div>
<p class="note">The first commit will be signed by ${esc(nameOf(me))} (${esc(me)}). Nobody else can move <code>main</code> until you grant them write.</p></form></div>`
  : `<div class="page"><h1>New repository</h1><p class="lede"><a href="#/login">Sign in</a> to create a repository.</p></div>`)

const loginPage = () => {
  const s = session, onboarding = s.hasVolatileIdentity && !s.isActive
  const demo = DEMO_IDENTITIES.map((i) => `<a href="#" class="demo-login" data-address="${esc(i.address)}">${i.emoji} ${esc(i.name)}${eqAddr(i.address, AUTHORITY) ? " (the authority)" : ""}</a>`).join("")
  return `<div class="page"><h1>${onboarding ? "Your new identity" : "Sign in"}</h1><div class="formtable" style="margin-top:12px">
<label for="mnemonic">phrase</label><textarea id="mnemonic" class="phrase" rows="3" placeholder="Enter your 12-word mnemonic phrase to sign in or recover…"${onboarding ? " readonly" : ""}>${onboarding ? esc(db.sm.getMnemonicForDisplayAfterRegistrationOrRecovery() ?? "") : ""}</textarea>
${onboarding ? `<p class="note danger">Save this phrase. There is no reset.</p>` : ""}
<div class="actions"><button id="login-btn">sign in with mnemonic</button>${!onboarding ? `<button id="generate-btn">generate new identity</button>` : ""}${onboarding && PASSKEYS_AVAILABLE && !s.isWebAuthnProtected ? `<button id="passkey-protect-btn">protect with passkey</button>` : ""}${!onboarding && PASSKEYS_AVAILABLE && s.hasWebAuthnHardwareRegistration ? `<button id="passkey-login-btn">sign in with passkey</button>` : ""}</div>
${!onboarding ? `<p class="note demo">Demo identities, one click, so two windows can meet: ${demo}</p>` : ""}
<p class="note">There is no account and no server: an identity is a key pair on this device. A mnemonic recovers it anywhere; a passkey keeps the session on this browser. Every commit you make is signed with it.</p>
<p class="note status" id="login-status"></p></div></div>`
}

const constitutionPage = () => `<div class="page constitution">
<h1>Constitution</h1><p class="lede">This page is <code>constitution.js</code>, rendered. The rules you read are the rules that run — on every peer, with nobody in between.</p>
<h2>The authority</h2><p><code>${esc(AUTHORITY)}</code> — its only power is restricting an identity, with its signature. It cannot touch a repository, a branch or a commit it does not own: every node is owned by its author, and the engine refuses anyone else's edit or deletion, the authority included.</p>
<h2>Roles — enforced by the engine on every peer</h2><table>${Object.entries(CONSTITUTION.roles).map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(JSON.stringify(v))}</code><br><span class="rule">${esc(CONSTITUTION.roleText[k] ?? "")}</span></td></tr>`).join("")}</table>
<h2>What ownership means here</h2><table>${CONSTITUTION.principles.map(([t, text]) => `<tr><td>${esc(t)}</td><td><span class="rule">${esc(text)}</span></td></tr>`).join("")}</table>
<h2>Amendment</h2><p>${esc(CONSTITUTION.amendment)} <a href="https://github.com/estebanrfp/dCode/blob/main/constitution.js">The file.</a></p>
${me ? `<h2>You, under it</h2><p>${esc(nameOf(me))} · <code>${esc(me)}</code> · role <b>${eqAddr(me, AUTHORITY) ? "superadmin" : "guest"}</b></p>` : ""}</div>`

// The repository page is a skeleton built once per repository; the regions
// inside it are redrawn from the store, and the editor and the running app
// are never rebuilt under you.
const repoSkeleton = (repo) => `<section class="repo">
<header class="repo-head"><h1>${esc(repo.value.name)}</h1><span class="desc">${esc(repo.value.description)}</span><span class="by">by ${esc(nameOf(repo.value.owner))} · <span class="mono">${esc(abbr(repo.value.owner))}</span></span></header>
<div class="bench">
  <aside class="side">
    <div class="panel"><h2>Branches</h2><ul id="branches"></ul><div id="branch-form-box"></div></div>
    <div class="panel"><h2>Pull requests</h2><ul id="prs" class="prs"></ul><div id="pr-form-box"></div></div>
    <div class="panel" id="collabs-panel"><h2>Collaborators</h2><ul id="collabs" class="collabs"></ul><div id="collab-form-box"></div></div>
  </aside>
  <section class="work">
    <div id="work-head" class="work-head"></div>
    <div id="merge-banner" class="merge-banner hidden"></div>
    <textarea id="editor" class="editor" spellcheck="false" aria-label="Working copy"></textarea>
    <form id="commit-form" class="commit-form"><input type="text" name="message" id="message" maxlength="120" autocomplete="off" placeholder="Commit message" required><button type="submit" class="primary" id="commit-btn">Commit</button><span class="hint" id="commit-hint"></span></form>
    <div class="preview-head">running: <span class="what" id="preview-what">—</span></div>
    <iframe id="preview" class="preview" sandbox="allow-scripts" title="The running project"></iframe>
  </section>
  <aside class="timeline">
    <div class="panel"><h2>Timeline</h2><div class="graph"><svg id="graph" aria-hidden="true"></svg><ol id="commits"></ol></div></div>
    <div class="panel commit-panel" id="commit-panel"></div>
  </aside>
</div></section>`

const renderBranches = (repo, branches, branch, commits, fromId) => {
  const counts = new Map()
  for (const c of commits) counts.set(c.value.branch, (counts.get(c.value.branch) ?? 0) + 1)
  $("branches").innerHTML = branches.map((b) => `<li class="${b.id === branch?.id ? "sel" : ""}" data-branch="${esc(b.id)}"><a href="#/r/${esc(repo.id)}/${esc(b.id)}">${esc(branchLabel(repo, b))}</a>${canWriteBranch(b) && !eqAddr(b.value.owner, me) ? `<span class="who" title="you were granted write">write</span>` : ""}<span class="n" title="head">${esc(short(b.value.head))} · ${counts.get(b.id) ?? 0}</span></li>`).join("") || `<li class="dim">no branches</li>`
  $("branch-form-box").innerHTML = me && fromId
    ? `<form id="branch-form" class="row"><input type="text" name="name" placeholder="new branch" pattern="[A-Za-z0-9._-]{1,40}" required autocomplete="off"><button type="submit" class="small">Branch from ${esc(short(fromId))}</button></form>`
    : ""
}

const renderPRs = (repo, branches, branch, prs) => {
  $("prs").innerHTML = prs.map((pr) => {
    const from = nodes.get(pr.value.from), into = nodes.get(pr.value.into), st = prStatus(pr)
    const open = st.startsWith("open")
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
  const mine = !!branch && eqAddr(branch?.value.owner, me)
  const entries = Object.entries(branch?.value.collaborators ?? {})
  $("collabs-panel").querySelector("h2").textContent = branch ? `Collaborators on ${branchLabel(repo, branch)}` : "Collaborators"
  $("collabs").innerHTML = entries.map(([addr, level]) => `<li><span class="addr" title="${esc(addr)}">${esc(nameOf(addr))}</span><span class="n">${esc(level)}</span>${mine ? `<button class="small" data-act="revoke" data-address="${esc(addr)}">Revoke</button>` : ""}</li>`).join("") || `<li class="dim">${mine ? "nobody else can move this head" : "only its owner"}</li>`
  $("collab-form-box").innerHTML = mine ? `<form id="collab-form" class="row"><input type="text" name="address" class="mono" placeholder="0x… address" pattern="0x[0-9a-fA-F]{40}" required autocomplete="off"><button type="submit" class="small">Grant write</button></form>` : ""
}

const editorDirty = (branch) => { const d = getDraft(branch.id); return d !== null && d !== contentOf(branch.value.head) }
const renderWorkHead = (repo, branch) => {
  if (!branch) { $("work-head").innerHTML = `<span class="dim">no branch</span>`; return }
  const dirty = editorDirty(branch), writable = canWriteBranch(branch), merging = pendingMerge.get(branch.id)
  $("work-head").innerHTML = `<span class="branch">${esc(branchLabel(repo, branch))}</span><span class="head">@ ${esc(short(branch.value.head))}</span>${dirty ? `<span class="dirty">· uncommitted changes</span>` : ""}<span class="tools"><button class="small" data-act="run">Run</button><button class="small" data-act="discard"${dirty ? "" : " disabled"}>Discard</button></span>`
  $("commit-btn").textContent = !me ? "Sign in to commit" : merging ? `Commit merge to ${branchLabel(repo, branch)}` : writable ? `Commit to ${branchLabel(repo, branch)}` : "Fork and commit"
  $("commit-btn").disabled = !me
  $("commit-hint").textContent = !me ? "" : writable ? "" : `You cannot move ${branchLabel(repo, branch)}: the commit will go to a branch of yours, forked from its head.`
  $("editor").disabled = !me && false
  const banner = $("merge-banner")
  banner.classList.toggle("hidden", !merging)
  if (merging) banner.textContent = `Merging ${short(merging.parents[0])}: resolve the conflict markers (<<<<<<<, =======, >>>>>>>) and commit. The commit will have two parents.`
  if (merging && !$("message").value) $("message").value = merging.message
}

const renderTimeline = (repo, branches, commits, selected) => {
  const ROW = 30, X0 = 10, DX = 12
  const lanes = new Map(branches.map((b, i) => [b.id, i]))
  const index = new Map(commits.map((c, i) => [c.id, i]))
  const x = (c) => X0 + DX * (lanes.get(c.value.branch) ?? 0), y = (i) => i * ROW + ROW / 2
  const width = X0 * 2 + DX * Math.max(1, lanes.size), height = Math.max(ROW, ROW * commits.length)
  const lines = commits.flatMap((c, i) => (c.value.parents ?? []).map((p) => {
    const j = index.get(p); if (j === undefined) return ""
    const x1 = x(c), y1 = y(i), x2 = x(commits[j]), y2 = y(j), ym = (y1 + y2) / 2
    return `<path class="g-line" d="M${x1} ${y1} C${x1} ${ym}, ${x2} ${ym}, ${x2} ${y2}"/>`
  }))
  const dots = commits.map((c, i) => `<circle class="g-dot${tipsAt(branches, c.id).length ? " head" : ""}${c.id === selected ? " sel" : ""}" cx="${x(c)}" cy="${y(i)}" r="4"/>`)
  $("graph").setAttribute("viewBox", `0 0 ${width} ${height}`)
  $("graph").setAttribute("width", width)
  $("graph").setAttribute("height", height)
  $("graph").innerHTML = lines.join("") + dots.join("")
  $("commits").innerHTML = commits.map((c) => {
    const tips = tipsAt(branches, c.id)
    return `<li data-commit="${esc(c.id)}" class="${c.id === selected ? "sel" : ""}${tips.length ? " head" : ""}" title="${esc(c.value.message)} — ${esc(nameOf(c.value.owner))}, ${new Date(c.value.at).toLocaleString()}"><span class="msg">${esc(c.value.message)}</span>${tips.map((b) => `<span class="chip${eqAddr(b.value.owner, me) ? " mine" : ""}">${esc(branchLabel(repo, b))}</span>`).join("")}<span class="meta">${esc(short(c.id))} · ${esc(nameOf(c.value.owner))} · ${ago(c.value.at)}</span></li>`
  }).join("") || `<li class="dim">no commits yet</li>`
}

const renderCommitPanel = (repo, branch, id) => {
  const c = commitOf(id)
  if (!c) { $("commit-panel").innerHTML = `<h2>Commit</h2><p class="dim">Select a commit in the timeline to read its diff and run it.</p>`; return }
  const parent = commitOf(c.value.parents?.[0])
  const rows = diffLines(parent ? parent.value.content.split("\n") : [], c.value.content.split("\n"))
  const added = rows.filter((r) => r.kind === "add").length, removed = rows.filter((r) => r.kind === "del").length
  const LIMIT = 400, shown = rows.slice(0, LIMIT)
  $("commit-panel").innerHTML = `<h2>Commit ${esc(short(c.id))}</h2><h3>${esc(c.value.message)}</h3>
<p class="meta">${esc(nameOf(c.value.owner))} · ${new Date(c.value.at).toLocaleString()} · ${c.value.parents?.length ? `parent${c.value.parents.length > 1 ? "s" : ""} ${c.value.parents.map(short).map(esc).join(", ")}` : "root"} · ${esc(c.id)}</p>
<div class="actions"><button class="small" data-act="run-commit" data-commit="${esc(c.id)}">Run this version</button>${branch ? `<button class="small" data-act="load-commit" data-commit="${esc(c.id)}">Load into the editor</button>` : ""}</div>
<div class="diff-summary">${parent ? `against ${esc(short(parent.id))}: ` : "the whole file: "}<span class="add">+${added}</span> <span class="del">−${removed}</span></div>
<pre class="diff">${shown.map((r) => `<div class="${r.kind}">${r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "} ${esc(r.text)}</div>`).join("")}${rows.length > LIMIT ? `<div class="more">… ${rows.length - LIMIT} more lines</div>` : ""}</pre>`
}

const runPreview = (html, what) => { $("preview").srcdoc = html; $("preview-what").textContent = what }
const loadEditor = (branch) => {
  const ed = $("editor")
  ed.value = getDraft(branch.id) ?? contentOf(branch.value.head)
  $("message").value = pendingMerge.get(branch.id)?.message ?? ""
  runPreview(ed.value, editorDirty(branch) ? "the working copy" : `${short(branch.value.head)}, the head`)
}

// ── Router and render ───────────────────────────────────────────────────────
const route = () => {
  const seg = location.hash.slice(1).split("/").filter(Boolean).map(decodeURIComponent)
  return { page: seg[0] ?? "", repo: seg[1] ?? null, branch: seg[2] ?? null, commit: seg[3] ?? null }
}
let renderQueued = false, dirtyWhileTyping = false, subscribed = false
const scheduleRender = () => { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render() }) }
// Never repaint a form under the reader's caret. The editor and the commit
// message live in the skeleton, which a store change never rebuilds.
const typing = () => document.hasFocus() && $("main").contains(document.activeElement) && !document.activeElement.closest(".work") &&
  document.activeElement.matches("textarea, select, input:not([type=submit]):not([type=button])")

const render = () => {
  if (!subscribed) return
  if (typing()) { dirtyWhileTyping = true; return }
  const r = route(), main = $("main")
  renderNav(r.page)
  renderSession()
  if (r.page === "r" && r.repo) return renderRepo(r, main)
  main.dataset.repo = ""
  const titles = { "": "dCode", new: "New repository · dCode", login: "Sign in · dCode", constitution: "Constitution · dCode" }
  main.innerHTML = { "": reposPage, new: newPage, login: loginPage, constitution: constitutionPage }[r.page]?.() ?? `<div class="page"><p class="muted">No such page.</p></div>`
  document.title = titles[r.page] ?? "dCode"
}
const renderRepo = (r, main) => {
  const repo = nodes.get(r.repo)
  if (!repo) { main.dataset.repo = ""; main.innerHTML = `<div class="page"><p class="muted">No such repository here yet. If it exists in this room, it will appear when it syncs.</p></div>`; return }
  const branches = branchesOf(repo.id), commits = commitsOf(repo.id), prs = prsOf(repo.id)
  const branch = branches.find((b) => b.id === r.branch) ?? defaultBranch(repo, branches)
  const selected = commitOf(r.commit)?.id ?? branch?.value.head ?? null
  if (main.dataset.repo !== repo.id) { main.innerHTML = repoSkeleton(repo); main.dataset.repo = repo.id; main.dataset.branch = ""; main.dataset.head = "" }
  if (branch && main.dataset.branch !== branch.id) { main.dataset.branch = branch.id; main.dataset.head = branch.value.head ?? ""; loadEditor(branch) }
  else if (branch && main.dataset.head !== (branch.value.head ?? "")) {
    // The head moved (a commit here, or one that arrived): a clean working copy follows it.
    main.dataset.head = branch.value.head ?? ""
    if (getDraft(branch.id) === null) loadEditor(branch)
  }
  renderBranches(repo, branches, branch, commits, selected)
  renderPRs(repo, branches, branch, prs)
  renderCollabs(repo, branch)
  renderWorkHead(repo, branch)
  renderTimeline(repo, branches, commits, selected)
  renderCommitPanel(repo, branch, selected)
  document.title = `${repo.value.name}${branch ? ` · ${branchLabel(repo, branch)}` : ""} · dCode`
}
const renderNav = (page) => {
  const items = [["", "repositories"], ["new", "new"], ["constitution", "constitution"]]
  $("nav").innerHTML = items.map(([p, label]) => `<a href="#/${p}" data-nav="${p}"${page === p ? ' class="sel"' : ""}>${label}</a>`).join("")
}
const renderSession = () => {
  $("session").innerHTML = me ? `<span class="who" title="${esc(me)}">${esc(nameOf(me))}</span> · <a href="#" id="logout">sign out</a>` : `<a href="#/login">sign in</a>`
}

// ── Events ──────────────────────────────────────────────────────────────────
const currentBranch = () => { const r = route(); const repo = nodes.get(r.repo); if (!repo) return null; const branches = branchesOf(repo.id); return branches.find((b) => b.id === r.branch) ?? defaultBranch(repo, branches) }

document.addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-commit]")
  if (li) { const r = route(); location.hash = `#/r/${r.repo}/${$("main").dataset.branch}/${li.dataset.commit}`; return }
  const a = e.target.closest("a, button"); if (!a) return
  const act = a.dataset.act
  try {
    if (act === "run") { const b = currentBranch(); if (b) runPreview($("editor").value, editorDirty(b) ? "the working copy" : `${short(b.value.head)}, the head`); return }
    if (act === "discard") { const b = currentBranch(); if (!b) return; clearDraft(b.id); pendingMerge.delete(b.id); loadEditor(b); return scheduleRender() }
    if (act === "run-commit") { const c = commitOf(a.dataset.commit); if (c) runPreview(c.value.content, `${short(c.id)} — ${c.value.message}`); return }
    if (act === "load-commit") {
      const b = currentBranch(), c = commitOf(a.dataset.commit); if (!b || !c) return
      $("editor").value = c.value.content; setDraft(b.id, c.value.content); notice(`${short(c.id)} is now the working copy of ${branchLabel(nodes.get(b.value.repo), b)}. Commit it to make it the head again.`); return scheduleRender()
    }
    if (act === "merge") { e.preventDefault(); const pr = nodes.get(a.dataset.pr); if (pr) await mergePR(pr); return }
    if (act === "update-pr") { const pr = nodes.get(a.dataset.pr), from = nodes.get(pr?.value.from); if (pr && from) await patch(pr.id, { commit: from.value.head }); return }
    if (act === "withdraw") { const pr = nodes.get(a.dataset.pr); if (pr) await patch(pr.id, { closed: true }); return }
    if (act === "revoke") { const b = currentBranch(); if (b) { await db.sm.acls.revoke(b.id, a.dataset.address); notice(`Revoked ${nameOf(a.dataset.address)}.`) } return }
    if (a.id === "logout") { e.preventDefault(); return db.sm.clearSecurity() }
    if (a.classList.contains("demo-login")) {
      e.preventDefault(); const id = DEMO_IDENTITIES.find((i) => eqAddr(i.address, a.dataset.address))
      try { await db.sm.loginOrRecoverUserWithMnemonic(id.mnemonic) } catch { say("login-status", "Could not sign in.") } return
    }
    if (a.id === "generate-btn") { e.preventDefault(); if (!await db.sm.startNewUserRegistration()) say("login-status", "Could not generate an identity."); return }
    if (a.id === "login-btn") {
      e.preventDefault(); const m = $("mnemonic").value.trim(); if (!m) return say("login-status", "Paste a mnemonic phrase first.")
      try { if (!await db.sm.loginOrRecoverUserWithMnemonic(m)) say("login-status", "That mnemonic is not valid.") } catch { say("login-status", "That mnemonic is not valid.") } return
    }
    if (a.id === "passkey-protect-btn") { e.preventDefault(); try { if (!await db.sm.protectCurrentIdentityWithWebAuthn()) say("login-status", "Passkey registration cancelled.") } catch { say("login-status", "Could not register the passkey.") } return }
    if (a.id === "passkey-login-btn") { e.preventDefault(); try { if (!await db.sm.loginCurrentUserWithWebAuthn()) say("login-status", "Passkey sign-in cancelled.") } catch { say("login-status", "Could not sign in with the passkey.") } return }
  } catch (err) { notice(err.message) }
})

document.addEventListener("submit", async (e) => {
  const f = e.target; e.preventDefault()
  const field = (name) => (new FormData(f).get(name) ?? "").toString().trim()
  if (!me) { sessionStorage.dcodeGoto = location.hash; location.hash = "#/login"; return }
  try {
    if (f.id === "new-form") {
      const { repo, branch } = await newRepo(field("name"), field("description"), new FormData(f).get("content").toString())
      location.hash = `#/r/${repo}/${branch}`; return
    }
    const branch = currentBranch(); if (!branch) return
    const repo = nodes.get(branch.value.repo)
    if (f.id === "commit-form") {
      const message = field("message"), content = $("editor").value
      if (!message) return
      if (content === contentOf(branch.value.head) && !pendingMerge.has(branch.id)) return notice("Nothing to commit: the working copy is the head.")
      if (/^(<<<<<<<|=======|>>>>>>>)/m.test(content) && pendingMerge.has(branch.id)) return notice("Conflict markers are still in the file.")
      let target = branch, id
      if (canWriteBranch(branch)) { id = await commitTo(branch, message, content, pendingMerge.get(branch.id)?.parents ?? []); pendingMerge.delete(branch.id) }
      else { const fork = await forkAndCommit(branch, message, content); id = fork.id; target = nodes.get(fork.branch) ?? { id: fork.branch, value: { head: id, repo: repo.id, name: branch.value.name, owner: me } } }
      clearDraft(branch.id)
      f.reset()
      if (target.id !== branch.id) { clearDraft(target.id); location.hash = `#/r/${repo.id}/${target.id}`; notice(`Committed ${short(id)} on your own branch: you cannot move ${branchLabel(repo, branch)}.`) }
      else { notice(`Committed ${short(id)} to ${branchLabel(repo, branch)}.`); runPreview(content, `${short(id)}, the head`); scheduleRender() }
      return
    }
    if (f.id === "branch-form") {
      const head = commitOf(route().commit)?.id ?? branch.value.head
      const id = await create({ type: "branch", repo: repo.id, name: field("name"), head })
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

document.addEventListener("input", (e) => {
  if (e.target.id !== "editor") return
  const b = currentBranch(); if (!b) return
  const text = e.target.value
  if (text === contentOf(b.value.head) && !pendingMerge.has(b.id)) clearDraft(b.id); else setDraft(b.id, text)
  const repo = nodes.get(b.value.repo); if (repo) renderWorkHead(repo, b)
})
document.addEventListener("keydown", (e) => {
  if (e.target.id !== "editor" || e.key !== "Tab") return
  e.preventDefault(); const ta = e.target, s = ta.selectionStart
  ta.setRangeText("  ", s, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input", { bubbles: true }))
})
document.addEventListener("focusout", () => { if (dirtyWhileTyping) { dirtyWhileTyping = false; scheduleRender() } })
addEventListener("hashchange", () => { if (!document.activeElement?.closest(".work")) document.activeElement?.blur(); render() })

// ── Session: the callback is the single source of truth ─────────────────────
db.sm.setSecurityStateChangeCallback((state) => {
  session = state
  me = state.isActive ? state.activeAddress : null
  if (state.isActive && route().page === "login") { location.hash = sessionStorage.dcodeGoto ?? "#/"; sessionStorage.removeItem("dcodeGoto") }
  $("main").dataset.repo = "" // what you may do on the page depends on who you are: rebuild it
  render()
})

// ── The subscription: after everything it may call, for a returning device ──
await db.map({ query: { type: { $in: ["repo", "branch", "commit", "pr"] } } }, ({ id, value, timestamp, action }) => {
  if (action === "removed") nodes.delete(id)
  else nodes.set(id, { id, value, timestamp })
  scheduleRender()
})
subscribed = true

// ── Presence, in the footer, as on every GenosDB page ───────────────────────
const presence = () => { const n = Object.keys(db.room?.getPeers() ?? {}).length; $("presence").textContent = `${n} peer${n === 1 ? "" : "s"}` }
db.room?.on("peer:join", presence); db.room?.on("peer:leave", presence); presence()
render()
