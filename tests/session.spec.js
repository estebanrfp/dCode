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

test("the prompt belongs to a repository, and New is a dialog over the index", async ({ browser }) => {
  const room = freshRoom("chrome")
  const alice = await visitor(browser, room)
  await loginAs(alice, "Alice")
  await createRepo(alice, "with-a-prompt") // the helper waits for #new-modal: New is a dialog, not a page
  await expect(alice.page.locator("#agent")).toBeVisible() // inside a repository, the prompt has something to edit
  await expect(alice.page.locator("#new-modal")).toBeHidden() // and the dialog did not follow us in
  await go(alice, "#/")
  await expect(alice.page.locator("#agent")).toBeHidden() // outside one, it has nothing, so it is not there
  await expect(alice.page.locator(".repos-page")).toBeVisible()
  await alice.close()
})

test("the identity is a panel: the calendar arrives on demand and counts what this identity signed", async ({ browser }) => {
  const room = freshRoom("activity")
  const alice = await visitor(browser, room)
  await loginAs(alice, "Alice")
  await createRepo(alice, "counted")
  await go(alice, "#/session")
  await expect(alice.page.locator(".session-page .identity")).toBeVisible()
  await expect(alice.page.locator(".cal-grid .cal-day")).toHaveCount(371) // 53 weeks, seven days each
  await expect(alice.page.locator(".cal-total")).toContainText("1 commit in the last year") // the repository's first commit
  await expect(alice.page.locator(".cal-grid .cal-day:not(.l0)")).toHaveCount(1) // and it lands on today
  await expect(alice.page.locator(".tallies dd").first()).toHaveText("1")
  await alice.close()
})

test("a star is a node its author owns: it crosses, it counts once per person, and taking it back removes it", async ({ browser }) => {
  const room = freshRoom("stars")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "Alice"); await loginAs(bob, "Bob")
  const { repo } = await createRepo(alice, "starred")
  await go(alice, "#/"); await go(bob, "#/")
  const star = bob.page.locator(`[data-act="star"][data-repo="${repo}"]`)
  await expect(star).toHaveText("★ 0")
  await star.click()
  await expect(star).toHaveText("★ 1")
  await expect(alice.page.locator(`[data-act="star"][data-repo="${repo}"]`)).toHaveText("★ 1") // it crossed
  await star.click() // taken back
  await expect(star).toHaveText("★ 0")
  await expect(alice.page.locator(`[data-act="star"][data-repo="${repo}"]`)).toHaveText("★ 0")
  await alice.close(); await bob.close()
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

test("a name is a label you sign: it reaches every peer, and nobody can write another's", async ({ browser }) => {
  const room = freshRoom("names")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "Alice"); await loginAs(bob, "Bob")
  await createRepo(alice, "named", "Whose commits are these")

  // Alice writes her own `user:` node. It is the one node the engine ties to her key.
  await go(alice, "#/session")
  await expect(alice.page.locator('#name-form [name="name"]')).toHaveValue("Alice") // the name in force arrives in the field: a demo identity comes named by the constitution
  await alice.page.locator('#name-form [name="name"]').fill("Ada")
  await alice.page.locator('#name-form button[type="submit"]').click()
  await expect(alice.page.locator("#session-addr")).toContainText("Ada")
  // The write comes back through the subscription and redraws the page: the
  // outcome is in the toast stack, which lives outside it, so it is still there.
  await expect(alice.page.locator("#toasts .toast").last()).toContainText("You are Ada on every peer")

  // It travels: Bob reads her commit under the name she signed, not her address.
  await go(bob, "#/")
  await expect(bob.page.locator(".repos .by")).toHaveText("by Ada")

  // A tampered client writes Bob's node with a name of Alice's choosing. Her own
  // graph takes it — that is what a modified peer can always do to itself — and
  // every honest peer refuses it: Bob is still Bob, on his screen and on hers.
  await alice.page.evaluate(async (bobAddr) => {
    try { await globalThis.db.put({ ethAddress: bobAddr, role: "guest", name: "Impostor" }, `user:${bobAddr}`) } catch {}
  }, ADDR.bob)
  await go(bob, "#/session")
  await expect(bob.page.locator("#session-addr")).toContainText("Bob")
  await expect(bob.page.locator('#name-form [name="name"]')).toHaveValue("Bob") // his own node, untouched: the name the constitution gave him
  await expect(bob.page.locator("#session-addr")).not.toContainText("Impostor")

  // And the gate holds the role: the name is the only thing that moved.
  await go(alice, "#/session")
  await expect(alice.page.locator("#unlocked-by")).toBeVisible()
  await expect(alice.page.locator(".facts")).toContainText("guest")
  await alice.close(); await bob.close()
})

