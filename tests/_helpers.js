/**
 * The vocabulary of the suite. A visitor is a BrowserContext of its own — own
 * storage, own identity — never a tab. Every test takes a fresh room, because
 * the graph also lives on the wire. Assertions retry instead of sleeping.
 */
import { expect } from "@playwright/test"

export const RELAY = process.env.DCODE_RELAY
export const BASE = "http://localhost:5805"
export const ADDR = {
  constitution: "0xbfDe0eCEC5332Fd86D2570085571D6051Df098dA",
  alice: "0x3546D4BA0ac3bfDea3F1511F82a078DDdb3F4931",
  bob: "0x8089C0480139d85D82c1E20eeF08a77EF8cD7DEC",
}
export const freshRoom = (label) => `dcode-test-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
export const url = (room, hash = "#/", relay = RELAY) => `${BASE}/?room=${room}${relay ? `&relay=${relay}` : ""}${hash}`
/** A relay nobody listens on: a visitor pointed here is alone in the room. */
export const DEAD_RELAY = "ws://127.0.0.1:1"

/** Record every RTCPeerConnection before any page script runs. */
export const observePeerConnections = (context) => context.addInitScript(() => {
  const Native = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); window.__pcs.push(this) } }
  Object.setPrototypeOf(window.RTCPeerConnection, Native)
})

/** A `candidate-pair` in state `succeeded` proves ICE negotiated a real path; its bytes prove traffic flowed. */
export const transportStats = (page) => page.evaluate(async () => {
  const s = { succeededPairs: 0, bytesReceived: 0 }
  for (const pc of window.__pcs ?? []) {
    let report; try { report = await pc.getStats() } catch { continue }
    report.forEach((r) => { if (r.type === "candidate-pair" && r.state === "succeeded") { s.succeededPairs++; s.bytesReceived += r.bytesReceived ?? 0 } })
  }
  return s
})
export const assertTransport = async (v) => {
  const stats = await transportStats(v.page)
  console.log(`${v.name ?? "visitor"} transport:`, JSON.stringify(stats))
  expect(stats.succeededPairs).toBeGreaterThan(0)
  expect(stats.bytesReceived).toBeGreaterThan(0)
}

const loaded = (page) => page.waitForFunction(() => !document.querySelector("#main").textContent.includes("Opening the graph"), null, { timeout: 60_000, polling: 100 })

/** A visitor: own context, own storage, no identity yet. */
export const visitor = async (browser, room, { relay = RELAY, ...options } = {}) => {
  const context = await browser.newContext(options)
  await observePeerConnections(context)
  const page = await context.newPage()
  page.on("pageerror", (e) => { throw e })
  await page.goto(url(room, "#/", relay))
  await loaded(page)
  return { page, context, room, relay, close: () => context.close() }
}
export const go = async (v, hash) => { await v.page.goto(url(v.room, hash, v.relay)); await loaded(v.page) }
/** The same device comes back on the live relay: its graph is on disk, its session is not. */
export const rejoin = async (v, hash = "#/") => { v.relay = RELAY; await go(v, hash) }

/** One-click demo identity. */
export const loginAs = async (v, name) => {
  await go(v, "#/login")
  await v.page.locator(`.demo-login:has-text("${name}")`).click()
  await expect(v.page.locator("#session")).toContainText(name)
  v.name = name; v.address = ADDR[name]
}
export const connected = (v) => expect(v.page.locator("#presence")).toContainText(/[1-9]\d* peer/)
export const alone = (v) => expect(v.page.locator("#presence")).toHaveText("0 peers")

// ── The repository page ─────────────────────────────────────────────────────
export const rows = (page) => page.locator("#commits li[data-commit]")
export const commitIds = (page) => rows(page).evaluateAll((els) => els.map((el) => el.dataset.commit))
export const branchRows = (page) => page.locator("#branches li[data-branch]")
export const prRows = (page) => page.locator("#prs li[data-pr]")
export const head = (page) => page.locator("#work-head .head")
export const editor = (page) => page.locator("#editor")
export const preview = (page) => page.frameLocator("#preview").locator("body")
export const short = (id) => id.split(":").pop().slice(0, 7)

/** Create a repository through the form; returns its id and its main branch's id from the URL. */
export const createRepo = async (v, name, description = "") => {
  await go(v, "#/new")
  await v.page.locator('#new-form [name="name"]').fill(name)
  await v.page.locator('#new-form [name="description"]').fill(description)
  await v.page.locator('#new-form button[type="submit"]').click()
  await expect(v.page).toHaveURL(/#\/r\//)
  await expect(rows(v.page)).toHaveCount(1)
  const [repo, branch] = decodeURIComponent(v.page.url().split("#/r/")[1]).split("/")
  return { repo, branch }
}
/** Edit the working copy and commit it; resolves with the new head's short id from the notice. */
export const commit = async (v, message, transform) => {
  const ed = editor(v.page)
  await ed.fill(transform(await ed.inputValue()))
  await v.page.locator("#message").fill(message)
  await v.page.locator("#commit-btn").click()
  await expect(v.page.locator("#notice")).toContainText(/Committed ([0-9a-f]{7})/)
  return (await v.page.locator("#notice").textContent()).match(/Committed ([0-9a-f]{7})/)[1]
}

/**
 * The graph file in OPFS holds the text: the write outlived its debounce and
 * survives a reload. The file is MessagePack behind zlib deflate; a read that
 * catches the worker mid-write fails to inflate and the poll simply retries.
 */
export const persisted = (v, text) => expect.poll(() => v.page.evaluate(async ([name, text]) => {
  const root = await navigator.storage.getDirectory()
  const file = await root.getFileHandle(name).then((h) => h.getFile()).catch(() => null)
  if (!file) return false
  const bytes = await new Response(file.stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer().catch(() => null)
  return !!bytes && new TextDecoder("latin1").decode(bytes).includes(text)
}, [`${v.room}_graph.msgpack`, text]), { timeout: 30_000 }).toBe(true)
