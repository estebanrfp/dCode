// The agent: a coding model that runs in a window of its own, on WebGPU, with
// an identity of its own — one more peer in the room. It takes briefs from
// the prompt box of the other windows, writes the file line by line into the
// shared buffer of a branch it owns, commits under its own signature and
// opens a pull request the owner merges. No server, no key, no request leaves
// the machine: the weights are downloaded once from the model hub and cached
// by the browser. Its mnemonic is minted on this device the first time and
// kept here; it is the identity of "the agent on this computer", nothing more.
//
// Two mounts, one file. On `#/agent` this window is the DESK: it signs in as
// the agent and works. Anywhere else this window shows the BOX: it opens the
// desk when there is none and hands it the brief over the room's ephemeral
// channel, as two kinds of message beside the carets: `agent-brief` from a
// box to the desk, `agent-status` from the desk to every box.
const WEBLLM = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm"
const MODELS = ["Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC"]
const DOCS = "https://cdn.jsdelivr.net/gh/estebanrfp/gdb@main/llms.txt" // GenosDB's own summary for models, fetched fresh so the agent follows the engine
const MNEMONIC = "dcodeAgentMnemonic"
const IMPORT = 'import { gdb } from "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.js"'
/** `?model=<id>` puts a model first: a smaller one for a small GPU, a larger one for a large one. */
const models = () => { const m = new URLSearchParams(location.search).get("model"); return m ? [m, ...MODELS.filter((x) => x !== m)] : MODELS }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app"

/** What the desk page shows; the page is rendered from it. */
export const desk = { state: "off", address: null, model: null, log: [] }

/**
 * Mount the box or the desk, by route. `api` is the application's own
 * vocabulary: the functions the buttons use, handed over so the agent
 * commits like a person — as itself.
 * @param {object} api
 */
