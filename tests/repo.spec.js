/**
 * A repository is a node its owner owns; its buffer is one node per line that
 * everyone on the branch edits live; a commit is a node its author owns,
 * named by the author's address and a hash of what it holds; every commit is
 * a whole page and runs. Two visitors, real WebRTC between them.
 */
import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { TEMPLATE_LINES, assertTransport, commit, commitIds, connected, createRepo, freshRoom, go, head, lineIndex, lineWith, lines, loginAs, preview, rows, seesLine, setLine, short, tab, visitor } from "./_helpers.js"

test("a repository, its shared buffer and its commits cross to another visitor, with the same ids, and every version runs", async ({ browser }) => {
  const room = freshRoom("repo")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)

  const { repo } = await createRepo(alice, "hello-world", "The first repository in this room")
  await expect(lines(alice.page).last().locator(".ln")).toHaveText(String(TEMPLATE_LINES)) // positions, derived
  await expect(rows(alice.page).first()).toContainText("Initial commit")
  await expect(preview(alice.page)).toContainText("Hello from dCode") // the buffer runs on arrival

  // The repository is a node its owner owns: Alice renames and describes it in place; Bob reads the new name.
  await alice.page.locator("#edit-repo").click()
  await alice.page.locator('#repo-form [name="name"]').fill("hello-world")
  await alice.page.locator('#repo-form [name="description"]').fill("Renamed and described after the fact")
  await alice.page.locator('#repo-form button[type="submit"]').click()
  await expect(alice.page.locator("#toasts")).toContainText("Repository updated")
  await expect(alice.page.locator("#repo-name")).toHaveAttribute("title", "Renamed and described after the fact")

  // Bob opens the repository: the same buffer, line for line — and no Edit button, it is not his node.
  await go(bob, "#/")
  await expect(bob.page.locator(".repos .name")).toHaveText("hello-world")
  await expect(bob.page.locator(".repos .desc")).toContainText("Renamed and described after the fact")
  await bob.page.locator(".repos .name").click()
  await expect(bob.page).toHaveURL(new RegExp(`#/r/${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)
  await expect(bob.page.locator("#edit-repo")).toBeHidden()

  // Alice edits a line: it lands on Bob's screen live, the head has not moved, the page re-runs.
  await setLine(alice, "Hello from dCode", "  <h1>Hello, Bob, from dCode</h1>")
  await seesLine(bob, "Hello, Bob, from dCode")
  await expect(bob.page.locator("#dirty")).toBeVisible() // uncommitted, on both
  await expect(alice.page.locator("#dirty")).toBeVisible()
  await expect(preview(bob.page)).toContainText("Hello, Bob, from dCode")
  await expect(rows(bob.page)).toHaveCount(1)

  const second = await commit(alice, "Greet by name")
  await expect(rows(alice.page)).toHaveCount(2)
  await expect(rows(alice.page).first()).toContainText("Greet by name")
  await expect(head(alice.page)).toHaveText(`@ ${second}`)
  await expect(alice.page.locator("#dirty")).toBeHidden()
  // The commit's id carries its author: nobody else can create it, on any peer.
  const ids = await commitIds(alice.page)
  expect(ids[0].startsWith(`${alice.address}:`)).toBe(true)
  expect(short(ids[0])).toBe(second)

  // Bob: the two commits under the same ids, the buffer clean against the new head, the diff.
  await expect(rows(bob.page)).toHaveCount(2)
  expect(await commitIds(bob.page)).toEqual(ids)
  await expect(bob.page.locator("#dirty")).toBeHidden()
  await expect(bob.page.locator("#commit-panel .diff-summary")).toContainText("+1")
  await expect(bob.page.locator("#commit-panel .diff .del")).toHaveText(/Hello from dCode/)
  await expect(bob.page.locator("#commit-panel .diff .add")).toHaveText(/Hello, Bob, from dCode/)

  // The project is one file and leaves as one: the buffer downloads as <repo>.html, with what Bob sees.
  const [file] = await Promise.all([bob.page.waitForEvent("download"), bob.page.locator('[data-act="download"]').click()])
  expect(file.suggestedFilename()).toBe("hello-world.html")
  const saved = readFileSync(await file.path(), "utf8")
  expect(saved).toContain("Hello, Bob, from dCode")
  expect(saved.split("\n")).toHaveLength(TEMPLATE_LINES)

  // Time travel: selecting the first version in the timeline runs it as it was, with
  // no button and no write — and it downloads as it was.
  await tab(bob, "history")
  await rows(bob.page).nth(1).click()
  await expect(bob.page.locator("#commit-panel")).toContainText("root")
  await expect(bob.page.locator("#preview-what")).toContainText("Initial commit")
  await expect(preview(bob.page)).toContainText("Hello from dCode")
  await expect(preview(bob.page)).not.toContainText("Hello, Bob")
  await expect(bob.page.locator("#dirty")).toBeHidden() // reading a version wrote nothing
  await expect(bob.page.locator("#buffer")).toHaveAttribute("data-readonly", "1") // and the editor shows it, in read-only
  await expect(bob.page.locator(".line textarea").first()).toHaveJSProperty("readOnly", true)
  await expect(bob.page.locator("#commit-btn")).toBeDisabled()

  const [old] = await Promise.all([bob.page.waitForEvent("download"), bob.page.locator('[data-act="download-commit"]').click()])
  expect(old.suggestedFilename()).toMatch(/^hello-world-[0-9a-f]{7}\.html$/)
  expect(readFileSync(await old.path(), "utf8")).toContain("Hello from dCode")

  // Letting go of the version brings the branch's buffer back, as it was left.
  await bob.page.locator("#commit-hint a").click()
  await expect(bob.page.locator("#buffer")).not.toHaveAttribute("data-readonly", "1")
  await seesLine(bob, "Hello, Bob, from dCode")

  await assertTransport(bob)
  await alice.close(); await bob.close()
})

test("the views are filters over one file: CSS shows the <style> block and JS the <script> block with the file's line numbers; an edit in a view is the same node; the code is coloured", async ({ browser }) => {
  const room = freshRoom("views")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "views")
  const visible = (page) => page.locator("#buffer .line:visible")
  const numbers = (page) => visible(page).locator(".ln").allTextContents()

  await expect(alice.page.locator('#buffer .line[data-lang="css"]')).toHaveCount(2)
  await expect(alice.page.locator('#buffer .line[data-lang="js"]')).toHaveCount(2)
  // The HTML view is the markup: the two blocks fold to their tag lines, which say what they hold and where it is edited.
  await expect(visible(alice.page)).toHaveCount(TEMPLATE_LINES - 4)
  await expect(alice.page.locator('#buffer .line[data-fold]')).toHaveCount(2)
  await expect(alice.page.locator('#buffer .line[data-fold]').first()).toHaveAttribute("data-fold", "2 lines of CSS — the CSS view")
  // Coloured: tags in the HTML, properties in the CSS, keywords in the JS — painted under the text.
  await expect(alice.page.locator('#buffer .line:nth-child(2) .hl .t-tag')).toHaveText("html")
  await expect(alice.page.locator('#buffer .line[data-lang="css"] .hl .t-prop').first()).toHaveText("margin")
  await expect(alice.page.locator('#buffer .line[data-lang="js"] .hl .t-kw').first()).toHaveText("let")

  await alice.page.locator('.views [data-view="css"]').click()
  await expect(visible(alice.page)).toHaveCount(2)
  expect(await numbers(alice.page)).toEqual(["7", "8"]) // the file's numbers, not the view's
  await alice.page.locator('.views [data-view="js"]').click()
  await expect(visible(alice.page)).toHaveCount(2)
  expect(await numbers(alice.page)).toEqual(["18", "19"])
  // The space under the last line is the editor too: a click there puts the caret at the end of the last line shown.
  await alice.page.locator("#buffer").click({ position: { x: 300, y: 400 } })
  await expect(alice.page.locator("#buffer .line:focus-within textarea")).toHaveValue(/^  document\.getElementById/)
  expect(await alice.page.evaluate(() => document.activeElement.selectionStart === document.activeElement.value.length)).toBe(true)

  // An edit in the CSS view is an edit of the same node: Bob sees it on line 8 — in his CSS view, where the block is shown.
  await alice.page.locator('.views [data-view="css"]').click()
  await setLine(alice, "button {", "  button { font: inherit; padding: 12px 24px; border-radius: 12px; border: 1px solid #4c8dff; background: none; color: inherit; cursor: pointer; }")
  await go(bob, `#/r/${repo}`)
  await seesLine(bob, "padding: 12px 24px")
  expect(await bob.page.locator("#buffer .line").locator("textarea").evaluateAll((els) => els.findIndex((e) => e.value.includes("padding: 12px 24px")))).toBe(7)
  await bob.page.locator('.views [data-view="css"]').click()
  await expect(bob.page.locator('#buffer .line[data-lang="css"] .hl .t-num').filter({ hasText: "12px" }).first()).toBeVisible()

  // Enter at the end of the last CSS line, in the CSS view: the new line is inside <style>, visible here, and takes the caret.
  const last = await lineWith(alice.page, "padding: 12px 24px")
  await last.click(); await last.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length))
  await alice.page.keyboard.press("Enter")
  await expect(visible(alice.page)).toHaveCount(3)
  await alice.page.keyboard.type("h1 { letter-spacing: .02em; }")
  await seesLine(bob, "letter-spacing")
  await expect(bob.page.locator("#buffer .line").filter({ has: bob.page.locator('textarea') })).toHaveCount(TEMPLATE_LINES + 1)
  await alice.page.locator('.views [data-view="html"]').click()
  await expect(visible(alice.page)).toHaveCount(TEMPLATE_LINES - 4) // the markup: the new CSS line is folded with its block
  await expect(alice.page.locator('#buffer .line[data-fold]').first()).toHaveAttribute("data-fold", "3 lines of CSS — the CSS view")
  await alice.close(); await bob.close()
})

