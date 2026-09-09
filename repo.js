// The repository view: everything that only exists once a repository is open —
// the page's skeleton, the bar over it, the four panels of the dock (the
// running page, the timeline, the pull requests, the branches), the dividers
// between them, and the two writes that history needs: bringing a branch's
// buffer to a text, and merging a proposal.
//
// It is brought in by the router the first time a repository is on screen, so
// the index and the identity page never carry it. The direction of the
// dependency is the rule: a view speaks the application's own vocabulary and
// imports it from `app.js`; `app.js` never imports a view — it asks for one.
import {
  $, esc, eqAddr, me, db, toast,                                                    // the words the whole app uses
  nodes, branchesOf, commitsOf, prsOf, linesOf, commitOf, contentOf,                // the store, read
  defaultBranch, canWriteBranch, prStatus, tipsAt, isAncestor, mergeBase, at,       // what the graph says
  abbr, ago, plural, nameOf, short, branchLabel,                                    // how it reads
  patch, commitTo, putLine, keysBetween,                                            // what it writes
  buffer, fieldOf, domText, mountBuffer, mountVersion, unmountBuffer, runPreview, lastRun, pendingMerge, // the editor beside it
  keyRings, unlock, unlocking,                                                      // a private repository's key
  showTab, showView, currentBranch, render,                                         // the shell
} from "@app"
import { lcs, diffLines, merge3 } from "@text"

const lockedPage = (repo, opening) => `<div class="page locked"><h1>${esc(repo.value.name)} <span class="lock">private</span></h1><p class="lede">${esc(repo.value.description)}</p>
<p class="lede">${opening ? "Opening the vault…" : me ? `This repository is private: its code is sealed with a key only its members hold, and ${esc(nameOf(repo.value.owner))} has not granted this identity one. Ask for access — a grant reaches this page on its own.` : `This repository is private: its code is sealed with a key only its members hold. <a href="#/login">Sign in</a> — if you are a member, it opens.`}</p></div>`
// The repository page: a skeleton built once per repository. The buffer and
// the running page are never rebuilt under you; the bar and the dock's
// regions are redrawn from the store.
const repoSkeleton = (repo) => `<section class="repo">
<div class="repo-bar">
  <a class="repo-name" id="repo-name" href="#/r/${esc(repo.id)}" title="${esc(repo.value.description)}">${esc(repo.value.name)}</a><span id="repo-lock" class="lock hidden" title="Private: the code is sealed for its members">private</span>
  <button type="button" class="small hidden" id="edit-repo" data-act="edit-repo" title="Rename or describe the repository — a write on a node you own">Edit</button>
  <select id="branch-select" aria-label="Branch"></select><span class="whose hidden" id="branch-owner"></span>
  <span class="head" id="head-label"></span><span class="dirty hidden" id="dirty">· uncommitted changes</span>
  <form id="commit-form" class="commit-form"><input type="text" name="message" id="message" maxlength="120" autocomplete="off" placeholder="Commit message" required><button type="submit" class="primary" id="commit-btn">Commit</button></form>
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
      <div class="tab" id="tab-history"><div class="graph"><svg id="graph" aria-hidden="true"></svg><ol id="commits"></ol></div><div id="history-splitter" class="splitter row" role="separator" aria-orientation="horizontal" aria-label="Resize the timeline" tabindex="0"></div><div id="commit-panel" class="commit-panel"></div></div>
      <div class="tab" id="tab-pulls"><ul id="prs" class="prs"></ul><div id="pr-form-box"></div></div>
      <div class="tab" id="tab-branches"><ul id="branches"></ul><div id="branch-form-box"></div><h2 id="collabs-title">Collaborators</h2><ul id="collabs" class="collabs"></ul><div id="collab-form-box"></div><h2 id="members-title" class="hidden">Members</h2><ul id="members" class="members hidden"></ul><div id="member-form-box"></div></div>
    </div>
  </section>
</div></section>`

