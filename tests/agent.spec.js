/**
 * The agent writes like anyone else: a branch of its own from where the owner
 * stands, the file line by line into the shared buffer, a commit, a pull
 * request — and the owner merges. The model is a part the suite replaces with
 * a stub that streams a fixed file; the flow around it is what is pinned.
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
const stub = (text) => `globalThis.__agentEngine = { chat: { completions: { create: async () => (async function* () {
  for (const piece of ${JSON.stringify(text.match(/[\s\S]{1,17}/g))}) yield { choices: [{ delta: { content: piece } }] }
})() } } }`

test("the agent commits on a branch of its own and proposes it; the owner merges and the app runs", async ({ browser }) => {
  const room = `dcode-test-agent-${Date.now().toString(36)}`
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "agent-lab", "Where the agent works")
  await alice.page.evaluate(stub("```html\n" + APP + "\n```")) // the page never reloads from here on: the stub lives in this document
  const mainHead = await head(alice.page).textContent()

  await expect(alice.page.locator("#agent")).toBeVisible()
  await alice.page.locator("#agent-brief").fill("A todo list everyone shares")
  await alice.page.locator("#agent-go").click()

  // The branch is the brief's name; the file lands line by line and is committed; the pull request is open.
  await expect(alice.page).toHaveURL(/#\/r\/.+\/.+/)
  await expect(alice.page.locator("#branch-select option:checked")).toHaveText(/ai\/a-todo-list-everyone-shares/)
  await seesLine(alice, "<h1>Agent Todo</h1>")
  await expect(alice.page.locator("#notice")).toContainText("opened a pull request")
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(preview(alice.page)).toContainText("Agent Todo")
  const fences = await alice.page.locator("#buffer textarea").evaluateAll((els) => els.filter((e) => e.value.startsWith("```")).length)
  expect(fences).toBe(0) // the model's fences never reach the file

  // Bob, on the other side of the wire, holds the branch, its commit and the proposal.
  await bob.page.goto(alice.page.url()); await expect(branchRows(bob.page)).toHaveCount(2)
  await seesLine(bob, "<h1>Agent Todo</h1>")
  await tab(bob, "pulls"); await expect(prRows(bob.page)).toHaveCount(1)

  // The owner merges from main: a fast-forward, and main runs the agent's app.
  await alice.page.goto(alice.page.url().replace(/\/[^/]+$/, `/${(await alice.page.locator("#branch-select option").first().getAttribute("value"))}`))
  await tab(alice, "pulls")
  await alice.page.locator('[data-act="merge"]').click()
  await expect(alice.page.locator("#notice")).toContainText("Fast-forwarded main")
  await expect(head(alice.page)).not.toHaveText(mainHead)
  await expect(preview(alice.page)).toContainText("Agent Todo")
  await assertTransport(bob)
  await alice.close(); await bob.close()
})