test("the buffer is the block editor for code: two people on two lines, Enter splits a node, Backspace merges it back, Discard returns to the head", async ({ browser }) => {
  const room = freshRoom("buffer")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "shared-buffer")
  await go(bob, `#/r/${repo}`)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)

  // Two people, two lines, at once: line-level LWW, no shared node to fight over.
  await Promise.all([
    setLine(alice, "Hello from dCode", "  <h1>Alice was here</h1>"),
    setLine(bob, "Clicked 0 times", '  <button id="count">Bob was here</button>'),
  ])
  await seesLine(alice, "Bob was here")
  await seesLine(bob, "Alice was here")

  // Enter at the end of a line: a new node below, indented like its parent, on both peers.
  // (The caret is placed with setSelectionRange: Home and End do not move it in headless Chromium on macOS.)
  const h1 = await lineWith(alice.page, "Alice was here")
  await h1.click(); await h1.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length))
  await alice.page.keyboard.press("Enter")
  await expect(lines(alice.page)).toHaveCount(TEMPLATE_LINES + 1)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES + 1)
  await expect(lines(alice.page).last().locator(".ln")).toHaveText(String(TEMPLATE_LINES + 1))
  await alice.page.keyboard.type("<p>a new line</p>")
  await seesLine(bob, "  <p>a new line</p>")

  // Backspace at its start: the line joins the one above and its node is gone everywhere.
  const fresh = await lineWith(alice.page, "<p>a new line</p>")
  await fresh.click(); await fresh.evaluate((el) => el.setSelectionRange(0, 0))
  await alice.page.keyboard.press("Backspace")
  await expect(lines(alice.page)).toHaveCount(TEMPLATE_LINES)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)
  await seesLine(bob, "<h1>Alice was here</h1>  <p>a new line</p>")

  // Discard: the buffer is the head again, for everyone. Bob leaves the line he was typing in first:
  // a line under a caret keeps what its typist sees and rejoins the graph on blur, by design.
  await bob.page.locator(".preview-head").click()
  await alice.page.locator("#discard").click()
  await expect(alice.page.locator("#dirty")).toBeHidden()
  await expect(bob.page.locator("#dirty")).toBeHidden()
  await expect.poll(() => lineIndex(bob.page, "Alice was here")).toBe(-1)
  await expect.poll(() => lineIndex(bob.page, "Bob was here")).toBe(-1)
  await seesLine(bob, "Hello from dCode")
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)
  await alice.close(); await bob.close()
})

