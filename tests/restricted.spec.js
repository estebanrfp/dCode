/**
 * The constitution's one power: the authority restricts an identity, with its
 * signature. A restricted identity reads and syncs — its identity view says
 * so, its buffer is read-only, its commit button is closed — and a write of
 * its own, even from a tampered client, is refused on every peer; what it
 * wrote before stays. Lifted, it is a guest again and writes.
 */
import { expect, test } from "@playwright/test"
import { ADDR, connected, createRepo, freshRoom, go, lines, loginAs, persisted, seesLine, setLine, visitor } from "./_helpers.js"

// The graph, not the screen: a keystroke is painted over the channel at once, the write lands later, and a role is judged by the receiver when the write arrives.
const roleOn = (v, addr) => v.page.evaluate((id) => globalThis.db.get(id).then((r) => r.result?.value.role ?? "guest"), `user:${addr}`)
const textOf = (v, id) => v.page.evaluate((id) => globalThis.db.get(id).then((r) => r.result?.value.text), id)
const lineIdWith = (v, repo, text) => v.page.evaluate(async ([repo, text]) => (await globalThis.db.map({ query: { type: "line", repo } })).results.find((n) => n.value.text?.includes(text))?.id ?? null, [repo, text])

test("the authority restricts an identity: its page says so, its buffer closes, a tampered write is refused everywhere; lifted, it writes again", async ({ browser }) => {
  const room = freshRoom("restricted")
  const alice = await visitor(browser, room), bob = await visitor(browser, room), authority = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob"); await loginAs(authority, "superadmin")
  await connected(alice); await connected(bob); await connected(authority)

  // Bob writes like anyone: a line of his lands on Alice's screen.
  const { repo } = await createRepo(alice, "open", "Alice's repository")
  await go(bob, `#/r/${repo}`)
  await setLine(bob, "Hello from dCode", "  <h1>Bob before</h1>")
  await persisted(alice, "Bob before") // his write, applied on her graph while he was a guest

  // The authority restricts him — its one power, on the constitution page.
  await go(authority, "#/constitution")
  await authority.page.locator('#restrict-form [name="address"]').fill(ADDR.bob)
  await authority.page.locator('#restrict-form button[value="restricted"]').click()
  await expect(authority.page.locator("#toasts")).toContainText("restricted")
  await expect.poll(() => roleOn(alice, ADDR.bob), { timeout: 30_000 }).toBe("restricted") // Alice's gate judges his next write by this

  // Bob's page says so and closes: the identity view names the role, the buffer is read-only, the commit button is off.
  await go(bob, "#/session")
  await expect(bob.page.locator("#my-role")).toHaveText("restricted")
  await go(bob, `#/r/${repo}`)
  await expect(lines(bob.page).first().locator("textarea")).toHaveAttribute("readonly", "")
  await expect(bob.page.locator("#commit-btn")).toBeDisabled()
  await expect(bob.page.locator("#commit-btn")).toHaveText(/[Rr]estricted/)

  // A tampered client: Bob writes a line straight into the graph. Every peer refuses it —
  // proved against Alice's own later write, which lands.
  const target = await lineIdWith(alice, repo, "Bob before")
  await bob.page.evaluate(async (id) => { const { result } = await globalThis.db.get(id); await globalThis.db.put({ ...result.value, text: "  <h1>Bob tampered</h1>" }, id) }, target)
  await setLine(alice, "This page is one commit", "  <p>Alice after</p>")
  await seesLine(bob, "Alice after") // the exchange is alive
  expect(await alice.page.evaluate((id) => globalThis.db.get(id).then((r) => r.result?.value.text), target)).toContain("Bob before")

  // Lifted: Bob is a guest again, and writes.
  await authority.page.locator('#restrict-form [name="address"]').fill(ADDR.bob)
  await authority.page.locator('#restrict-form button[value="guest"]').click()
  await expect(authority.page.locator("#toasts")).toContainText("guest")
  await expect.poll(() => roleOn(alice, ADDR.bob), { timeout: 30_000 }).toBe("guest")
  await go(bob, "#/session")
  await expect(bob.page.locator("#my-role")).toHaveText("guest")
  await go(bob, `#/r/${repo}`)
  await expect(bob.page.locator("#commit-btn")).toBeEnabled()
  await setLine(bob, "Alice after", "  <p>Bob after</p>")
  await persisted(alice, "Bob after") // applied on her graph again, not only painted
  await alice.close(); await bob.close(); await authority.close()
})
