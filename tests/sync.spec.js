/**
 * A commit made with no peer in sight is a commit: it waits on this device's
 * disk, with the buffer that produced it, and reaches the room when a path
 * exists, signed like any other.
 */
import { expect, test } from "@playwright/test"
import { DEAD_RELAY, TEMPLATE_LINES, alone, assertTransport, commit, commitIds, connected, createRepo, freshRoom, go, lines, loginAs, persisted, rejoin, rows, seesLine, setLine, visitor } from "./_helpers.js"

test("a repository and a commit made alone reach a visitor once the device comes back", async ({ browser }) => {
  const room = freshRoom("offline")
  const alice = await visitor(browser, room, { relay: DEAD_RELAY }), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await alone(alice); await alone(bob)

  const { repo } = await createRepo(alice, "written-alone", "No peer was in sight")
  await setLine(alice, "Hello from dCode", "  <h1>Written with nobody around</h1>")
  await commit(alice, "Still alone")
  await expect(rows(alice.page)).toHaveCount(2)
  const ids = await commitIds(alice.page)
  await persisted(alice, "Written with nobody around")

  await rejoin(alice, `#/r/${repo}`)
  await connected(alice); await connected(bob)
  await expect(rows(alice.page)).toHaveCount(2) // the device's own graph, back from disk
  await expect(lines(alice.page)).toHaveCount(TEMPLATE_LINES)
  await go(bob, "#/")
  await expect(bob.page.locator(".repos .name")).toHaveText("written-alone")
  await go(bob, `#/r/${repo}`)
  await expect(rows(bob.page)).toHaveCount(2)
  expect(await commitIds(bob.page)).toEqual(ids)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)
  await seesLine(bob, "Written with nobody around")
  await expect(bob.page.frameLocator("#preview").locator("body")).toContainText("Written with nobody around")
  await assertTransport(bob)
  await alice.close(); await bob.close()
})