test("whole lines: Shift+↓ selects a range and the line numbers select another; copied as text, removed as nodes, replaced by a paste — on both peers", async ({ browser }) => {
  const room = freshRoom("lines")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "ranges")
  await go(bob, `#/r/${repo}`)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES)
  const selected = (page) => page.locator("#buffer .line.sel")
  const selectedText = (page) => selected(page).locator("textarea").evaluateAll((els) => els.map((e) => e.value))

  // Shift+↓ from the caret's line: whole lines, this one and the next, then more. Copy joins them.
  const main = await lineWith(alice.page, "<main>")
  await main.click()
  await alice.page.keyboard.press("Shift+ArrowDown")
  await expect(selected(alice.page)).toHaveCount(2)
  await alice.page.keyboard.press("Shift+ArrowDown"); await alice.page.keyboard.press("Shift+ArrowDown")
  await expect(selected(alice.page)).toHaveCount(4)
  expect(await selectedText(alice.page)).toEqual(["<main>", "  <h1>Hello from dCode</h1>", "  <p>This page is one commit. Edit it, commit, and run any version from the timeline.</p>", '  <button id="count">Clicked 0 times</button>'])
  const copied = await alice.page.evaluate(() => { const clipboardData = new DataTransfer(); document.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true })); return clipboardData.getData("text/plain") })
  expect(copied.split("\n")).toHaveLength(4)
  expect(copied).toContain("<main>\n  <h1>Hello from dCode</h1>")
  await alice.page.keyboard.press("Shift+ArrowUp") // the head comes back one line
  await expect(selected(alice.page)).toHaveCount(3)

  // Backspace removes the selected nodes: gone on both peers, the caret on the line that followed.
  await alice.page.keyboard.press("Backspace")
  await expect(selected(alice.page)).toHaveCount(0)
  await expect(lines(alice.page)).toHaveCount(TEMPLATE_LINES - 3)
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES - 3)
  await expect.poll(() => lineIndex(bob.page, "Hello from dCode")).toBe(-1)
  await expect(alice.page.locator("#buffer .line:focus-within textarea")).toHaveValue('  <button id="count">Clicked 0 times</button>')

  // The line numbers: click one, Shift+click another — in the markup, where the HTML view shows them; a range
  // never spans a folded block. A paste replaces the range — the first line keeps its node, the rest go,
  // extra lines are minted between — and the other peer follows.
  await alice.page.locator("#buffer .line").nth(2).locator(".ln").click()
  await expect(selected(alice.page)).toHaveCount(1)
  await alice.page.locator("#buffer .line").nth(4).locator(".ln").click({ modifiers: ["Shift"] })
  await expect(selected(alice.page)).toHaveCount(3)
  expect(await selectedText(alice.page)).toEqual(["<head>", '<meta charset="utf-8">', "<title>Hello, dCode</title>"])
  const thirdId = await alice.page.locator("#buffer .line").nth(2).getAttribute("id")
  await alice.page.evaluate((t) => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", t)
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }))
  }, "<head>\n<title>Ranges</title>")
  await expect(selected(alice.page)).toHaveCount(0)
  await expect(lines(alice.page)).toHaveCount(TEMPLATE_LINES - 4)
  await expect(alice.page.locator("#buffer .line").nth(2)).toHaveAttribute("id", thirdId) // the first line kept its node
  await expect(alice.page.locator("#buffer .line").nth(2).locator("textarea")).toHaveValue("<head>")
  await expect(alice.page.locator("#buffer .line").nth(3).locator("textarea")).toHaveValue("<title>Ranges</title>")
  await expect(alice.page.locator("#buffer .line").nth(4).locator("textarea")).toHaveValue("<style>")
  await expect(lines(bob.page)).toHaveCount(TEMPLATE_LINES - 4)
  await seesLine(bob, "<title>Ranges</title>")
  await expect(bob.page.locator("#buffer .line").nth(2)).toHaveAttribute("id", thirdId)
  await expect.poll(() => lineIndex(bob.page, '<meta charset="utf-8">')).toBe(-1)

  // Escape lets go; typing afterwards is the caret again, and the buffer still runs.
  await alice.page.locator("#buffer .line").nth(2).locator(".ln").click()
  await expect(selected(alice.page)).toHaveCount(1)
  await alice.page.keyboard.press("Escape")
  await expect(selected(alice.page)).toHaveCount(0)
  await expect(preview(alice.page)).toContainText("Clicked 0 times")
  await alice.close(); await bob.close()
})

