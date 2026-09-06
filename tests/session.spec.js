/**
 * The identity view behind the session pill, and the theme toggle. A session
 * opened with a phrase still holds its key: a passkey can take it here, not
 * only at onboarding — the gap the design guide closed with this app.
 */
import { expect, test } from "@playwright/test"
import { ADDR, freshRoom, go, loginAs, virtualAuthenticator, visitor } from "./_helpers.js"

test("a phrase session is protected with a passkey from the identity view; the passkey resumes it after a reload", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("session"))
  await virtualAuthenticator(v)
  await loginAs(v, "alice")
  await expect(v.page).toHaveURL(/#\/session$/) // a sign-in with nowhere to go lands on the identity view
  const page = v.page.locator(".session-page")
  await expect(page.locator("#my-address")).toHaveText(ADDR.alice)
  await expect(page.locator("#unlocked-by")).toHaveText("mnemonic")
  await expect(page.locator("#passkey-protect-btn")).toBeVisible()
  await page.locator("#passkey-protect-btn").click()
  await expect(page.locator("#unlocked-by")).toHaveText("passkey")
  await expect(page.locator("#passkey-protect-btn")).toHaveCount(0)
  await expect(v.page.locator("#session .who")).toHaveText("alice")

  await v.page.reload()
  await expect(v.page.locator("#session .who")).toHaveText("alice") // resumed silently, no phrase typed
  await v.page.locator("#session .who").click()
  await expect(v.page.locator("#unlocked-by")).toHaveText("passkey")
  await v.page.locator("#logout-btn").click()
  await expect(v.page.locator("#session")).toHaveText("sign in")
  await go(v, "#/login")
  await expect(v.page.locator("#passkey-login-btn")).toBeVisible()
  await v.page.locator("#passkey-login-btn").click()
  await expect(v.page.locator("#session .who")).toHaveText("alice")
  await v.close()
})

test("the theme toggle cycles system → light → dark and the choice survives a reload", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("theme"), { colorScheme: "dark" })
  const root = v.page.locator("html")
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
  await v.page.locator("#theme-btn").click()
  await expect(root).toHaveAttribute("data-pref", "system")
  await v.page.emulateMedia({ colorScheme: "light" })
  await expect(root).toHaveAttribute("data-theme", "light") // on `system`, the OS decides
  await v.close()
})
