/**
 * The identity view behind the session pill, and the theme toggle. A session
 * opened with a phrase still holds its key: a passkey can take it here, not
 * only at onboarding — the gap the design guide closed with this app.
 */
import { expect, test } from "@playwright/test"
import { ADDR, createRepo, dismissDoor, door, freshRoom, go, loginAs, virtualAuthenticator, visitor } from "./_helpers.js"

test("a phrase session is protected with a passkey from the identity view; the passkey resumes it after a reload", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("session"))
  await virtualAuthenticator(v)
  await loginAs(v, "alice")
  await expect(v.page).toHaveURL(/#\/session$/) // a sign-in with nowhere to go lands on the identity view
  const page = v.page.locator(".session-page")
  await expect(page.locator("#my-address")).toHaveText(ADDR.alice)
  await expect(page.locator("#unlocked-by")).toHaveText("mnemonic")
  await expect(page.locator("#protect-btn")).toBeVisible()
  await page.locator("#protect-btn").click()
  await expect(page.locator("#unlocked-by")).toHaveText("passkey")
  await expect(page.locator("#protect-btn")).toHaveCount(0)
  await expect(v.page.locator("#session-addr")).toContainText("Alice")

  await v.page.reload()
  await expect(v.page.locator("#session-addr")).toContainText("Alice") // resumed silently, no phrase typed, no door
  await expect(door(v.page)).not.toHaveAttribute("open", "")
  await v.page.locator("#session-addr").click()
  await expect(v.page.locator("#unlocked-by")).toHaveText("passkey")
  await v.page.locator("#signout-btn").click()
  await expect(v.page.locator("#session-addr")).toBeHidden() // signed out: the spot is empty and the door is open
  await expect(door(v.page)).toHaveAttribute("open", "")
  await expect(v.page.locator("#passkey-login-btn")).toBeVisible() // this browser holds a registration
  await v.page.locator("#passkey-login-btn").click()
  await expect(v.page.locator("#session-addr")).toContainText("Alice")
  await expect(door(v.page)).not.toHaveAttribute("open", "")
  await v.close()
})

test("the theme toggle cycles system → light → dark and the choice survives a reload", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("theme"), { colorScheme: "dark" })
  const root = v.page.locator("html")
  await dismissDoor(v) // reading needs no identity: the door steps aside
  await expect(root).toHaveAttribute("data-pref", "system")
  await expect(root).toHaveAttribute("data-theme", "dark")
  await v.page.locator("#theme-btn").click()
  await expect(root).toHaveAttribute("data-pref", "light")
  await expect(root).toHaveAttribute("data-theme", "light")
  await v.page.locator("#theme-btn").click()
  await expect(root).toHaveAttribute("data-pref", "dark")
  await expect(root).toHaveAttribute("data-theme", "dark")
  await v.page.reload()
  await expect(root).toHaveAttribute("data-pref", "dark") // before the first paint, from localStorage
  await dismissDoor(v)
  await v.page.locator("#theme-btn").click()
  await expect(root).toHaveAttribute("data-pref", "system")
  await v.page.emulateMedia({ colorScheme: "light" })
  await expect(root).toHaveAttribute("data-theme", "light") // on `system`, the OS decides
  await v.close()
})

test("delete my repositories, for testing: what is yours goes on every peer; a visitor who owns nothing has no such button", async ({ browser }) => {
  const room = freshRoom("delete-mine")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "Alice"); await loginAs(bob, "Bob")
  await createRepo(alice, "throwaway")
  await go(bob, "#/")
  await expect(bob.page.locator(".repos li")).toHaveCount(1) // Bob holds it
  await expect(bob.page.locator('[data-act="delete-mine"]')).toHaveCount(0) // and owns nothing to delete
  await go(alice, "#/")
  await alice.page.locator('[data-act="delete-mine"]').click()
  await expect(alice.page.locator('[data-act="delete-mine"]')).toHaveText("Delete them, really?")
  await alice.page.locator('[data-act="delete-mine"]').click()
  await expect(alice.page.locator("#toasts")).toContainText("Your repositories are gone")
  await expect(alice.page.locator(".repos li")).toHaveCount(0)
  await expect(bob.page.locator(".repos li")).toHaveCount(0) // gone on the other side of the wire
  await expect(alice.page).toHaveURL(new RegExp(`room=${room}`)) // the URL never changes: the room is not the user's business
  await alice.close(); await bob.close()
})
