/**
 * Branch protection with no server: everyone edits the buffer, but a head
 * moves only for the branch's owner and the addresses granted `write`;
 * anyone else commits to a branch of their own and proposes. The negative is
 * proved against a later write that lands, never against silence.
 */
import { expect, test } from "@playwright/test"
import { ADDR, assertTransport, branchRows, commit, connected, createRepo, freshRoom, go, head, loginAs, preview, prRows, rows, seesLine, setLine, tab, visitor } from "./_helpers.js"

test("a fork, a pull request and a fast-forward merge; a tampered client cannot move another's head", async ({ browser }) => {
  const room = freshRoom("fork")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo, branch: main } = await createRepo(alice, "shared", "Alice's repository")
  const mainHead = await head(alice.page).textContent()

  // Bob edits the shared buffer of main — anyone may — but cannot move main:
  // his commit goes to a branch of his own, forked from where he stood.
  await go(bob, `#/r/${repo}`)
  await expect(rows(bob.page)).toHaveCount(1)
  await expect(bob.page.locator("#commit-btn")).toHaveText("Fork and commit")
  await setLine(bob, "Hello from dCode", "  <h1>Hello from Bob</h1>")
  await seesLine(alice, "Hello from Bob") // the shared buffer, on Alice's screen too
  await commit(bob, "Greet from Bob")
  await expect(bob.page.locator("#branch-select")).toHaveValue(/./)
  await expect(bob.page.locator("#branch-select option:checked")).toHaveText(/Bob\/main/)
  await expect(branchRows(bob.page)).toHaveCount(2)
  await expect(branchRows(alice.page)).toHaveCount(2)
  await expect(branchRows(alice.page).nth(1)).toContainText("Bob/main")
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(head(alice.page)).toHaveText(mainHead)
  // Main's buffer still holds Bob's edit, uncommitted; Alice discards it and main is clean.
  await expect(alice.page.locator("#dirty")).toBeVisible()
  await alice.page.locator("#discard").click()
  await expect(alice.page.locator("#dirty")).toBeHidden()
  await seesLine(alice, "Hello from dCode")

  // Bob proposes his branch into main. The pull request is a node he owns.
  await tab(bob, "pulls")
  await bob.page.locator('#pr-form [name="title"]').fill("Greet from Bob")
  await bob.page.locator('#pr-form button[type="submit"]').click()
  await expect(prRows(bob.page)).toHaveCount(1)
  await expect(prRows(alice.page)).toHaveCount(1)
  await expect(prRows(alice.page).first()).toContainText("open")
  await expect(bob.page.locator('[data-act="merge"]')).toHaveCount(0) // not his branch to merge into
  await expect(alice.page.locator('[data-act="merge"]')).toHaveCount(1)

  // Bob commits again: the proposal is behind his head, and he brings it up to date.
  await setLine(bob, "This page is one commit", "  <p>Second line from Bob</p>")
  const second = await commit(bob, "A second line")
  await expect(rows(alice.page)).toHaveCount(3)
  await expect(prRows(alice.page).first()).toContainText("open, behind")
  await bob.page.locator('[data-act="update-pr"]').click()
  await expect(prRows(alice.page).first()).toHaveText(/open(?!, behind)/)
  await expect(prRows(alice.page).first()).toContainText(second)

  // A tampered client: Bob writes Alice's branch node with his own head, past the app. His own
  // graph believes him; every receiver refuses it. The proof is not silence: Bob's next commit lands.
  const bobBranch = await bob.page.locator("#branch-select").inputValue()
  const outcome = await bob.page.evaluate(async ([mainId, bobBranchId]) => {
    const { result: main } = await globalThis.db.get(mainId), { result: mine } = await globalThis.db.get(bobBranchId)
    try { await globalThis.db.put({ ...main.value, head: mine.value.head }, mainId); return "applied locally" } catch (e) { return `refused: ${e.message}` }
  }, [main, bobBranch])
  console.log("tampered write:", outcome)
  await setLine(bob, 'id="count"', '  <button id="count">Third from Bob</button>')
  const third = await commit(bob, "A third line")
  await expect(rows(alice.page)).toHaveCount(4) // the sentinel: Bob's later write arrived
  await expect(head(alice.page)).toHaveText(mainHead) // and main did not move
  await expect(rows(alice.page).first()).toContainText(third)

  // Alice merges what was proposed — Bob's second commit. Main's head is its ancestor: a fast-forward,
  // and main's shared buffer follows the new head.
  await tab(alice, "pulls")
  await alice.page.locator('[data-act="merge"]').click()
  await expect(alice.page.locator("#notice")).toContainText("Fast-forwarded main")
  await expect(head(alice.page)).toHaveText(`@ ${second}`)
  await expect(prRows(alice.page).first()).toContainText("merged")
  await expect(prRows(bob.page).first()).toContainText("merged") // Alice's write, newer than his lie, corrected Bob's graph too
  await seesLine(alice, "Second line from Bob")
  await expect(alice.page.locator("#dirty")).toBeHidden()
  await expect(preview(alice.page)).toContainText("Second line from Bob")
  await expect(preview(alice.page)).not.toContainText("Third from Bob")
  await tab(alice, "history")
  await expect(rows(alice.page).nth(1)).toContainText("main") // the chips: main sits on the second commit, bob/main on the third
  await expect(rows(alice.page).first()).toContainText("Bob/main")

  await assertTransport(bob)
  await alice.close(); await bob.close()
})

