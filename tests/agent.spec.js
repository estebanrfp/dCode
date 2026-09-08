/**
 * The agent is a peer of its own: a window that signs in as itself, takes
 * the brief over the room's channel, writes the file line by line into a
 * branch it owns, commits under its own signature and proposes — and the
 * owner merges. The model is a part the suite replaces with a stub that
 * streams a fixed file; the identities, the flow and the wire are what is pinned.
 */
import { expect, test } from "@playwright/test"
import { assertTransport, branchRows, connected, createRepo, head, loginAs, preview, prRows, rows, seesLine, tab, visitor } from "./_helpers.js"

const APP = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Agent Todo</title><style>:root { --bg: #111; } body { background: var(--bg); }</style></head>
<body>
  <h1>Agent Todo</h1>
  <ul id="list"></ul>
  <script type="module">
    import { gdb } from "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.js"
  </script>
</body>
</html>`
const AGAIN = APP.replace("<h1>Agent Todo</h1>", "<h1>Agent Todo, again</h1>\n  <p>One line changed, one added.</p>")
/** The model as a part: each brief takes the next script, streamed in small pieces. */
const stub = (...texts) => `globalThis.__agentScript = ${JSON.stringify(texts)}
globalThis.__agentEngine = { chat: { completions: { create: async () => (async function* () {
  const text = globalThis.__agentScript.shift()
  if (!globalThis.__agentScript.length) await new Promise((release) => { globalThis.__agentRelease = release }) // the last script waits for the test's go
  for (const piece of text.match(/[\\s\\S]{1,17}/g)) yield { choices: [{ delta: { content: piece } }] }
})() } } }`

test("the agent signs as itself in a window of its own, writes a branch it owns, proposes it; the owner merges and the app runs", async ({ browser }) => {
  const room = `dcode-test-agent-${Date.now().toString(36)}`
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "agent-lab", "Where the agent works")
  const mainHead = await head(alice.page).textContent()
  await alice.context.addInitScript(stub("```html\n" + APP + "\n```", AGAIN)) // the desk is a new document in Alice's context: the stub lands there

  await expect(alice.page.locator("#agent")).toBeVisible()
  const deskOpens = alice.context.waitForEvent("page") // the desk opens with noopener: a new page of the context, not a popup of the page
  await alice.page.locator("#agent-brief").fill("A todo list everyone shares")
  await alice.page.locator("#agent-go").click()
  const desk = await deskOpens
  desk.on("pageerror", (e) => { throw e })
  await expect(desk.locator("#desk-state")).toHaveText("ready", { timeout: 90_000 })
  await expect(desk.locator("#session-addr")).toContainText("agent") // the desk is the agent, not Alice
  await expect(alice.page.locator("#session-addr")).toContainText("Alice") // and Alice is still Alice

  // Alice's window follows the agent to the branch it owns; the file lands line by line, committed and proposed.
  await expect(alice.page.locator("#branch-select option:checked")).toHaveText(/agent\/a-todo-list-everyone-shares/)
  await seesLine(alice, "<h1>Agent Todo</h1>")
  await expect(alice.page.locator("#notice")).toContainText("opened a pull request")
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(rows(alice.page).first()).toContainText("agent") // the commit is the agent's, under its own signature
  const fences = await alice.page.locator("#buffer textarea").evaluateAll((els) => els.filter((e) => e.value.startsWith("```")).length)
  expect(fences).toBe(0)

  // Bob, on the other side of the wire, holds the agent's branch, its commit and the proposal.
  await bob.page.goto(alice.page.url()); await expect(branchRows(bob.page)).toHaveCount(2)
  await seesLine(bob, "<h1>Agent Todo</h1>")
  await tab(bob, "pulls"); await expect(prRows(bob.page)).toHaveCount(1)

  // The owner merges from main: a fast-forward, and main runs the agent's app.
  const main = await alice.page.locator("#branch-select option").first().getAttribute("value")
  await alice.page.goto(alice.page.url().replace(/\/[^/]+$/, `/${main}`))
  await tab(alice, "pulls")
  await alice.page.locator('[data-act="merge"]').click()
  await expect(alice.page.locator("#notice")).toContainText("Fast-forwarded main")
  await expect(head(alice.page)).not.toHaveText(mainHead)
  await expect(preview(alice.page)).toContainText("Agent Todo")

  // A second brief, on main as it now stands: the agent's branch starts as the file and what the
  // model dictates is fitted onto it — the lines that did not change keep their nodes.
  const ids = (p) => p.locator("#buffer .line").evaluateAll((els) => els.map((el) => [el.id, el.querySelector("textarea").value]))
  await alice.page.locator("#agent-brief").fill("Change the heading and add a line")
  await alice.page.locator("#agent-go").click()
  await expect(alice.page.locator("#branch-select option:checked")).toHaveText(/agent\/change-the-heading-and-add-a-line/)
  await expect(alice.page.locator("#buffer .line")).toHaveCount(APP.split("\n").length) // seeded with main's file, the model held at the gate
  const seeded = await ids(alice.page)
  expect(seeded.map(([, t]) => t).join("\n")).toBe(APP)
  await desk.evaluate(() => globalThis.__agentRelease()) // now the model may speak
  await expect(alice.page.locator("#notice")).toContainText("opened a pull request")
  await seesLine(alice, "One line changed, one added")
  const after = await ids(alice.page)
  expect(after.map(([, t]) => t).join("\n")).toBe(AGAIN)
  const kept = after.filter(([id]) => seeded.some(([sid]) => sid === id))
  expect(kept.length).toBe(APP.split("\n").length) // every seeded node is still there — the changed heading rewritten in place
  expect(after.length - kept.length).toBe(1) // one line inserted, under a new node
  await assertTransport(bob)
  await desk.close(); await alice.close(); await bob.close()
})