const renderBranches = (repo, branches, branch, commits, fromId) => {
  const counts = new Map()
  for (const c of commits) counts.set(c.value.branch, (counts.get(c.value.branch) ?? 0) + 1)
  $("branches").innerHTML = branches.map((b) => `<li class="${b.id === branch?.id ? "sel" : ""}" data-branch="${esc(b.id)}"><a href="${esc(at(repo.id, b.id))}">${esc(branchLabel(repo, b))}</a>${canWriteBranch(b) && !eqAddr(b.value.owner, me) ? `<span class="who" title="you were granted write">write</span>` : ""}<span class="n" title="head · commits">${esc(short(b.value.head))} · ${counts.get(b.id) ?? 0}</span>${eqAddr(b.value.owner, me) && b.id !== defaultBranch(repo, branches)?.id ? `<button class="small ghost" data-act="delete-branch" data-branch="${esc(b.id)}" title="Delete this branch: its buffer goes, its commits stay">Delete</button>` : ""}</li>`).join("") || `<li class="dim">no branches</li>`
  $("branch-form-box").innerHTML = me && fromId ? `<form id="branch-form" class="row"><input type="text" name="name" placeholder="new branch" pattern="[A-Za-z0-9._\\-]{1,40}" required autocomplete="off"><button type="submit" class="small">Branch from ${esc(short(fromId))}</button></form>` : ""
  const select = $("branch-select")
  if (document.activeElement === select) return // open, or being chosen from: repainting it under the pointer closes it and loses the choice
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
// The members of a private repository are the envelopes on its vault, and reading
// them is a round trip. It happens when the vault changes, not on every render —
// a commit arriving from another peer must not cost an ACL read.
let membersRead = null // { vault, perms }
export const forgetMembers = () => { membersRead = null }
export const renderMembers = async (repo) => {
  const list = $("members"); if (!list) return
  const vault = repo.value.vault
  $("members-title").classList.toggle("hidden", !vault); list.classList.toggle("hidden", !vault)
  if (!vault) { $("member-form-box").innerHTML = ""; return }
  if (membersRead?.vault !== vault) membersRead = { vault, perms: await db.sm.acls.getPermissions(vault).catch(() => null) }
  const perms = membersRead.perms
  if (!$("members") || $("main").dataset.repo !== repo.id) return // navigated away while reading
  const mine = eqAddr(repo.value.owner, me)
  const rows = [[perms?.owner ?? repo.value.owner, "owner"], ...Object.keys(perms?.collaborators ?? {}).map((a) => [a, "read"])]
  $("members").innerHTML = rows.map(([addr, level]) => `<li data-member="${esc(addr)}"><span class="addr" title="${esc(addr)}">${esc(nameOf(addr))}</span><span class="n">${esc(level)}</span>${mine && level !== "owner" ? `<button class="small" data-act="revoke-member" data-address="${esc(addr)}">Revoke</button>` : ""}</li>`).join("")
  if ($("member-form-box").contains(document.activeElement)) return // an address is being typed in: leave the form alone
  $("member-form-box").innerHTML = mine ? `<form id="member-form" class="row"><input type="text" name="address" class="mono" placeholder="0x… address — must have signed in once" pattern="0x[0-9a-fA-F]{40}" required autocomplete="off"><button type="submit" class="small">Grant read</button></form><p class="dim">A member holds a key envelope on the repository's vault. Revoking one turns the key: what is written afterwards stays unreadable to them.</p>` : ""
}
export function renderRepoBar() {
  const branch = currentBranch(); if (!branch || !$("head-label")) return
  const viewing = $("main").dataset.viewing // a version is on screen: what the bar says of the buffer does not hold
  const repo = nodes.get(branch.value.repo), dirty = !viewing && domText() !== contentOf(branch.value.head), writable = canWriteBranch(branch), merging = pendingMerge.get(branch.id)
  $("repo-name").textContent = repo.value.name; $("repo-name").title = repo.value.description
  $("repo-lock").classList.toggle("hidden", !repo.value.vault)
  $("edit-repo").classList.toggle("hidden", !eqAddr(repo.value.owner, me))
  $("head-label").textContent = viewing ? `@ ${short(viewing)}` : `@ ${short(branch.value.head)}`
  $("dirty").textContent = viewing ? "· read-only" : "· uncommitted changes"
  $("dirty").title = viewing ? "A version from the timeline. Click its row again to come back to the buffer." : ""
  $("dirty").classList.toggle("hidden", !dirty && !viewing)
  $("discard").disabled = !dirty
  $("commit-btn").textContent = viewing ? "Reading a version" : !me ? "Sign in to commit" : merging ? `Commit merge to ${branchLabel(repo, branch)}` : writable ? `Commit to ${branchLabel(repo, branch)}` : "Fork and commit"
  $("commit-btn").disabled = !me || !!viewing
  // Why the button says what it says belongs to the button. The line below the
  // bar is for what you can act on, and appears only then.
  $("commit-btn").title = !me || writable || viewing ? "" : `Everyone edits this buffer; only ${nameOf(branch.value.owner)} moves ${branchLabel(repo, branch)}. Your commit will go to a branch of yours, forked from here.`
  // Beside the branch it is about: whose head it is, said where you read which branch you are on.
  $("branch-owner").textContent = `· only ${nameOf(branch.value.owner)} moves it`
  $("branch-owner").title = $("commit-btn").title
  $("branch-owner").classList.toggle("hidden", !me || writable || !!viewing)

  const banner = $("merge-banner")
  banner.classList.toggle("hidden", !merging)
  if (merging) banner.textContent = `Merging ${short(merging.parents[0])}: resolve the conflict markers (<<<<<<<, =======, >>>>>>>) and commit. The commit will have two parents.`
  if (merging && !$("message").value) $("message").value = merging.message
}
const renderTimeline = (repo, branches, commits, selected, standing) => {
  // The lanes are the branches, one colour each, and a lane is drawn as one
  // stroke from its first commit to its last — a fork leaves that stroke and a
  // merge rejoins it, which is the shape that makes the topology readable.
  const ROW = 30, X0 = 13, DX = 16, LANES = 5
  const lanes = new Map(branches.map((b, i) => [b.id, i])), index = new Map(commits.map((c, i) => [c.id, i]))
  const lane = (c) => lanes.get(c.value.branch) ?? 0
  const x = (c) => X0 + DX * (lane(c) % LANES), y = (i) => i * ROW + ROW / 2
  const width = X0 * 2 + DX * Math.min(Math.max(1, lanes.size), LANES), height = Math.max(ROW, ROW * commits.length)
  // The spine of each lane: from its newest commit to its oldest, uninterrupted.
  const spans = [...new Set(commits.map(lane))].map((l) => {
    const rows = commits.map((c, i) => (lane(c) === l ? i : -1)).filter((i) => i >= 0)
    if (rows.length < 2) return ""
    const cx = X0 + DX * (l % LANES)
    return `<path class="g-line" style="stroke: var(--lane-${l % LANES})" d="M${cx} ${y(rows[0])} L${cx} ${y(rows.at(-1))}"/>`
  })
  // A parent in another lane: straight down its own lane, one rounded elbow, and
  // straight across to the parent — a fork and a merge read as right angles, not
  // as a swerve, which is what makes two lanes beside each other legible.
  const R = 7
  const links = commits.flatMap((c, i) => (c.value.parents ?? []).map((p) => {
    const j = index.get(p); if (j === undefined || lane(commits[j]) === lane(c)) return ""
    const x1 = x(c), y1 = y(i), x2 = x(commits[j]), y2 = y(j), dir = x2 > x1 ? 1 : -1
    const d = Math.abs(y2 - y1) > R
      ? `M${x1} ${y1} V${y2 - R} Q${x1} ${y2} ${x1 + dir * R} ${y2} H${x2}`
      : `M${x1} ${y1} H${x2}`
    return `<path class="g-line" style="stroke: var(--lane-${lane(c) % LANES})" d="${d}"/>`
  }))
  const dots = commits.map((c, i) => {
    const cls = `g-dot${tipsAt(branches, c.id).length ? " head" : ""}${c.id === selected ? " sel" : ""}`
    const colour = `var(--lane-${lane(c) % LANES})`
    return `<circle class="${cls}" style="stroke: ${colour}${tipsAt(branches, c.id).length ? `; fill: ${colour}` : ""}" cx="${x(c)}" cy="${y(i)}" r="4.5"/>`
  })
  const lines = [...spans, ...links]
  const g = $("graph")
  g.setAttribute("viewBox", `0 0 ${width} ${height}`); g.setAttribute("width", width); g.setAttribute("height", height)
  g.innerHTML = lines.join("") + dots.join("")
  $("commits").innerHTML = commits.map((c) => {
    const tips = tipsAt(branches, c.id)
    const here = standing && c.id === standing.value.head // the head of the branch you stand on: this is your checkout
    return `<li data-commit="${esc(c.id)}" class="${c.id === selected ? "sel" : ""}${tips.length ? " head" : ""}${here ? " here" : ""}" title="${esc(c.value.message)} — ${esc(nameOf(c.value.owner))}, ${new Date(c.value.at).toLocaleString()}"><span class="tick" aria-label="${here ? "Your checkout" : ""}">${here ? "✓" : ""}</span><span class="msg">${esc(c.value.message)}</span>${tips.map((b) => `<span class="chip" style="--chip: var(--lane-${branches.findIndex((x) => x.id === b.id) % 5})">${esc(branchLabel(repo, b))}</span>`).join("")}<span class="meta"><span class="h">${esc(short(c.id))}</span><span class="who">${esc(nameOf(c.value.owner))}</span><span class="when">${ago(c.value.at)}</span></span></li>`
  }).join("") || `<li class="dim">no commits yet</li>`
}
const renderCommitPanel = (repo, branch, id) => {
  const c = commitOf(id)
  if (!c) { $("commit-panel").innerHTML = `<p class="dim">Select a commit to read its diff, and to run it.</p>`; return }
  // Selecting a version runs it: reading history writes nothing and asks nobody.
  // The buffer comes back the moment the selection is dropped.
  const content = contentOf(c.id)
  if (lastRun !== content) runPreview(content, `${short(c.id)} — ${c.value.message}`)
  const parent = commitOf(c.value.parents?.[0])
  const rows = diffLines(parent ? contentOf(parent.id).split("\n") : [], content.split("\n"))
  const added = rows.filter((r) => r.kind === "add").length, removed = rows.filter((r) => r.kind === "del").length
  const LIMIT = 400, shown = rows.slice(0, LIMIT)
  $("commit-panel").innerHTML = `<h3>${esc(short(c.id))} · ${esc(c.value.message)}</h3>
<p class="meta">${esc(nameOf(c.value.owner))} · ${new Date(c.value.at).toLocaleString()} · ${c.value.parents?.length ? `parent${c.value.parents.length > 1 ? "s" : ""} ${c.value.parents.map(short).map(esc).join(", ")}` : "root"} · <span title="${esc(c.id)}">${esc(abbr(c.value.owner))}:${esc(short(c.id))}…</span></p>
<div class="actions">${branch && me ? `<button class="small" data-act="load-commit" data-commit="${esc(c.id)}" title="Bring this version into the branch's buffer — the shared one, so everyone editing ${esc(branchLabel(repo, branch))} sees it. Commit it to make it the head again.">Checkout</button>` : ""}<button class="small" data-act="download-commit" data-commit="${esc(c.id)}">Download this version</button></div>
<div class="diff-summary">${parent ? `against ${esc(short(parent.id))}: ` : "the whole file: "}<span class="add">+${added}</span> <span class="del">−${removed}</span></div>
<pre class="diff">${shown.map((r) => `<div class="${r.kind}">${r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "} ${esc(r.text)}</div>`).join("")}${rows.length > LIMIT ? `<div class="more">… ${rows.length - LIMIT} more lines</div>` : ""}</pre>`
}

/**
 * Bring a branch's buffer to `text` with the fewest writes: lines both have
 * stay (their ids, their carets); a replaced line is rewritten in place;
 * the rest are inserted between their neighbours or removed.
 */
export const applyText = async (branchId, text) => {
  const repo = nodes.get(branchId)?.value.repo
  const cur = linesOf(branchId).map((n) => { const ta = fieldOf($(n.id)); return ta ? { ...n, value: { ...n.value, text: ta.value } } : n }) // a mounted line reads as the buffer shows it: a save flushed a moment ago has not reached the store yet
  const A = cur.map((n) => n.value.text), B = text.split("\n")
  const ops = []
  let i = 0, j = 0
  for (const [pi, pj] of [...lcs(A, B), [A.length, B.length]]) {
    const gone = cur.slice(i, pi), fresh = B.slice(j, pj), reuse = Math.min(gone.length, fresh.length)
    for (let k = 0; k < reuse; k++) if (gone[k].value.text !== fresh[k]) ops.push(putLine(repo, branchId, fresh[k], gone[k].value.order, gone[k].id)) // through putLine: a private repository's line is sealed, never spread from the store, where its text is already open
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
export const mergePR = async (pr) => {
  const repo = nodes.get(pr.value.repo), into = nodes.get(pr.value.into), from = nodes.get(pr.value.from), theirs = commitOf(pr.value.commit)
  if (!repo || !into || !from || !theirs) return toast("The pull request's branch or commit has not synced here yet.", "error")
  if (!canWriteBranch(into)) return toast(`Only the owner of ${branchLabel(repo, into)} can merge into it.`, "error")
  const ours = commitOf(into.value.head)
  if (!ours || isAncestor(ours.id, theirs.id)) {
    await patch(into.id, { head: theirs.id })
    await applyText(into.id, theirs.value.content)
    return toast(`Fast-forwarded ${branchLabel(repo, into)} to ${short(theirs.id)}.`, "success")
  }
  const message = `Merge ${branchLabel(repo, from)} into ${branchLabel(repo, into)}`
  const { text, conflicts } = merge3(contentOf(mergeBase(ours.id, theirs.id)), ours.value.content, theirs.value.content)
  if (!conflicts) {
    const id = await commitTo(into, message, text, [theirs.id])
    await applyText(into.id, text)
    return toast(`Merged as ${short(id)}: both sides' changes, no conflicts.`, "success")
  }
  // The conflicts go to the target's shared buffer, marked; the commit made from there is the merge.
  pendingMerge.set(into.id, { parents: [theirs.id], message })
  await applyText(into.id, text)
  location.hash = at(repo.id, into.id)
  render()
  toast(`${plural(conflicts, "conflict")}. Resolve the marked lines in the editor and commit: that commit will be the merge.`, "error")
}
const MIN_DOC = 360, MIN_RIGHT = 320
const MIN_TIMELINE = 90, MIN_DIFF = 140
/** The timeline's height inside History; the diff takes the rest and scrolls on its own. */
const setTimelineHeight = (px, persist = true) => {
  const tab = $("tab-history"); if (!tab) return
  const available = tab.clientHeight, ceiling = available ? Math.max(available - MIN_DIFF, MIN_TIMELINE) : Infinity
  const height = Math.round(Math.min(Math.max(px, MIN_TIMELINE), ceiling))
  tab.style.setProperty("--timeline-height", `${height}px`)
  if (persist) localStorage.dcodeHistorySplit = height
}
const setDocWidth = (px, persist = true) => {
  const bench = $("bench"); if (!bench) return
  const available = bench.clientWidth, ceiling = available ? Math.max(available - MIN_RIGHT, MIN_DOC) : Infinity
  const width = Math.round(Math.min(Math.max(px, MIN_DOC), ceiling))
  bench.style.setProperty("--doc-width", `${width}px`)
  if (persist) localStorage.dcodeSplit = width
}
document.addEventListener("pointerdown", (event) => {
  const splitter = event.target.closest("#splitter, #history-splitter"); if (!splitter) return
  event.preventDefault(); splitter.setPointerCapture(event.pointerId)
  const row = splitter.id === "history-splitter"
  const start = row ? event.clientY : event.clientX
  const from = (row ? $("tab-history").querySelector(".graph") : $("bench").firstElementChild).getBoundingClientRect()[row ? "height" : "width"]
  const onMove = (move) => (row ? setTimelineHeight : setDocWidth)(from + (row ? move.clientY : move.clientX) - start)
  splitter.addEventListener("pointermove", onMove)
  splitter.addEventListener("pointerup", () => splitter.removeEventListener("pointermove", onMove), { once: true })
})
document.addEventListener("keydown", (event) => {
  const row = event.target.id === "history-splitter"
  if (event.target.id !== "splitter" && !row) return
  const step = (row ? { ArrowUp: -16, ArrowDown: 16 } : { ArrowLeft: -16, ArrowRight: 16 })[event.key]; if (!step) return
  event.preventDefault()
  if (row) setTimelineHeight($("tab-history").querySelector(".graph").getBoundingClientRect().height + step)
  else setDocWidth($("bench").firstElementChild.getBoundingClientRect().width + step)
})

export const renderRepo = (r, main) => {
  const repo = nodes.get(r.repo)
  if (!repo) { main.dataset.repo = ""; main.classList.remove("full"); unmountBuffer(); main.innerHTML = `<div class="page"><p class="muted">No such repository here yet. If it exists in this room, it will appear when it syncs.</p></div>`; return }
  if (repo.value.vault && !Array.isArray(keyRings.get(repo.id))) { // private: without the key there is nothing to show but the door
    if (!keyRings.has(repo.id) && me) unlock(repo.id)
    main.dataset.repo = ""; main.classList.remove("full"); unmountBuffer()
    main.innerHTML = lockedPage(repo, unlocking.has(repo.id))
    document.title = `${repo.value.name} · dCode`
    return
  }
  const branches = branchesOf(repo.id), commits = commitsOf(repo.id), prs = prsOf(repo.id)
  const branch = branches.find((b) => b.id === r.branch) ?? defaultBranch(repo, branches)
  const selected = commitOf(r.commit)?.id ?? branch?.value.head ?? null
  if (main.dataset.repo !== repo.id) { main.innerHTML = repoSkeleton(repo); main.dataset.repo = repo.id; main.dataset.branch = ""; main.classList.add("full"); showTab(sessionStorage.dcodeTab ?? "preview"); showView(sessionStorage.dcodeView ?? "html"); if (localStorage.dcodeSplit) setDocWidth(Number(localStorage.dcodeSplit), false); if (localStorage.dcodeHistorySplit) setTimelineHeight(Number(localStorage.dcodeHistorySplit), false) }
  // The editor follows the timeline: a selected commit is shown read-only, and
  // letting go of it brings the branch's buffer back.
  const viewing = r.commit && commitOf(r.commit) ? r.commit : ""
  if (viewing && main.dataset.viewing !== viewing) { main.dataset.viewing = viewing; main.dataset.branch = ""; mountVersion(repo.id, contentOf(viewing)) }
  else if (!viewing && branch && (main.dataset.branch !== branch.id || main.dataset.viewing)) { main.dataset.viewing = ""; main.dataset.branch = branch.id; mountBuffer(repo.id, branch.id) }
  // A repository whose branch has not arrived is not an empty file: say so, rather than showing a blank editor that invites typing into nothing.
  if (!branch && !buffer()?.querySelector(".line")) { main.dataset.branch = ""; buffer().innerHTML = `<p class="waiting">This repository is here, its branch is not. Nothing on this device can open it until a peer that holds the branch is online${me ? "" : " — or sign in and start your own"}.</p>` }
  renderBranches(repo, branches, branch, commits, selected)
  renderPRs(repo, branches, branch, prs)
  renderCollabs(repo, branch)
  renderMembers(repo)
  renderRepoBar()
  renderTimeline(repo, branches, commits, selected, branch)
  renderCommitPanel(repo, branch, selected)
  document.title = `${repo.value.name}${branch ? ` · ${branchLabel(repo, branch)}` : ""} · dCode`
}
