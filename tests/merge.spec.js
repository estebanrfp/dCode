/**
 * Merging is the target's owner writing a merge commit and moving their own
 * head. Different lines merge on their own; the same line is a conflict the
 * owner resolves in the editor, and the commit made from there is the merge.
 */
import { expect, test } from "@playwright/test"
import { commit, connected, createRepo, freshRoom, go, head, loginAs, preview, prRows, rows, visitor } from "./_helpers.js"

test("divergent edits on different lines merge into one commit with two parents; the same line conflicts and is resolved", async ({ browser }) => {
  const room = freshRoom("merge")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "diverge")

  // Both start from the initial commit. Bob changes the button on his fork; Alice changes the heading on main.
  // A line stands between the two changes: adjacent changes are one region, and a conflict — as in git.
  await go(bob, `#/r/${repo}`)
  await expect(rows(bob.page)).toHaveCount(1)
  await commit(bob, "Bob edits the button", (t) => t.replace("Clicked 0 times", "Pressed 0 times"))
  await expect(bob.page.locator("#work-head .branch")).toHaveText("bob/main")
  await expect(rows(alice.page)).toHaveCount(2)
  await commit(alice, "Alice edits the heading", (t) => t.replace("Hello from dCode", "Hello from Alice"))
  await expect(rows(bob.page)).toHaveCount(3)

  await bob.page.locator('#pr-form [name="title"]').fill("Bob's button")
  await bob.page.locator('#pr-form button[type="submit"]').click()
  await expect(prRows(alice.page)).toHaveCount(1)
  await alice.page.locator('[data-act="merge"]').click()
  await expect(alice.page.locator("#notice")).toContainText("no conflicts")
  await expect(rows(alice.page)).toHaveCount(4)
  await expect(rows(alice.page).first()).toContainText("Merge bob/main into main")
  await expect(alice.page.locator("#commit-panel .meta")).toContainText("parents")
  await expect(prRows(alice.page).first()).toContainText("merged")
  await expect(prRows(bob.page).first()).toContainText("merged")
  await expect(preview(alice.page)).toContainText("Hello from Alice") // both changes, one page
  await expect(preview(alice.page)).toContainText("Pressed 0 times")
  await expect(rows(bob.page)).toHaveCount(4)

  // The same line, changed both ways: a conflict Alice resolves in her editor.
  await commit(bob, "Bob's heading", (t) => t.replace("Hello from dCode", "Hello from Bob's branch"))
  await commit(alice, "Alice's heading again", (t) => t.replace("Hello from Alice", "Hello from Alice's main"))
  await expect(rows(alice.page)).toHaveCount(6)
  await bob.page.locator('#pr-form [name="title"]').fill("Bob's heading")
  await bob.page.locator('#pr-form button[type="submit"]').click()
  await expect(prRows(alice.page)).toHaveCount(2)
  await alice.page.locator('#prs li:has-text("Bob\'s heading") [data-act="merge"]').click()
  await expect(alice.page.locator("#notice")).toContainText("1 conflict")
  const ed = alice.page.locator("#editor")
  await expect(ed).toHaveValue(/<<<<<<< ours[\s\S]*Hello from Alice's main[\s\S]*=======[\s\S]*Hello from Bob's branch[\s\S]*>>>>>>> theirs/)
  await expect(alice.page.locator("#merge-banner")).toBeVisible()
  await expect(alice.page.locator("#message")).toHaveValue("Merge bob/main into main")
  // Markers still in the file: the commit is refused, in words.
  await alice.page.locator("#commit-btn").click()
  await expect(alice.page.locator("#notice")).toContainText("Conflict markers are still in the file")
  await ed.fill((await ed.inputValue()).replace(/<<<<<<< ours\n[\s\S]*?>>>>>>> theirs/, "  <h1>Hello from both</h1>"))
  await alice.page.locator("#commit-btn").click()
  await expect(alice.page.locator("#notice")).toContainText(/Committed [0-9a-f]{7} to main/)
  await expect(rows(alice.page)).toHaveCount(7)
  await expect(alice.page.locator("#commit-panel .meta")).toContainText("parents")
  await expect(alice.page.locator("#merge-banner")).toBeHidden()
  await expect(prRows(alice.page).filter({ hasText: "Bob's heading" })).toContainText("merged")
  await expect(preview(alice.page)).toContainText("Hello from both")
  const mainHead = await head(alice.page).textContent()
  await expect(head(bob.page)).not.toHaveText(mainHead) // Bob's branch stays where he left it
  await expect(prRows(bob.page).filter({ hasText: "Bob's heading" })).toContainText("merged")
  await alice.close(); await bob.close()
})