test("two people type in the same line at the same instant, at different places: both keep their letters, and both peers hold the union", async ({ browser }) => {
  const room = freshRoom("same-line")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  const { repo } = await createRepo(alice, "same-line")
  await go(bob, `#/r/${repo}`)
  await seesLine(bob, "Hello from dCode")
  const a = await lineWith(alice.page, "Hello from dCode"), b = await lineWith(bob.page, "Hello from dCode")
  const original = await a.inputValue()

  // Alice at the start of the line, Bob at its end, at once: two puts over the same
  // value; the loser's engine re-applies its edit over the winner, and each editor
  // lands the other's letters under its own caret.
  await a.click(); await a.evaluate((ta) => ta.setSelectionRange(0, 0))
  await b.click(); await b.evaluate((ta) => ta.setSelectionRange(ta.value.length, ta.value.length))
  await Promise.all([alice.page.keyboard.type("AAA "), bob.page.keyboard.type(" BBB")])
  const union = `AAA ${original} BBB`
  await expect(a).toHaveValue(union)
  await expect(b).toHaveValue(union)
  expect(await a.evaluate((ta) => ta.selectionStart)).toBe(4)
  expect(await b.evaluate((ta) => ta.selectionStart)).toBe(union.length)
  await a.evaluate((ta) => ta.blur()); await b.evaluate((ta) => ta.blur())
  await expect(a).toHaveValue(union)
  await expect(b).toHaveValue(union)
  await expect(preview(alice.page)).toContainText("Hello from dCode")
  await alice.close(); await bob.close()
})
