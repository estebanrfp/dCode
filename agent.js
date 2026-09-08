// The agent: a coding model that runs in this browser, on WebGPU, and writes
// into the repository like anyone else — line by line into the shared buffer
// of a branch of its own, then a commit, then a pull request the owner
// merges. No server, no key, no request leaves the machine: the weights are
// downloaded once from the model hub and cached by the browser. It signs as
// this session, on a branch named after the brief, so `main` never moves
// without the owner's merge.
const WEBLLM = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm"
const MODELS = ["Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC"]
const DOCS = "https://cdn.jsdelivr.net/gh/estebanrfp/gdb@main/llms.txt" // GenosDB's own summary for models, fetched fresh so the agent follows the engine
/** `?model=<id>` puts a model first: a smaller one for a small GPU, a larger one for a large one. */
const models = () => { const m = new URLSearchParams(location.search).get("model"); return m ? [m, ...MODELS.filter((x) => x !== m)] : MODELS }

/**
 * Mount the prompt box. `api` is the application's own vocabulary: the
 * functions the buttons use, handed over so the agent commits like a person.
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
        model = id; return e
      } catch (err) { console.warn(`${id}: ${err.message}`) } // too large for this GPU: the next one down
    }
    throw new Error("No model fits this GPU.")
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const brief = input.value.trim(); if (!brief) return
    const from = api.currentBranch(); if (!from) return api.notice("Open a repository first.")
    if (!api.me()) return api.notice("Sign in first: the agent commits as you.")
    input.disabled = true
    try {
      prompt ??= await loadPrompt()
      engine ??= globalThis.__agentEngine ?? await loadEngine() // the suite plugs a stub in: the flow is what it pins, the model is a part
      model ??= "stub"
      // A branch of its own, from where the owner stands, so the owner merges what the agent proposes.
      const repo = from.value.repo, name = `ai/${brief.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app"}`
      const branch = await api.create({ type: "branch", repo, name, head: from.value.head })
      location.hash = `#/r/${repo}/${branch}`
      const current = api.contentOf(from.value.head)
      const user = current.trim() && current.length < 6000 ? `${brief}\n\nThe repository currently holds this file; build on it where that makes sense:\n\n${current}` : brief
      say(`${model.split("-Instruct")[0]} is writing…`)
      // Each completed line is a node the moment it exists: the room watches the file appear.
      // The platform's skeleton is enforced on the way in, whatever the model did with the
      // rules: the script is a module, GenosDB is imported from its CDN, the room is this app's.
      const lines = []; let tail = "", n = 0, imported = false
      const room = name.slice(3), IMPORT = 'import { gdb } from "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.js"'
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
      await api.create({ type: "pr", repo, from: branch, into: from.id, title: brief.slice(0, 120), commit: id })
      api.runPreview(content, `${api.short(id)}, the agent's head`)
      api.notice(`The agent committed ${api.short(id)} on ${name} and opened a pull request: merge it from Pulls, or keep editing its branch.`)
      input.value = ""
    } catch (err) { api.notice(err.message) } finally { input.disabled = false; say(""); input.focus() }
  })
}
