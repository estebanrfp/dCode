// The agent: a coding model that runs in this window, on WebGPU, and edits
// the shared buffer the way you do — as you. Describe a change and the file
// changes in place, line by line, under your session: a line the buffer
// already holds keeps its node, a changed one is rewritten under the same
// id, only what is new is inserted and only what is gone is removed. Then
// it presses Commit for you, with the brief as the message: a commit on the
// branch you stand on when it is yours to move, and on someone else's the
// fork the button makes — once — after which you stand on your own branch.
// No server, no key, no request leaves the machine: the weights are
// downloaded once from the model hub and cached by the browser.
const WEBLLM = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm"
const MODELS = ["Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC"]
const DOCS = "https://cdn.jsdelivr.net/gh/estebanrfp/gdb@main/llms.txt" // GenosDB's own summary for models, fetched fresh so the agent follows the engine
const IMPORT = 'import { gdb } from "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.js"'
/** `?model=<id>` puts a model first: a smaller one for a small GPU, a larger one for a large one. */
const models = () => { const m = new URLSearchParams(location.search).get("model"); return m ? [m, ...MODELS.filter((x) => x !== m)] : MODELS }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app"

/**
 * Mount the prompt box. `api` is the application's own vocabulary: the
 * functions the editor uses, handed over so the agent edits like a person.
 * @param {object} api
 */
export function mountAgent(api) {
  const form = document.getElementById("agent"), input = document.getElementById("agent-brief"), status = document.getElementById("agent-status")
  if (!form) return
  const say = (text) => { status.textContent = text; status.hidden = !text }
  const show = () => { form.hidden = !location.hash.startsWith("#/r/") }
  addEventListener("hashchange", show); show()

  let engine = null, model = null, prompt = null
  const loadPrompt = async () => {
    const [rules, docs] = await Promise.all([fetch("agent-prompt.md").then((r) => r.text()), fetch(DOCS).then((r) => (r.ok ? r.text() : "")).catch(() => "")])
    return docs ? `${rules}\n\n## GenosDB, in its own words\n\n${docs}` : rules
  }
  const loadEngine = async () => {
    if (!(await navigator.gpu?.requestAdapter())) throw new Error("No WebGPU here: the agent needs a GPU and Chrome, Edge or Safari 26.")
    const { CreateMLCEngine } = await import(WEBLLM)
    for (const id of models()) {
      try {
        say(`Loading ${id.split("-Instruct")[0]}…`)
        const e = await CreateMLCEngine(id, { initProgressCallback: ({ text }) => say(text.replace(/\[.*?\]\s*/g, "").slice(0, 90)) }, { context_window_size: 8192 })
        model = id.split("-Instruct")[0]; return e
      } catch (err) { console.warn(`${id}: ${err.message}`) } // too large for this GPU: the next one down
    }
    throw new Error("No model fits this GPU.")
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const brief = input.value.trim(); if (!brief) return
    const branch = api.currentBranch(); if (!branch) return api.notice("Open a repository first.")
    if (!api.me()) return api.notice("Sign in first: the agent edits as you.")
    input.disabled = true
    try {
      prompt ??= await loadPrompt()
      engine ??= globalThis.__agentEngine ?? await loadEngine() // the suite plugs a stub in: the flow is what it pins, the model is a part
      model ??= "stub"
      await api.flushSaves() // what is being typed lands first: the model sees the buffer as everyone does
      const { repo } = branch.value, existing = api.bufferLines(), current = existing.map((l) => l.text).join("\n"), room = slug(brief)
      const user = current.trim() && current.length < 6000
        ? `${brief}\n\nModify the file below to do that. Keep every line you do not need to change exactly as it is, in its place, and output the whole file:\n\n${current}`
        : brief
      say(`${model} is writing…`)
      // What the model dictates is FITTED onto the buffer as it arrives, with one line of
      // lookahead: a line the buffer already holds is an anchor and keeps its node; what
      // came since the last anchor stands where the skipped lines stood — rewritten in
      // place under the same id, inserted between neighbours, or removed. A blank line or
      // a lone closing tag anchors only with its follower, so it never hooks the wrong spot.
      let held = null, imported = false, i = 0, prevOrder = undefined, fresh = [], changed = 0
      const trivial = (t) => t.trim().length <= 3
      const place = async (upto) => {
        const gone = existing.slice(i, upto), reuse = Math.min(gone.length, fresh.length)
        for (let t = 0; t < reuse; t++) if (gone[t].text !== fresh[t]) { changed++; await api.putLine(repo, branch.id, fresh[t], gone[t].order, gone[t].id) }
        for (let t = reuse; t < gone.length; t++) { changed++; await api.remove(gone[t].id) }
        if (fresh.length > reuse) {
          const keys = api.keysBetween(reuse ? gone[reuse - 1].order : prevOrder, existing[upto]?.order, fresh.length - reuse)
          for (let t = reuse; t < fresh.length; t++) { changed++; await api.putLine(repo, branch.id, fresh[t], keys[t - reuse]) }
          prevOrder = keys.at(-1)
        } else if (reuse) prevOrder = gone[reuse - 1].order
        fresh = []
      }
      const decide = async (line, next) => {
        const j = existing.findIndex((l, idx) => idx >= i && idx < i + 40 && l.text === line && (!trivial(line) || (next === null ? idx === existing.length - 1 : existing[idx + 1]?.text === next)))
        if (j < 0) return fresh.push(line)
        await place(j); prevOrder = existing[j].order; i = j + 1
      }
      const feed = async (line) => { if (held !== null) await decide(held, line); held = line }
      const land = async (line) => { // the platform's skeleton is enforced on the way in, whatever the model did with the rules
        if (/^```/.test(line)) return
        if (/<script(?![^>]*type=)/.test(line)) line = line.replace("<script", '<script type="module"')
        if (line.includes(IMPORT)) imported = true
        if (/\bgdb\(/.test(line) && !imported) { await feed(line.match(/^\s*/)[0] + IMPORT); imported = true }
        await feed(line.replace(/gdb\(\s*["'](my-app-name|room-name|app|my-app|shared-todos)["']/, `gdb("${room}"`))
      }
      const chunks = await engine.chat.completions.create({ messages: [{ role: "system", content: prompt }, { role: "user", content: user }], stream: true, temperature: 0.2, max_tokens: 6000 })
      let tail = ""
      for await (const chunk of chunks) {
        tail += chunk.choices[0]?.delta?.content ?? ""
        let cut
        while ((cut = tail.indexOf("\n")) >= 0) { await land(tail.slice(0, cut)); tail = tail.slice(cut + 1) }
      }
      if (tail.trim()) await land(tail)
      if (held !== null) await decide(held, null)
      await place(existing.length) // whatever the buffer still held past the last anchor is gone
      input.value = ""
      if (!changed) return api.notice("The agent left the file as it is.")
      api.commit(brief.slice(0, 120)) // what pressing Commit does: to your branch, or a fork of your own on someone else's
    } catch (err) { api.notice(err.message) } finally { input.disabled = false; say(""); input.focus() }
  })
}