test("a collaborator granted write moves the head directly; revoked, they are back to forking", async ({ browser }) => {
  const room = freshRoom("collab")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "team")
  await tab(alice, "branches")
  await alice.page.locator('#collab-form [name="address"]').fill(ADDR.bob)
  await alice.page.locator('#collab-form button[type="submit"]').click()
  await expect(alice.page.locator("#collabs li")).toContainText("Bob")
  await expect(alice.page.locator("#collabs li")).toContainText("write")

  await go(bob, `#/r/${repo}`)
  await expect(bob.page.locator("#commit-btn")).toHaveText("Commit to main")
  await setLine(bob, "Hello from dCode", "  <h1>Hello from the team</h1>")
  const id = await commit(bob, "Bob, on main")
  await expect(head(alice.page)).toHaveText(`@ ${id}`) // main moved, by Bob, and Alice's page followed
  await expect(branchRows(alice.page)).toHaveCount(1) // no fork was needed
  await expect(preview(alice.page)).toContainText("Hello from the team")

  await alice.page.locator('[data-act="revoke"]').click()
  await expect(alice.page.locator("#collabs li")).toContainText("nobody else")
  await expect(bob.page.locator("#commit-btn")).toHaveText("Fork and commit")
  await alice.close(); await bob.close()
})

test("a branch you own can be deleted — asked twice — and its lines go with it everywhere; main and other people's branches offer no such thing", async ({ browser }) => {
  const room = freshRoom("delete")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "prune")
  await tab(alice, "branches")
  await alice.page.locator('#branch-form [name="name"]').fill("scratch")
  await alice.page.locator('#branch-form button[type="submit"]').click()
  await expect(alice.page.locator("#branch-select option:checked")).toHaveText("scratch")
  await go(bob, `#/r/${repo}`); await tab(bob, "branches")
  await expect(branchRows(bob.page)).toHaveCount(2)
  await expect(bob.page.locator('[data-act="delete-branch"]')).toHaveCount(0) // not his branches
  await tab(alice, "branches")
  await expect(alice.page.locator('[data-act="delete-branch"]')).toHaveCount(1) // scratch, never main
  await alice.page.locator('[data-act="delete-branch"]').click()
  await expect(alice.page.locator('[data-act="delete-branch"]')).toHaveText("Delete, really?")
  await alice.page.locator('[data-act="delete-branch"]').click()
  await expect(alice.page.locator("#notice")).toContainText("Deleted scratch")
  await expect(alice.page.locator("#branch-select option:checked")).toHaveText("main") // she stood on it: back to main
  await expect(branchRows(alice.page)).toHaveCount(1)
  await expect(branchRows(bob.page)).toHaveCount(1) // gone on the other side of the wire too
  await alice.close(); await bob.close()
})