export function mountAgent(api) {
  const isDesk = () => location.hash.startsWith("#/agent")
  const form = document.getElementById("agent"), input = document.getElementById("agent-brief"), status = document.getElementById("agent-status")
  const boxSay = (text) => { status.textContent = text; status.hidden = !text }

  // ── The desk ──────────────────────────────────────────────────────────
  let engine = null, prompt = null, busy = false
  const queue = []
  const tell = (text, extra = {}) => { // the log here, the status everywhere
    desk.log.unshift(text); desk.log.length = Math.min(desk.log.length, 12); api.paintDesk()
    api.presence.send({ kind: "agent-status", address: desk.address, text, ...extra })
  }
  const loadPrompt = async () => {
    const [rules, docs] = await Promise.all([fetch("agent-prompt.md").then((r) => r.text()), fetch(DOCS).then((r) => (r.ok ? r.text() : "")).catch(() => "")])
    return docs ? `${rules}\n\n## GenosDB, in its own words\n\n${docs}` : rules
  }
  const loadEngine = async () => {
    if (!(await navigator.gpu?.requestAdapter())) throw new Error("No WebGPU here: the agent needs a GPU and Chrome, Edge or Safari 26.")
    const { CreateMLCEngine } = await import(WEBLLM)
    for (const id of models()) {
      try {
        tell(`Loading ${id.split("-Instruct")[0]}…`)
        const e = await CreateMLCEngine(id, { initProgressCallback: ({ text }) => tell(text.replace(/\[.*?\]\s*/g, "").slice(0, 90)) }, { context_window_size: 8192 })
        desk.model = id.split("-Instruct")[0]; return e
      } catch (err) { console.warn(`${id}: ${err.message}`) } // too large for this GPU: the next one down
    }
    throw new Error("No model fits this GPU.")
  }
  const signIn = async () => {
    // Minted once on this device, then reused: the same agent every time this computer opens a desk.
    let phrase = localStorage.getItem(MNEMONIC)
    if (!phrase) { phrase = (await api.sm.startNewUserRegistration())?.mnemonic; if (!phrase) throw new Error("Could not mint the agent's identity."); localStorage.setItem(MNEMONIC, phrase) } // volatile until signed in with
    await api.sm.loginOrRecoverUserWithMnemonic(phrase)
    for (let i = 0; i < 100 && !api.me(); i++) await new Promise((r) => setTimeout(r, 50)) // the session callback lands a moment later
    if (!api.me()) throw new Error("The agent could not sign in.")
  }
  const run = async ({ repo, into, brief }) => {
    const from = api.node(into); if (!from) throw new Error("The branch to propose into is gone.")
    prompt ??= await loadPrompt()
    engine ??= globalThis.__agentEngine ?? await loadEngine() // the suite plugs a stub in: the flow is what it pins, the model is a part
    desk.model ??= "stub"
    // A branch of its own — owned by the agent, in the owner's repository — from where the owner stood.
    const name = slug(brief), room = name
    const branch = await api.create({ type: "branch", repo, name, head: from.value.head })
    tell(`${desk.model} is writing on ${name}…`, { repo, branch })
    const current = api.contentOf(from.value.head)
    const user = current.trim() && current.length < 6000 ? `${brief}\n\nThe repository currently holds this file; build on it where that makes sense:\n\n${current}` : brief
    // Each completed line is a node the moment it exists: the room watches the file appear.
    // The platform's skeleton is enforced on the way in, whatever the model did with the
    // rules: the script is a module, GenosDB is imported from its CDN, the room is this app's.
    const lines = []; let tail = "", n = 0, imported = false
    const land = async (line) => {
      if (/^```/.test(line)) return
      if (/<script(?![^>]*type=)/.test(line)) line = line.replace("<script", '<script type="module"')
      if (line.includes(IMPORT)) imported = true
      if (/\bgdb\(/.test(line) && !imported) { const pad = line.match(/^\s*/)[0]; lines.push(pad + IMPORT); await api.putLine(repo, branch, pad + IMPORT, ++n); imported = true }
      line = line.replace(/gdb\(\s*["'](my-app-name|room-name|app|my-app|shared-todos)["']/, `gdb("${room}"`)
      lines.push(line); return api.putLine(repo, branch, line, ++n)
    }
    const chunks = await engine.chat.completions.create({ messages: [{ role: "system", content: prompt }, { role: "user", content: user }], stream: true, temperature: 0.2, max_tokens: 6000 })
    for await (const chunk of chunks) {
      tail += chunk.choices[0]?.delta?.content ?? ""
      let cut
      while ((cut = tail.indexOf("\n")) >= 0) { await land(tail.slice(0, cut)); tail = tail.slice(cut + 1) }
    }
    if (tail.trim()) await land(tail)
    const content = lines.join("\n")
    const id = await api.newCommit({ repo, branch, parents: from.value.head ? [from.value.head] : [], message: brief.slice(0, 120), content })
    await api.patch(branch, { head: id })
    await api.create({ type: "pr", repo, from: branch, into, title: brief.slice(0, 120), commit: id })
    tell(`Committed ${api.short(id)} on ${name} and proposed it into ${from.value.name}.`, { repo, branch, done: id })
  }
  const drain = async () => {
    if (busy || !queue.length) return
    busy = true
    try { await run(queue.shift()) } catch (err) { tell(`Could not: ${err.message}`) } finally { busy = false; tell("ready"); drain() }
  }
  // A window that joins later — the box that asked, most of all — learns the desk is here.
  api.room.on("peer:join", (peerId) => { if (isDesk() && desk.state === "ready") announce(peerId) })
  const startDesk = async () => {
    if (desk.state !== "off") return
    desk.state = "signing in"; api.paintDesk()
    try { await signIn(); desk.address = api.me(); api.name(desk.address, "agent"); desk.state = "ready"; tell("ready") }
    catch (err) { desk.state = "off"; tell(err.message) }
  }

  // ── The box ───────────────────────────────────────────────────────────
  // No handle on the desk's window: a window opened with an opener never
  // finds its peers, so the desk is opened with `noopener` and found by
  // asking the room. A brief first calls; a desk that is here answers at
  // once; silence for a moment means there is none, and one is opened.
  let agentAddress = null, pending = null, pingTimer = null, waitTimer = null
  const openDesk = () => window.open(`${location.pathname}${location.search}#/agent`, "dcode-agent", "popup,width=560,height=720,noopener")
  const hand = () => { if (!pending) return; api.presence.send(pending); boxSay("Brief handed to the agent…"); pending = null; clearTimeout(waitTimer) }
  form?.addEventListener("submit", (e) => {
    e.preventDefault()
    const brief = input.value.trim(); if (!brief) return
    const from = api.currentBranch(); if (!from) return api.notice("Open a repository first.")
    if (!api.me()) return api.notice("Sign in first: the agent proposes to you.")
    pending = { kind: "agent-brief", repo: from.value.repo, into: from.id, brief }
    input.value = ""
    boxSay("Calling the agent…"); api.presence.send({ kind: "agent-ping" })
    clearTimeout(pingTimer); pingTimer = setTimeout(() => { boxSay("Opening the agent's desk…"); openDesk() }, 2500)
    clearTimeout(waitTimer); waitTimer = setTimeout(() => { if (pending) { pending = null; boxSay(""); api.notice("The agent's desk did not answer. Is its window open?") } }, 120_000)
  })

  // ── The channel, both ways ────────────────────────────────────────────
  const announce = (peerId) => api.presence.send({ kind: "agent-status", address: desk.address, text: busy ? "working…" : "ready" }, peerId)
  api.presence.on("message", (msg) => {
    if (msg.kind === "agent-ping") { if (isDesk() && desk.state === "ready") announce(); return }
    if (msg.kind === "agent-brief") { if (isDesk()) { queue.push(msg); drain() } return }
    if (msg.kind !== "agent-status" || isDesk()) return
    clearTimeout(pingTimer) // a desk is here
    if (msg.address) { agentAddress = msg.address; api.name(msg.address, "agent") }
    boxSay(msg.text === "ready" ? "" : msg.text)
    if (msg.text === "ready") hand()
    if (msg.branch && msg.repo) { // watch it write, then hold what it proposed
      if (!msg.done) location.hash = `#/r/${msg.repo}/${msg.branch}`
      else api.notice(`The agent committed ${api.short(msg.done)} and opened a pull request: merge it from Pulls, or keep editing its branch.`)
    }
  })

  const route = () => { form.hidden = isDesk() || !location.hash.startsWith("#/r/"); if (isDesk()) startDesk() }
  addEventListener("hashchange", route); route()
}
