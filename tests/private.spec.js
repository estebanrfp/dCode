/**
 * A private repository: the engine keeps the key, the app seals the code.
 * The vault is one encrypted node; a member is an envelope on it; every line
 * and every commit is ciphertext to anyone else — at rest, on the wire, and
 * to the authority itself. A revocation turns the key.
 */
import { expect, test } from "@playwright/test"
import { ADDR, commit, connected, createRepo, freshRoom, go, inStore, lines, loginAs, persisted, preview, rows, seesLine, setLine, tab, visitor } from "./_helpers.js"

test("a private repository is sealed for everyone but its members; a grant opens it, a revocation turns the key, and the owner reads it back after a reload", async ({ browser }) => {
  const room = freshRoom("private")
  const alice = await visitor(browser, room), bob = await visitor(browser, room), authority = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob"); await loginAs(authority, "constitution")
  await connected(alice); await connected(bob); await connected(authority)

  // The owner: a repository like any other, with a lock on it and a vault behind it.
  const { repo } = await createRepo(alice, "vault", "Alice's private repository", { isPrivate: true })
  await expect(alice.page.locator("#repo-lock")).toBeVisible()
  await setLine(alice, "Hello from dCode", "  <h1>Secret from Alice</h1>")
  const first = await commit(alice, "Sealed commit")
  await expect(preview(alice.page)).toContainText("Secret from Alice") // the owner runs her own code
  await tab(alice, "branches")
  await expect(alice.page.locator("#members li")).toHaveCount(1)
  await expect(alice.page.locator("#members li").first()).toContainText("owner")

  // The authority itself holds no envelope: the door, and ciphertext on its disk. The commit's
  // message is plaintext by design, so its arrival proves the node crossed — the code did not.
  await go(authority, `#/r/${repo}`)
  await expect(authority.page.locator(".locked")).toContainText("has not granted this identity")
  await expect(lines(authority.page)).toHaveCount(0)
  await persisted(authority, "Sealed commit")
  expect(await inStore(authority, "Secret from Alice")).toBe(false)
  expect(await inStore(authority, "Hello from dCode")).toBe(false) // the seeded lines were sealed too

  // A grant: the engine wraps the key for Bob, and his page opens on its own.
  await go(bob, `#/r/${repo}`)
  await expect(bob.page.locator(".locked")).toBeVisible()
  await alice.page.locator('#member-form [name="address"]').fill(ADDR.bob)
  await alice.page.locator('#member-form button[type="submit"]').click()
  await expect(alice.page.locator("#notice")).toContainText("bob holds the key now")
  await expect(alice.page.locator("#members li")).toHaveCount(2)
  await expect(alice.page.locator("#members li").nth(1)).toContainText("bob")
  await expect(bob.page.locator("#buffer")).toBeVisible()
  await seesLine(bob, "Secret from Alice")
  await expect(rows(bob.page)).toHaveCount(2)
  await expect(preview(bob.page)).toContainText("Secret from Alice")

  // A member writes: sealed lines reach the other member in clear, and stay ciphertext elsewhere.
  await setLine(bob, "This page is one commit", "  <p>Bob was here</p>")
  await seesLine(alice, "Bob was here")
  const second = await commit(bob, "From Bob") // a fork: read is not write
  await expect(rows(alice.page)).toHaveCount(3)
  await persisted(authority, "From Bob")
  expect(await inStore(authority, "Bob was here")).toBe(false)

  // The revocation: the engine turns the vault's key and the app turns the repository's.
  // Bob's page closes on its own, and what Alice writes afterwards never opens for him.
  await alice.page.locator('[data-act="revoke-member"]').click()
  await expect(alice.page.locator("#members li")).toHaveCount(1)
  await expect(bob.page.locator(".locked")).toBeVisible()
  await alice.page.locator("#branch-select").selectOption({ label: "main" })
  await setLine(alice, 'id="count"', '  <button id="count">After the revocation</button>')
  await commit(alice, "Sealed again")
  await persisted(bob, "Sealed again")
  expect(await inStore(bob, "After the revocation")).toBe(false)
  expect(await inStore(bob, "Secret from Alice")).toBe(false) // his disk never held the code in clear

  // The owner comes back: no session, the door; signed in again, the vault opens what the disk kept.
  await alice.page.reload(); await go(alice, `#/r/${repo}`) // a real reload: the phrase session lives in memory
  await expect(alice.page.locator(".locked")).toContainText("Sign in")
  await loginAs(alice, "alice")
  await go(alice, `#/r/${repo}`)
  await seesLine(alice, "After the revocation")
  await expect(rows(alice.page)).toHaveCount(4)
  await expect(rows(alice.page).first()).toContainText("Sealed again")
  await expect(preview(alice.page)).toContainText("After the revocation")
  expect(await inStore(alice, "Secret from Alice")).toBe(false) // nor did the owner's: the code is opened in memory, never written back
  expect(first).not.toBe(second)
  await alice.close(); await bob.close(); await authority.close()
})
