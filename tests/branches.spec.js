/**
 * Branch protection with no server: a head moves only for the branch's owner
 * and the addresses granted `write`; anyone else commits to a branch of their
 * own and proposes. The negative is proved against a later write that lands,
 * never against silence.
 */
import { expect, test } from "@playwright/test"
import { ADDR, assertTransport, branchRows, commit, connected, createRepo, freshRoom, go, head, loginAs, preview, prRows, rows, visitor } from "./_helpers.js"

test("a fork, a pull request and a fast-forward merge; a tampered client cannot move another's head", async ({ browser }) => {
  const room = freshRoom("fork")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo, branch: main } = await createRepo(alice, "shared", "Alice's repository")
  const mainHead = await head(alice.page).textContent()

  // Bob cannot move main: his commit goes to a branch of his own, forked from main's head.
  await go(bob, `#/r/${repo}`)
  await expect(rows(bob.page)).toHaveCount(1)
  await expect(bob.page.locator("#commit-btn")).toHaveText("Fork and commit")
  await commit(bob, "Greet from Bob", (t) => t.replace("Hello from dCode", "Hello from Bob"))
  await expect(bob.page.locator("#work-head .branch")).toHaveText("bob/main")
  await expect(branchRows(bob.page)).toHaveCount(2)
  await expect(branchRows(alice.page)).toHaveCount(2)
  await expect(branchRows(alice.page).nth(1)).toContainText("bob/main")
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(head(alice.page)).toHaveText(mainHead)

  // Bob proposes his branch into main. The pull request is a node he owns.
  await bob.page.locator('#pr-form [name="title"]').fill("Greet from Bob")
  await bob.page.locator('#pr-form button[type="submit"]').click()
  await expect(prRows(bob.page)).toHaveCount(1)
  await expect(prRows(alice.page)).toHaveCount(1)
  await expect(prRows(alice.page).first()).toContainText("open")
  await expect(bob.page.locator('[data-act="merge"]')).toHaveCount(0) // not his branch to merge into
  await expect(alice.page.locator('[data-act="merge"]')).toHaveCount(1)

  // Bob commits again: the proposal is behind his head, and he brings it up to date.
  const second = await commit(bob, "A second line", (t) => t.replace("</main>", "  <p>Second line from Bob</p>\n</main>"))
  await expect(rows(alice.page)).toHaveCount(3)
  await expect(prRows(alice.page).first()).toContainText("open, behind") // the proposal still points at Bob's first commit
  await bob.page.locator('[data-act="update-pr"]').click()
  await expect(prRows(alice.page).first()).toHaveText(/open(?!, behind)/)
  await expect(prRows(alice.page).first()).toContainText(second)

  // A tampered client: Bob writes Alice's branch node with his own head, past the app. His own
  // graph believes him; every receiver refuses it. The proof is not silence: Bob's next commit lands.
  const bobBranch = await bob.page.locator("#branches li.sel").getAttribute("data-branch")
  const outcome = await bob.page.evaluate(async ([mainId, bobBranchId]) => {
    const { result: main } = await globalThis.db.get(mainId), { result: mine } = await globalThis.db.get(bobBranchId)
    try { await globalThis.db.put({ ...main.value, head: mine.value.head }, mainId); return "applied locally" } catch (e) { return `refused: ${e.message}` }
  }, [main, bobBranch])
  console.log("tampered write:", outcome)
  const third = await commit(bob, "A third line", (t) => t.replace("</main>", "  <p>Third line from Bob</p>\n</main>"))
  await expect(rows(alice.page)).toHaveCount(4) // the sentinel: Bob's later write arrived
  await expect(head(alice.page)).toHaveText(mainHead) // and main did not move
  await expect(rows(alice.page).first()).toContainText(third)

  // Alice merges what was proposed — Bob's second commit. Main's head is its ancestor: a fast-forward.
  await alice.page.locator('[data-act="merge"]').click()
  await expect(alice.page.locator("#notice")).toContainText("Fast-forwarded main")
  await expect(head(alice.page)).toHaveText(`@ ${second}`)
  await expect(prRows(alice.page).first()).toContainText("merged")
  await expect(prRows(bob.page).first()).toContainText("merged") // Alice's write, newer than his lie, corrected Bob's graph too
  await expect(preview(alice.page)).toContainText("Second line from Bob") // main's head runs on Alice now
  await expect(preview(alice.page)).not.toContainText("Third line from Bob")
  await expect(rows(alice.page).nth(1)).toContainText("main") // the chips: main sits on the second commit, bob/main on the third
  await expect(rows(alice.page).first()).toContainText("bob/main")

  await assertTransport(bob)
  await alice.close(); await bob.close()
})

test("a collaborator granted write moves the head directly; revoked, they are back to forking", async ({ browser }) => {
  const room = freshRoom("collab")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "team")
  await alice.page.locator('#collab-form [name="address"]').fill(ADDR.bob)
  await alice.page.locator('#collab-form button[type="submit"]').click()
  await expect(alice.page.locator("#collabs li")).toContainText("bob")
  await expect(alice.page.locator("#collabs li")).toContainText("write")

  await go(bob, `#/r/${repo}`)
  await expect(bob.page.locator("#commit-btn")).toHaveText("Commit to main")
  const id = await commit(bob, "Bob, on main", (t) => t.replace("Hello from dCode", "Hello from the team"))
  await expect(head(alice.page)).toHaveText(`@ ${id}`) // main moved, by Bob, and Alice's page followed
  await expect(branchRows(alice.page)).toHaveCount(1) // no fork was needed
  await expect(preview(alice.page)).toContainText("Hello from the team")

  await alice.page.locator('[data-act="revoke"]').click()
  await expect(alice.page.locator("#collabs li")).toContainText("nobody else")
  await expect(bob.page.locator("#commit-btn")).toHaveText("Fork and commit")
  await alice.close(); await bob.close()
})
