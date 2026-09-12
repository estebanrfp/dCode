/**
 * Presence: which repository each window has open, right now. It rides the
 * ephemeral channel the carets ride — never a write — so the number must be
 * true in both directions: it appears when someone walks in, and it goes when
 * they leave the repository, and when they close the window. The announcement
 * is signed: a dot carries the name of the session that sent it, verified by
 * the peer that draws it, and so does the caret that follows; a window with
 * no session is counted and named nobody.
 */
import { expect, test } from "@playwright/test"
import { connected, createRepo, dismissDoor, freshRoom, go, lineWith, loginAs, visitor } from "./_helpers.js"

const card = (page, repo) => page.locator(`#repo-list [data-here="${repo}"]`)
const bar = (page) => page.locator(".repo-bar .here")

test("a repository says who is inside it, from the index and from its own bar", async ({ browser }) => {
  const room = freshRoom("presence")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)

  await go(bob, "#/") // Bob reads the index while Alice works
  const { repo } = await createRepo(alice, "where-is-everyone", "Presence, on the wire")
  await expect(card(bob.page, repo)).toHaveText("1 here") // Alice walked in: one window, and it is not Bob's
  await expect(card(bob.page, repo).locator(".dot")).toHaveCount(1)
  await expect(card(bob.page, repo).locator(".dot.you")).toHaveCount(0)
  await expect(card(bob.page, repo).locator(".dot")).toHaveAttribute("title", "Alice") // her window signed the announcement; Bob's verified it
  await expect(bar(alice.page)).toHaveText("1 here") // her own bar counts her
  await expect(bar(alice.page).locator(".dot.you")).toHaveCount(1)

  await go(alice, "#/") // she steps out to the index: nobody is in there now
  await expect(card(bob.page, repo)).toBeHidden()
  await expect(card(alice.page, repo)).toBeHidden()

  await go(alice, `#/r/${repo}`)
  await expect(card(bob.page, repo)).toHaveText("1 here")
  await go(bob, `#/r/${repo}`) // both inside: each bar counts two, and one of the dots is its own
  await expect(bar(bob.page)).toHaveText("2 here")
  await expect(bar(bob.page).locator(".dot")).toHaveCount(2)
  await expect(bar(bob.page).locator(".dot.you")).toHaveCount(1)
  await expect(bar(bob.page).locator(".dot:not(.you)")).toHaveAttribute("title", "Alice")
  await expect(bar(alice.page)).toHaveText("2 here")
  await expect(bar(alice.page).locator(".dot:not(.you)")).toHaveAttribute("title", "Bob")

  await (await lineWith(alice.page, "Hello from dCode")).click() // her caret, unsigned, lands under the name her announcement proved
  await expect(bob.page.locator(".caret-label")).toHaveText("Alice")

  const carol = await visitor(browser, room) // no session: counted, named nobody
  await dismissDoor(carol)
  await go(carol, `#/r/${repo}`)
  await expect(bar(bob.page)).toHaveText("3 here")
  await expect(bar(bob.page).locator(".dot:not([title])")).toHaveCount(1)
  await carol.close()

  await go(bob, "#/") // Bob leaves the repository, Alice stays
  await expect(bar(alice.page)).toHaveText("1 here")
  await expect(card(bob.page, repo)).toHaveText("1 here")

  await alice.close() // the window is gone, not just the route: the room notices
  await expect(card(bob.page, repo)).toBeHidden()
  await bob.close()
})
