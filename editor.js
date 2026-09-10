// The block editor, for code: one node per line, ordered by fractional keys,
// edited live by everyone on the branch with named carets. Everything that
// happens inside the buffer is here — a line's node, the debounced save, the
// merge painted under the caret when a value lands on the line being typed in,
// Enter and Backspace as node operations, whole-line selection, the syntax
// colours, the HTML · CSS · JS views over the one file, and the ephemeral
// channel that carries the carets and the keystrokes.
//
// It arrives with the repository view, which mounts it. The direction is the
// same rule as everywhere: it speaks the application's vocabulary and imports
// it from `app.js`, and it knows nothing of the page around it — what a change
// means out there is a function whoever mounts it hands over.
import {
  $, esc, me, db, nodes, route,            // the words the whole app uses
  putLine, keysBetween, keyBetween, linesOf, // a line is a node: this is how one is written
  keyRings, seal, unseal,                  // a private repository's lines travel sealed, keystrokes included
  wire, hueOf,                             // the room's ephemeral channel, and a peer's colour: both are the shell's
  plural,                                  // how it reads
} from "@app"
import { lcs } from "@text"

// What a change to the buffer means to the page around it — the dirty flag,
// the commit button — is not the editor's business: whoever mounts it says so.
let bufferChanged = () => {}
export const onBufferChange = (fn) => { bufferChanged = fn }

// ── The buffer: the block editor, for code ──────────────────────────────────
// One node per line `{ text, order }`, keyed fractionally, edited by everyone
// on the branch. Line-level LWW: two people on different lines never collide;
// two on the SAME line keep both edits when they touch different places (the
// engine's rescue, painted under the caret by updateLine). Enter splits a line into two
// nodes, Backspace at its start merges it back, Alt+↑/↓ moves it with a new
// key, a multi-line paste mints its keys in one batch. Live typing and the
// carets ride one ephemeral channel; the debounced put is the truth.
let current = null // { repo, branch } of the mounted buffer
export const unmountBuffer = () => { current = null } // no branch on screen: nothing here saves, and the autorun has nothing to follow
export const buffer = () => $("buffer")
export const orderOf = (li) => parseFloat(li.dataset.order)
const isLine = (el) => !!el?.classList?.contains("line")
const shown = (el) => isLine(el) && el.offsetParent !== null // a neighbour the current view shows: the caret never hops into a hidden line
export const fieldOf = (li) => li?.querySelector("textarea")
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
const readOnlyView = () => !!buffer()?.dataset.readonly // a commit is on screen: these lines are not nodes, so nothing may write
export const domText = () => [...buffer().children].map((li) => fieldOf(li).value).join("\n")
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
export const flushSaves = () => Promise.all([...savers.keys()].map((id) => { clearTimeout(savers.get(id)); const li = $(id); return li ? saveNow(id, li) : savers.delete(id) }))

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
    if (readOnlyView()) return
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
    if (readOnlyView()) return
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
  // pending is flushed first: your own keystrokes never revert. The truth is
  // read from the store, not from the graph: a sealed line carries `ct` and no
  // `text` at all, and a raw read would hand this field the word "undefined".
  ta.addEventListener("blur", async () => {
    if (savers.has(id)) { clearTimeout(savers.get(id)); await saveNow(id, li); return }
    const text = nodes.get(id)?.value.text
    if (text !== undefined && ta.value !== text) { ta.value = text; afterChange() }
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
/** A line node as the store hands it over: the buffer follows it while its branch is the one on screen. */
export const dispatchLine = (id, value, action, branch) => {
  if (!current || branch !== current.branch || !buffer()) return
  if (action === "removed") { const li = $(id); if (li) dropLine(li) }
  else if ($(id)) updateLine(id, value); else createLine(id, value)
}
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
/**
 * A commit, shown in the editor as a branch is shown: one line per line, the
 * same HTML/CSS/JS views, the same colouring — and nothing editable, because
 * these lines are not nodes. Selecting another commit, or the branch itself,
 * replaces it; the shared buffer is untouched throughout.
 */
export function mountVersion(repo, text) {
  current = null // no branch is mounted: nothing here saves, and the autorun has nothing to follow
  buffer().replaceChildren()
  buffer().dataset.readonly = "1"
  text.split("\n").forEach((line, i) => createLine(`v${i}`, { repo, branch: "", text: line, order: i + 1 }))
  for (const ta of buffer().querySelectorAll("textarea")) { ta.readOnly = true; ta.tabIndex = -1 }
  relayout()
}
/** A repository's lines opened just now: if its buffer is the one on screen, mount it again. */
export const remount = (repoId) => { if (current?.repo === repoId) mountBuffer(current.repo, current.branch) }
export function mountBuffer(repo, branch) {
  delete buffer().dataset.readonly
  current = { repo, branch }
  buffer().replaceChildren()
  for (const n of linesOf(branch)) if (n.value.text !== undefined) createLine(n.id, n.value) // a sealed line waits for its key
  relayout()
  runPreview(domText(), "the buffer")
  afterChange()
}
// A change to the buffer, local or remote: the dirty flag and the running
// page follow, a moment after the last keystroke.
let changeTimer = null, previewTimer = null
export let lastRun = null // the html the frame is running: what the commit panel compares against before it replaces one version with another
export function afterChange() {
  clearTimeout(changeTimer); changeTimer = setTimeout(bufferChanged, 120)
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => { if ($("autorun")?.checked && current && !route().commit) { const text = domText(); if (text !== lastRun) runPreview(text, "the buffer") } }, 600) // not while a version from the timeline is on screen: that one was asked for
}
export const runPreview = (html, what) => { lastRun = html; $("preview").srcdoc = html; $("preview-what").textContent = what }

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
  if (readOnlyView()) return
  if (allSelected) { e.preventDefault(); e.clipboardData.setData("text/plain", domText()); setAllSelected(false); applyText(current.branch, ""); return }
  if (range) { e.preventDefault(); e.clipboardData.setData("text/plain", rangeText()); deleteRange() }
})
document.addEventListener("paste", (e) => {
  if (readOnlyView()) return
  const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r/g, "")
  if (allSelected) { e.preventDefault(); setAllSelected(false); applyText(current.branch, text); return }
  if (range) { e.preventDefault(); replaceRange(rangeLines(), text) }
})
document.addEventListener("keydown", (e) => {
  if (!allSelected || readOnlyView()) return
  if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); setAllSelected(false); applyText(current.branch, "") }
  else if (e.key === "Escape") setAllSelected(false)
  else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) setAllSelected(false)
})

