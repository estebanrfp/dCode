/**
 * A repository is a node its owner owns; its buffer is one node per line that
 * everyone on the branch edits live; a commit is a node its author owns,
 * named by the author's address and a hash of what it holds; every commit is
 * a whole page and runs. Two visitors, real WebRTC between them.
 */
import { expect, test } from "@playwright/test"
import { TEMPLATE_LINES, assertTransport, commit, commitIds, connected, createRepo, freshRoom, go, head, lineIndex, lineWith, lines, loginAs, preview, rows, seesLine, setLine, short, visitor } from "./_helpers.js"

test("a repository, its shared buffer and its commits cross to another visitor, with the same ids, and every version runs", async ({ browser }) => {
  const room = freshRoom("repo")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)

  const { repo } = await createRepo(alice, "hello-world", "The first repository in this room")
  await expect(lines(alice.page).last().locator(".ln")).toHaveText(String(TEMPLATE_LINES)) // positions, derived
  await expect(rows(alice.page).first()).toContainText("Initial commit")
  await expect(preview(alice.page)).toContainText("Hello from dCode") // the buffer runs on arrival

  // Bob opens the repository: the same buffer, line for line.
  await go(bob, "#/")
  await expect(bob.page.locator(".repos .name")).toHaveText("hello-world")
  await bob.page.locator(".repos .name").click()
  await expect(bob.page).toHaveURL(new RegExp(`#/r/${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)

  // Alice edits a line: it lands on Bob's screen live, the head has not moved, the page re-runs.
  await setLine(alice, "Hello from dCode", "  <h1>Hello, Bob, from dCode</h1>")
  await seesLine(bob, "Hello, Bob, from dCode")
  await expect(bob.page.locator("#dirty")).toBeVisible() // uncommitted, on both
  await expect(alice.page.locator("#dirty")).toBeVisible()
  await expect(preview(bob.page)).toContainText("Hello, Bob, from dCode")
  await expect(rows(bob.page)).toHaveCount(1)

  const second = await commit(alice, "Greet by name")
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(rows(alice.page).first()).toContainText("Greet by name")
  await expect(head(alice.page)).toHaveText(`@ ${second}`)
  await expect(alice.page.locator("#dirty")).toBeHidden()
  // The commit's id carries its author: nobody else can create it, on any peer.
  const ids = await commitIds(alice.page)
  expect(ids[0].startsWith(`${alice.address}:`)).toBe(true)
  expect(short(ids[0])).toBe(second)

  // Bob: the two commits under the same ids, the buffer clean against the new head, the diff.
  await expect(rows(bob.page)).toHaveCount(2)
  expect(await commitIds(bob.page)).toEqual(ids)
  await expect(bob.page.locator("#dirty")).toBeHidden()
  await expect(bob.page.locator("#commit-panel .diff-summary")).toContainText("+1")
  await expect(bob.page.locator("#commit-panel .diff .del")).toHaveText(/Hello from dCode/)
  await expect(bob.page.locator("#commit-panel .diff .add")).toHaveText(/Hello, Bob, from dCode/)

  // Time travel: the first version, selected in the timeline, runs as it was.
  await rows(bob.page).nth(1).click()
  await expect(bob.page.locator("#commit-panel")).toContainText("root")
  await bob.page.locator('[data-act="run-commit"]').click()
  await expect(bob.page.locator("#preview-what")).toContainText("Initial commit")
  await expect(preview(bob.page)).toContainText("Hello from dCode")
  await expect(preview(bob.page)).not.toContainText("Hello, Bob")

  await assertTransport(bob)
  await alice.close(); await bob.close()
})

test("the buffer is the block editor for code: two people on two lines, Enter splits a node, Backspace merges it back, Discard returns to the head", async ({ browser }) => {
  const room = freshRoom("buffer")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "shared-buffer")
  await go(bob, `#/r/${repo}`)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)

  // Two people, two lines, at once: line-level LWW, no shared node to fight over.
  await Promise.all([
    setLine(alice, "Hello from dCode", "  <h1>Alice was here</h1>"),
    setLine(bob, "Clicked 0 times", '  <button id="count">Bob was here</button>'),
  ])
  await seesLine(alice, "Bob was here")
  await seesLine(bob, "Alice was here")

  // Enter at the end of a line: a new node below, indented like its parent, on both peers.
  // (The caret is placed with setSelectionRange: Home and End do not move it in headless Chromium on macOS.)
  const h1 = await lineWith(alice.page, "Alice was here")
  await h1.click(); await h1.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length))
  await alice.page.keyboard.press("Enter")
  await expect(lines(alice.page)).toHaveCount(TEMPLATE_LINES + 1)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES + 1)
  await expect(lines(alice.page).last().locator(".ln")).toHaveText(String(TEMPLATE_LINES + 1))
  await alice.page.keyboard.type("<p>a new line</p>")
  await seesLine(bob, "  <p>a new line</p>")

  // Backspace at its start: the line joins the one above and its node is gone everywhere.
  const fresh = await lineWith(alice.page, "<p>a new line</p>")
  await fresh.click(); await fresh.evaluate((el) => el.setSelectionRange(0, 0))
  await alice.page.keyboard.press("Backspace")
  await expect(lines(alice.page)).toHaveCount(TEMPLATE_LINES)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)
  await seesLine(bob, "<h1>Alice was here</h1>  <p>a new line</p>")

  // Discard: the buffer is the head again, for everyone. Bob leaves the line he was typing in first:
  // a line under a caret keeps what its typist sees and rejoins the graph on blur, by design.
  await bob.page.locator(".preview-head").click()
  await alice.page.locator("#discard").click()
  await expect(alice.page.locator("#dirty")).toBeHidden()
  await expect(bob.page.locator("#dirty")).toBeHidden()
  await expect.poll(() => lineIndex(bob.page, "Alice was here")).toBe(-1)
  await expect.poll(() => lineIndex(bob.page, "Bob was here")).toBe(-1)
  await seesLine(bob, "Hello from dCode")
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)
  await alice.close(); await bob.close()
})
