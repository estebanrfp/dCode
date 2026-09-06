/**
 * A repository is a node its owner owns; a commit is a node its author owns,
 * named by the author's address and a hash of what it holds; every commit is
 * a whole page and runs. Two visitors, real WebRTC between them.
 */
import { expect, test } from "@playwright/test"
import { assertTransport, commit, commitIds, connected, createRepo, freshRoom, go, head, loginAs, preview, rows, short, visitor } from "./_helpers.js"

test("a repository and its commits cross to another visitor, with the same ids, and every version runs", async ({ browser }) => {
  const room = freshRoom("repo")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)

  const { repo } = await createRepo(alice, "hello-world", "The first repository in this room")
  await expect(alice.page.locator("#work-head .branch")).toHaveText("main")
  await expect(rows(alice.page).first()).toContainText("Initial commit")
  await expect(preview(alice.page)).toContainText("Hello from dCode") // the head runs on arrival

  const second = await commit(alice, "Greet by name", (t) => t.replace("Hello from dCode", "Hello, Bob, from dCode"))
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(rows(alice.page).first()).toContainText("Greet by name")
  await expect(head(alice.page)).toHaveText(`@ ${second}`)
  await expect(preview(alice.page)).toContainText("Hello, Bob, from dCode")
  // The commit's id carries its author: nobody else can create it, on any peer.
  const ids = await commitIds(alice.page)
  expect(ids[0].startsWith(`${alice.address}:`)).toBe(true)
  expect(short(ids[0])).toBe(second)

  // Bob: the repository in the list, the two commits under the same ids, the head running.
  await go(bob, "#/")
  await expect(bob.page.locator(".repos .name")).toHaveText("hello-world")
  await expect(bob.page.locator(".repos li")).toContainText("2 commits")
  await bob.page.locator(".repos .name").click()
  await expect(bob.page).toHaveURL(new RegExp(`#/r/${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  await expect(rows(bob.page)).toHaveCount(2)
  expect(await commitIds(bob.page)).toEqual(ids)
  await expect(preview(bob.page)).toContainText("Hello, Bob, from dCode")
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

test("the working copy is this device's: it survives a navigation, and Discard returns to the head", async ({ browser }) => {
  const room = freshRoom("draft")
  const alice = await visitor(browser, room)
  await loginAs(alice, "alice")
  const { repo, branch } = await createRepo(alice, "drafts")
  const ed = alice.page.locator("#editor")
  await ed.fill((await ed.inputValue()).replace("Hello from dCode", "Work in progress"))
  await expect(alice.page.locator("#work-head .dirty")).toHaveText("· uncommitted changes")
  await go(alice, "#/")
  await go(alice, `#/r/${repo}/${branch}`)
  await expect(ed).toHaveValue(/Work in progress/) // still here: the draft is on this device
  await alice.page.locator('[data-act="discard"]').click()
  await expect(ed).toHaveValue(/Hello from dCode/)
  await expect(alice.page.locator("#work-head .dirty")).toHaveCount(0)
  await alice.close()
})