// ── Awareness + live typing: the room's ONE ephemeral channel, two kinds ────
// Channel traffic never touches the database. 'caret' carries where you are;
// 'text' carries the line you are typing, keystroke by keystroke, so the room
// sees each character the moment it lands — the debounced put remains the
// truth that persists and repairs. The channel is the shell's, and so is the
// colour: the dot beside a repository's name is this caret, in the code.
const peerAt = new Map() // peerId -> { block, start, end }
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
      seal(li.dataset.repo, text).then((ct) => wire.send({ ...rest, ct }))
      return
    }
    wire.send(msg)
  })
}
document.addEventListener("selectionchange", announce)
wire.on("message", async (msg, fromPeerId) => {
  if (msg.kind === "where") return // which repository a window has open is the shell's business
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
  if (lastSent && leftBursts < 2) { leftBursts++; wire.send({ kind: "caret", block: null }) }
}, 2000)
// The views are filters over the one file: CSS shows the lines inside <style>,
// JS the lines inside <script>, HTML everything — the same nodes, the file's
// own line numbers, edited and synced the same way.
export const showView = (name) => {
  sessionStorage.dcodeView = name
  if (buffer()) buffer().dataset.view = name
  document.querySelectorAll(".views button").forEach((b) => b.classList.toggle("sel", b.dataset.view === name))
  if (buffer()) relayout()
}

// A click that is not on a line still belongs to the editor: the views bar
// filters the file, an empty buffer starts its first line, and the space under
// the last line is the editor too — the caret goes to the end of it.
document.addEventListener("click", async (e) => {
  const pick = e.target.closest("button[data-view]") // the bar's button, never the buffer, which carries the view it is showing
  if (pick) return showView(pick.dataset.view)
  if (e.target === buffer() && !buffer().children.length && me && current && !readOnlyView()) return insertAfter(null) // not before its branch is here
  if (e.target === buffer() || e.target.classList?.contains("edit-panel")) {
    const last = [...buffer()?.children ?? []].filter(shown).at(-1); if (last) caretTo(last, fieldOf(last).value.length)
  }
})
// The room, as the carets need it: a late joiner learns where this one is, and
// one that leaves takes its mark with it. The peer count is the shell's.
db.room?.on("peer:join", (peerId) => { if (lastSent?.block) wire.send(lastSent, peerId) })
db.room?.on("peer:leave", (peerId) => { peerAt.delete(peerId); renderMarks() })
