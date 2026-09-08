/**
 * The agent edits the shared buffer as you: the file changes in place, line
 * by line, under your session, and then the flow is the one you know —
 * commit to your branch, or fork and commit on someone else's and propose
 * it. The model is a part the suite replaces with a stub that streams a
 * fixed file; the fitting, the ownership and the wire are what is pinned.
 */
import { expect, test } from "@playwright/test"
import { assertTransport, branchRows, commit, connected, createRepo, head, loginAs, preview, prRows, rows, seesLine, tab, visitor } from "./_helpers.js"

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
/** The model as a part: each brief takes the next script, streamed in small pieces; the last one waits for the test's go. */
const stub = (...texts) => `globalThis.__agentScript = ${JSON.stringify(texts)}
globalThis.__agentEngine = { chat: { completions: { create: async () => (async function* () {
  const text = globalThis.__agentScript.shift()
  if (!globalThis.__agentScript.length) await new Promise((release) => { globalThis.__agentRelease = release })
  for (const piece of text.match(/[\\s\\S]{1,17}/g)) yield { choices: [{ delta: { content: piece } }] }
})() } } }`
const ids = (p) => p.locator("#buffer .line").evaluateAll((els) => els.map((el) => [el.id, el.querySelector("textarea").value]))
const ask = async (v, brief) => { await v.page.locator("#agent-brief").fill(brief); await v.page.locator("#agent-go").click() }

test("the agent edits the buffer as you — in place, the unchanged lines keeping their nodes — and you commit; on someone else's repository you fork and propose", async ({ browser }) => {
  const room = `dcode-test-agent-${Date.now().toString(36)}`
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "agent-lab", "Where the agent works")
  const mainHead = await head(alice.page).textContent()
  await alice.page.evaluate(stub("```html\n" + APP + "\n```", AGAIN)) // the page never reloads from here on: the stub lives in this document
  await alice.page.evaluate(() => globalThis.__agentRelease?.()) // (no gate on the first script)

  // The first brief on a fresh repository: the template becomes the app, in the buffer, under Alice's session.
  await expect(alice.page.locator("#agent")).toBeVisible()
  await ask(alice, "A todo list everyone shares")
  await expect(alice.page.locator("#notice")).toContainText("The agent changed")
  await seesLine(alice, "<h1>Agent Todo</h1>")
  expect((await ids(alice.page)).map(([, t]) => t).join("\n")).toBe(APP)
  await expect(alice.page.locator("#message")).toHaveValue("A todo list everyone shares") // the commit message, prefilled
  await expect(alice.page.locator("#branch-select option:checked")).toHaveText("main") // no branch of the agent's: it is Alice's buffer
  await expect(alice.page.locator("#session-addr")).toContainText("Alice")
  await bob.page.goto(alice.page.url()); await seesLine(bob, "<h1>Agent Todo</h1>") // the shared buffer, on Bob's screen too

  // Alice commits: the head moves, main runs the app, and the timeline reads Alice.
  await alice.page.locator("#commit-btn").click()
  await expect(alice.page.locator("#notice")).toContainText(/Committed ([0-9a-f]{7}) to main/)
  await expect(head(alice.page)).not.toHaveText(mainHead)
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(rows(alice.page).first()).toContainText("Alice")
  await expect(preview(alice.page)).toContainText("Agent Todo")

  // A second brief fits onto the file: every node kept, the heading rewritten in place, one node for the added line.
  const seeded = await ids(alice.page)
  await ask(alice, "Change the heading and add a line")
  await expect.poll(() => alice.page.evaluate(() => typeof globalThis.__agentRelease)).toBe("function") // the model holds at the gate
  await alice.page.evaluate(() => globalThis.__agentRelease())
  await expect(alice.page.locator("#notice")).toContainText("The agent changed 2 lines")
  await expect.poll(() => ids(alice.page).then((a) => a.map(([, t]) => t).join("\n"))).toBe(AGAIN) // the repaint lands a frame after the writes
  const after = await ids(alice.page)
  expect(after.filter(([id]) => seeded.some(([sid]) => sid === id)).length).toBe(seeded.length)
  expect(after.length).toBe(seeded.length + 1)
  await expect(alice.page.locator("#dirty")).toBeVisible() // uncommitted, as any edit: Alice discards it this time
  await alice.page.locator("#discard").click()
  await seesLine(alice, "<h1>Agent Todo</h1>")

  // Bob asks the agent on Alice's repository: the shared buffer changes for everyone, and Bob's
  // commit is a fork of his own — the pull request comes from Bob, as it should.
  await bob.page.evaluate(stub(AGAIN))
  await ask(bob, "Change the heading and add a line")
  await expect.poll(() => bob.page.evaluate(() => typeof globalThis.__agentRelease)).toBe("function")
  await bob.page.evaluate(() => globalThis.__agentRelease())
  await expect(bob.page.locator("#notice")).toContainText("The agent changed 2 lines")
  await seesLine(alice, "One line changed, one added") // on Alice's screen, live
  await expect(bob.page.locator("#commit-btn")).toHaveText("Fork and commit")
  await commit(bob, "Change the heading and add a line")
  await expect(bob.page.locator("#branch-select option:checked")).toHaveText(/Bob\/main/)
  await expect(branchRows(alice.page)).toHaveCount(2)
  await tab(bob, "pulls")
  await bob.page.locator('#pr-form [name="title"]').fill("From the agent, via Bob")
  await bob.page.locator('#pr-form button[type="submit"]').click()
  await expect(prRows(alice.page)).toHaveCount(1)
  await expect(alice.page.locator('[data-act="merge"]')).toHaveCount(1) // Alice's to merge
  await assertTransport(bob)
  await alice.close(); await bob.close()
})