test("the search is a query the engine answers: it folds accents, and its results stay live", async ({ browser }) => {
  const room = freshRoom("search")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "Alice"); await loginAs(bob, "Bob")
  await createRepo(alice, "morning", "Un sitio para el café de la mañana")
  await createRepo(alice, "evening", "Nothing to do with it")
  await go(bob, "#/")
  await expect(bob.page.locator(".repos li")).toHaveCount(2)

  // `$text` folds the accent and the case, per field: nothing in the app does this.
  await bob.page.locator("#repo-search").fill("CAFE")
  await expect(bob.page.locator(".repos li")).toHaveCount(1)
  await expect(bob.page.locator(".repos .name")).toHaveText("morning")

  // The query is a subscription: what Alice creates now enters Bob's results by itself.
  await createRepo(alice, "cafeteria", "Another one")
  await expect(bob.page.locator(".repos li")).toHaveCount(2)
  await expect(bob.page.locator(".repos .name").first()).toHaveText("cafeteria")

  // And what stops matching leaves them: Alice renames hers out of the search.
  await go(alice, "#/")
  await alice.page.locator(".repos .name").filter({ hasText: "cafeteria" }).click()
  await alice.page.locator("#edit-repo").click()
  await alice.page.locator('#repo-form [name="name"]').fill("tea-room")
  await alice.page.locator('#repo-form [name="description"]').fill("No coffee here")
  await alice.page.locator('#repo-form button[type="submit"]').click()
  await expect(bob.page.locator(".repos li")).toHaveCount(1)

  await bob.page.locator("#repo-search").fill("")
  await expect(bob.page.locator(".repos li")).toHaveCount(3)
  await alice.close(); await bob.close()
})

test("the list is a window that grows at the end of the column, and «Newest» is the engine's own order, paged with its cursor", async ({ browser }) => {
  const room = freshRoom("window")
  const alice = await visitor(browser, room)
  await loginAs(alice, "Alice")
  // Twenty-six repositories, written as the app writes them, so the list is longer than a page.
  await alice.page.evaluate(async () => {
    for (let i = 0; i < 26; i++)
      await globalThis.db.sm.acls.set({ type: "repo", name: `project-${String(i).padStart(2, "0")}`, description: `Number ${i}`, at: Date.now() + i })
  })
  await go(alice, "#/")
  const cards = alice.page.locator(".repos li"), column = alice.page.locator(".repos-page .results")
  await expect(cards).toHaveCount(24)                                     // a page of the list, not the whole room
  await expect(alice.page.locator(".results-count")).toContainText("26 repositories") // which says what the room holds
  await column.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await expect(cards).toHaveCount(26)                                     // the end of the column asked for the rest

  // Under «Newest» the pages are the engine's: its order, and its cursor for the next one.
  await alice.page.locator('[data-sort="new"]').click()
  await expect(cards).toHaveCount(24)
  await expect(alice.page.locator(".repos .name").first()).toHaveText("project-25")
  await column.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await expect(cards).toHaveCount(26)
  await expect(alice.page.locator(".repos .name").last()).toHaveText("project-00") // the second page, after the cursor
  await alice.close()
})

test("the door fills the room: the example projects are written from this browser, as anyone writes them", async ({ browser }) => {
  const room = freshRoom("seed")
  const alice = await visitor(browser, room)
  await alice.page.locator("#identity-modal[open]").waitFor()
  await alice.page.locator("#seed-btn").click()
  // It signs itself in — the door closes the moment a session starts — and the room fills.
  await expect(alice.page.locator("#session-addr")).toContainText(/Alice|Bob/)
  await expect(alice.page.locator(".repos li").first()).toBeVisible({ timeout: 60_000 })
  await expect(alice.page.locator("#toasts")).toContainText(/projects are in this room/, { timeout: 120_000 })
  await expect(alice.page.locator(".results-count")).toContainText("200 repositories")
  await expect(alice.page.locator(".repos li")).toHaveCount(24) // a page of them: the list is a window
  // What it wrote is what the New form writes: a repository with its file in the buffer.
  await alice.page.locator(".repos .name").first().click()
  await expect(alice.page.locator("#buffer .line").first()).toBeVisible({ timeout: 30_000 })
  await expect(alice.page.locator("#head-label")).toHaveText(/@ [0-9a-f]{7}/)
  await alice.close()
})
