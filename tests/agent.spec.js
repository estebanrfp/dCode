/**
 * The agent edits the shared buffer as you: the file changes in place, line
 * by line, under your session, and then presses Commit for you — to your
 * branch, or the fork the button makes on someone else's, once. The model is a part the suite replaces with a stub that streams a
 * fixed file; the fitting, the ownership and the wire are what is pinned.
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
/** The model as a part: each brief takes the next script, streamed in small pieces; the last one waits for the test's go. */
const stub = (...texts) => `globalThis.__agentScript = ${JSON.stringify(texts)}
globalThis.__agentEngine = { chat: { completions: { create: async () => (async function* () {
  const text = globalThis.__agentScript.shift()
  if (!globalThis.__agentScript.length) await new Promise((release) => { globalThis.__agentRelease = release })
  for (const piece of text.match(/[\\s\\S]{1,17}/g)) yield { choices: [{ delta: { content: piece } }] }
})() } } }`
const ids = (p) => p.locator("#buffer .line").evaluateAll((els) => els.map((el) => [el.id, el.querySelector("textarea").value]))
const ask = async (v, brief) => { await v.page.locator("#agent-brief").fill(brief); await v.page.locator("#agent-go").click() }

test("the agent edits the buffer as you — in place, the unchanged lines keeping their nodes — and commits as you; on someone else's repository it forks once, and the pull request is yours", async ({ browser }) => {
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
  // The commit is Alice's, on main, with the brief as its message: the head moves and main runs the app.
  await expect(alice.page.locator("#toasts")).toContainText(/Committed ([0-9a-f]{7}) to main/)
  await seesLine(alice, "<h1>Agent Todo</h1>")
  expect((await ids(alice.page)).map(([, t]) => t).join("\n")).toBe(APP)
  await expect(alice.page.locator("#branch-select option:checked")).toHaveText("main") // no branch of the agent's: it is Alice's
  await expect(alice.page.locator("#session-addr")).toContainText("Alice")
  await expect(head(alice.page)).not.toHaveText(mainHead)
  await tab(alice, "history")
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(rows(alice.page).first()).toContainText("A todo list everyone shares")
  await expect(rows(alice.page).first()).toContainText("Alice")
  await expect(preview(alice.page)).toContainText("Agent Todo")
  await bob.page.goto(alice.page.url()); await seesLine(bob, "<h1>Agent Todo</h1>") // the shared buffer, on Bob's screen too

  // A second brief fits onto the file: every node kept, the heading rewritten in place, one node for the added line.
  const seeded = await ids(alice.page)
  await ask(alice, "Change the heading and add a line")
  await expect.poll(() => alice.page.evaluate(() => typeof globalThis.__agentRelease)).toBe("function") // the model holds at the gate
  await alice.page.evaluate(() => globalThis.__agentRelease())
  await expect(alice.page.locator("#toasts")).toContainText(/Committed ([0-9a-f]{7}) to main/)
  await expect.poll(() => ids(alice.page).then((a) => a.map(([, t]) => t).join("\n"))).toBe(AGAIN) // the repaint lands a frame after the writes
  const after = await ids(alice.page)
  expect(after.filter(([id]) => seeded.some(([sid]) => sid === id)).length).toBe(seeded.length)
  expect(after.length).toBe(seeded.length + 1)
  await expect(rows(alice.page)).toHaveCount(3) // a second commit on main, no branch anywhere
  await tab(alice, "branches")
  await expect(branchRows(alice.page)).toHaveCount(1)

  // Bob asks the agent on Alice's repository: the shared buffer changes for everyone, and Bob's
  // commit is a fork of his own — the pull request comes from Bob, as it should.
  await bob.page.evaluate(stub(AGAIN.replace("one added", "one added by Bob")))
  await ask(bob, "Change the line about the addition")
  await expect.poll(() => bob.page.evaluate(() => typeof globalThis.__agentRelease)).toBe("function")
  await bob.page.evaluate(() => globalThis.__agentRelease())
  await expect(bob.page.locator("#toasts")).toContainText("on your own branch") // the fork the button makes, once
  await expect(bob.page.locator("#branch-select option:checked")).toHaveText(/Bob\/main/)
  await seesLine(alice, "one added by Bob") // main's shared buffer changed on Alice's screen too; main's head did not move
  await expect(branchRows(alice.page)).toHaveCount(2)
  await tab(bob, "pulls")
  await bob.page.locator('#pr-form [name="title"]').fill("From the agent, via Bob")
  await bob.page.locator('#pr-form button[type="submit"]').click()
  await tab(alice, "pulls")
  await expect(prRows(alice.page)).toHaveCount(1)
  await expect(alice.page.locator('[data-act="merge"]')).toHaveCount(1) // Alice's to merge
  await assertTransport(bob)
  await alice.close(); await bob.close()
})
