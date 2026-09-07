/**
 * Merging is the target's owner writing a merge commit and moving their own
 * head; the target's shared buffer follows. Different lines merge on their
 * own; the same line is a conflict that lands in the buffer, marked, and the
 * commit made from the resolution is the merge.
 */
import { expect, test } from "@playwright/test"
import { bufferText, commit, connected, createRepo, freshRoom, go, head, lineIndex, loginAs, preview, prRows, replaceAll, rows, seesLine, setLine, tab, visitor } from "./_helpers.js"

test("divergent edits on different lines merge into one commit with two parents; the same line conflicts and is resolved in the buffer", async ({ browser }) => {
  const room = freshRoom("merge")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo, branch: main } = await createRepo(alice, "diverge")

  // Both start from the initial commit. Bob changes the button and forks; Alice discards his edit
  // from main's buffer, changes the heading and commits. A line stands between the two changes:
  // adjacent changes are one region, and a conflict — as in git.
  await go(bob, `#/r/${repo}`)
  await expect(rows(bob.page)).toHaveCount(1)
  await setLine(bob, "Clicked 0 times", '  <button id="count">Pressed 0 times</button>')
  await commit(bob, "Bob edits the button")
  await expect(bob.page.locator("#branch-select option:checked")).toHaveText(/Bob\/main/)
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(alice.page.locator("#dirty")).toBeVisible()
  await alice.page.locator("#discard").click()
  await expect(alice.page.locator("#dirty")).toBeHidden()
  await setLine(alice, "Hello from dCode", "  <h1>Hello from Alice</h1>")
  await commit(alice, "Alice edits the heading")
  await expect(rows(bob.page)).toHaveCount(3)

  await tab(bob, "pulls")
  await bob.page.locator('#pr-form [name="title"]').fill("Bob's button")
  await bob.page.locator('#pr-form button[type="submit"]').click()
  await expect(prRows(alice.page)).toHaveCount(1)
  await tab(alice, "pulls")
  await alice.page.locator('[data-act="merge"]').click()
  await expect(alice.page.locator("#notice")).toContainText("no conflicts")
  await expect(rows(alice.page)).toHaveCount(4)
  await tab(alice, "history")
  await expect(rows(alice.page).first()).toContainText("Merge Bob/main into main")
  await expect(alice.page.locator("#commit-panel .meta")).toContainText("parents")
  await expect(prRows(alice.page).first()).toContainText("merged")
  await expect(prRows(bob.page).first()).toContainText("merged")
  await seesLine(alice, "Pressed 0 times") // main's buffer followed the merge
  await seesLine(alice, "Hello from Alice")
  await expect(alice.page.locator("#dirty")).toBeHidden()
  await expect(preview(alice.page)).toContainText("Hello from Alice") // both changes, one page
  await expect(preview(alice.page)).toContainText("Pressed 0 times")
  await expect(rows(bob.page)).toHaveCount(4)

  // The same line, changed both ways: a conflict that lands in main's buffer, marked.
  await setLine(bob, "Hello from dCode", "  <h1>Hello from Bob's branch</h1>")
  const bobHeading = await commit(bob, "Bob's heading")
  await setLine(alice, "Hello from Alice", "  <h1>Hello from Alice's main</h1>")
  await commit(alice, "Alice's heading again")
  await expect(rows(alice.page)).toHaveCount(6)
  await bob.page.locator('#pr-form [name="title"]').fill("Bob's heading")
  await bob.page.locator('#pr-form button[type="submit"]').click()
  await expect(prRows(alice.page)).toHaveCount(2)
  await go(bob, `#/r/${repo}/${main}`) // Bob comes to main's buffer to watch the resolution
  await tab(alice, "pulls")
  await alice.page.locator('#prs li:has-text("Bob\'s heading") [data-act="merge"]').click()
  await expect(alice.page.locator("#notice")).toContainText("1 conflict")
  await seesLine(alice, "<<<<<<< ours")
  await seesLine(alice, "Hello from Alice's main")
  await seesLine(alice, "=======")
  await seesLine(alice, "Hello from Bob's branch")
  await seesLine(alice, ">>>>>>> theirs")
  await seesLine(bob, "<<<<<<< ours") // the buffer is shared: the markers are on Bob's screen too
  await expect(alice.page.locator("#merge-banner")).toBeVisible()
  await expect(alice.page.locator("#message")).toHaveValue("Merge Bob/main into main")
  // Markers still in the file: the commit is refused, in words.
  await alice.page.locator("#commit-btn").click()
  await expect(alice.page.locator("#notice")).toContainText("Conflict markers are still in the file")
  // Ctrl/Cmd+A twice and paste: the whole buffer replaced by the resolution, with the fewest writes.
  const resolved = (await bufferText(alice.page)).replace(/<<<<<<< ours\n[\s\S]*?>>>>>>> theirs/, "  <h1>Hello from both</h1>")
  await replaceAll(alice, resolved)
  await expect.poll(() => lineIndex(alice.page, "<<<<<<<")).toBe(-1)
  await seesLine(alice, "Hello from both")
  await seesLine(bob, "Hello from both")
  await alice.page.locator("#commit-btn").click()
  await expect(alice.page.locator("#notice")).toContainText(/Committed [0-9a-f]{7} to main/)
  await expect(rows(alice.page)).toHaveCount(7)
  await tab(alice, "history")
  await expect(alice.page.locator("#commit-panel .meta")).toContainText("parents")
  await expect(alice.page.locator("#merge-banner")).toBeHidden()
  await expect(prRows(alice.page).filter({ hasText: "Bob's heading" })).toContainText("merged")
  await expect(preview(alice.page)).toContainText("Hello from both")
  await expect(head(bob.page)).toHaveText(await head(alice.page).textContent()) // Bob, on main, sees the merge as the head
  await expect(bob.page.locator("#dirty")).toBeHidden()
  await tab(bob, "branches")
  await expect(bob.page.locator('#branches li:has-text("Bob/main")')).toContainText(bobHeading) // his own branch stays where he left it
  await expect(prRows(bob.page).filter({ hasText: "Bob's heading" })).toContainText("merged")
  await alice.close(); await bob.close()
})
