# dCode | Code with a timeline, and no server

A shared code editor and a code host in one page, for projects that are **one HTML file** — HTML, CSS and JavaScript together, as on CodePen or JSFiddle — with no server. The editor is [GenosDB](https://github.com/estebanrfp/gdb)'s block editor applied to code: **one node per line**, edited live by everyone on the branch, with named carets. Beside it, behind a divider you can drag, the project runs as you type. Underneath, the history: branches, forks, pull requests, and a timeline where every commit is a signed node its author owns — and a page you can run.

**Live:** [estebanrfp.github.io/dCode](https://estebanrfp.github.io/dCode/) · **The article:** [A GitHub With No Server](https://genosdb.com/dcode-p2p-collaborative-code-editor-no-server) · **Engine:** [GenosDB](https://github.com/estebanrfp/gdb) — if this is interesting, [star the engine ★](https://github.com/estebanrfp/gdb): that is where the work is.

![dCode with two peers: on the left the shared buffer with line numbers and syntax colours, Bob's named caret on line 15, the HTML · CSS · JS views above it; on the right the page running as it is typed, and under it the History tab with the commit graph and the diff of the selected commit.](https://cdn.jsdelivr.net/gh/estebanrfp/gdb@main/assets/dcode-editor.png)

Plain HTML, CSS and JavaScript. No framework, no build step, no backend — native modules, which the browser fetches as the page needs them.

## What is different from a code host

| On GitHub, on CodePen | On dCode |
|---|---|
| A server holds the repositories, a server runs the collaboration | Every visitor holds the graph; peers sync it directly over WebRTC, live typing included |
| An account is a row in a database | An identity is a key pair on your device: a mnemonic recovers it, a passkey keeps it |
| A shared editor needs a CRDT library and a relay | A line is a node: two people on different lines never collide, two on the same line keep both edits when they touch different places, carets ride an ephemeral channel — the block editor's technique, for code |
| Branch protection is a server rule | A branch is a node its owner owns: only the owner, and the addresses granted `write`, can move its head — refused on every peer otherwise |
| A commit is trusted because the server says so | A commit's id begins with its author's address and ends with a hash of its content: nobody else can create it, rewrite it or delete it, anywhere |
| A pull request's state is a column | Whether a proposal is merged is read from the graph by every peer: the proposed commit is an ancestor of the target's head, or it is not |
| History is browsed | History **runs**: a project is one HTML file, so any commit opens in a sandboxed frame as it was — Preview, History, Pull requests and Branches are the tabs of the right column, Preview first and full height — and the dock draws the one you are looking at, so a diff nobody has asked for is never computed |
| Offline is an error | A commit made with no peer in sight waits on this device's disk and lands when a path exists, signed like any other |
| A private repository is a server setting | A private repository has a vault: one encrypted node holding its key, with an envelope per member that the owner grants and revokes. Every line and every commit is ciphertext to anyone else — on the wire, at rest, and to the authority itself |

## The model

Two layers, one graph.

**The buffer is shared.** Every line of a branch's code is a plain node `{ text, order }`, keyed fractionally, that anyone on the branch may rewrite, split, merge, move or remove — live, with everyone's carets in view. Line-level last-write-wins means two people on different lines never collide, and two on the same line keep both edits when they touch different places — the engine re-applies the losing write over the winner, and the editor paints it under the caret; Enter splits a line into two nodes, Backspace at its start merges them back, Alt+↑/↓ moves one with a new key, a multi-line paste mints its keys in one batch, Ctrl/Cmd+A twice selects the whole buffer. Whole lines are selected with Shift+↑/↓, or with a click and a Shift+click or drag on the line numbers: a selection that crosses lines is a set of nodes, so copy joins their texts, cut and Backspace remove the nodes, and a paste replaces them — the first line keeps its node, the rest go, extra lines are minted between — each step a put or a remove the other peers see line by line, live. Live typing and the carets ride one ephemeral GenosRTC channel; the debounced write is the truth that persists. Line numbers are positions, derived, and stay put while long lines scroll. The code is coloured by the language each line is in — HTML, the CSS inside `<style>`, the JavaScript inside `<script>` — and the **HTML · CSS · JS** views are filters over that one file: the CSS view shows the `<style>` block and the JS view the `<script>` block, with the file's own line numbers, the same nodes, edited and synced the same way. The page on the right re-runs a moment after the last keystroke. A new repository asks only for a name and a description and opens here, with a starter page seeded into the buffer as its first commit — replace it with your own file with Ctrl/Cmd+A twice and a paste. The project is one file and leaves as one: **Download .html** saves the buffer as `<repository>.html`, and every commit in the timeline downloads as it was.

**The history is owned.** Four kinds of node, each owned by whoever wrote it:

- **repository** — a name and a description, which its owner renames or rewrites in place with **Edit** — one write on a node they own. Its branches belong to whoever created them.
- **branch** — a name and a `head`. The owner grants `write` to collaborators with `db.sm.acls.grant`; anyone else who commits gets a branch of their own, forked from where they stood, with a copy of the buffer. Two writers moving one head at once: the hybrid logical clock keeps one, the other commit stays in the graph, behind, and merges like any other. Its owner can delete it — asked twice — except the repository's default one: the buffer's lines go, the commits stay in the timeline.
- **commit** — the whole file, a message, its parents and the branch it was made on. Its id is `<author>:<sha-256 of repo, parents, message, content, time>`.
- **pull request** — a proposal from one branch into another, with the commit it proposes. The proposer updates or withdraws it; the target's owner merges it — a fast-forward when the target's head is an ancestor of the proposal, a merge commit with two parents otherwise, made by a line-based three-way merge. The target's buffer follows the merge; conflicts land in it with the usual markers, and the commit made from the resolution is the merge.

**A private repository is sealed.** Tick *Private* when creating one and the owner's session mints a key and keeps it in a **vault** — one encrypted node written with `db.sm.put`, whose per-reader key envelopes the engine manages. From then on every line and every commit of that repository leaves the device as ciphertext (AES-GCM, sealed with the current key before the node is written), the live keystrokes on the channel included; only the name, the description, the branch names, the commit messages and the pull request titles stay readable. A **member** is an address the owner grants `read` on the vault, in the Branches tab: the engine wraps the key for them and their page opens on its own. Revoking one turns two keys at once — the engine rotates the vault's, the app adds a new one to the repository's ring — so what is written afterwards never opens for them. Nobody else holds anything but ciphertext, at rest included: a member's browser opens the code in memory and never writes it back to disk in clear, and the constitution's authority sees the same locked door as a stranger.

## The agent

Optional, and yours. The prompt box sits at the bottom right of every repository page. Describe a change and a coding model running in your browser edits the shared buffer the way you do — as you: the file changes in place, line by line, under your session, and everyone on the branch watches it change. A line the buffer already holds keeps its node, a changed one is rewritten under the same id, only what is new is inserted and only what is gone is removed. Then it presses Commit for you, with your brief as the message: a commit on the branch you stand on when it is yours to move — no branch is ever created in your repositories — and, on someone else's repository, the fork the button makes, once, after which you stand on your own branch and propose it when you like. Nothing is signed by anyone but you.

Nothing leaves the machine: the weights (`Qwen2.5-Coder`, 7B by default, 3B and 1.5B when the GPU is smaller; `?model=<id>` to choose) are downloaded once from the model hub and cached by the browser, and the prompt is not sent anywhere. What the model knows is in [agent-prompt.md](agent-prompt.md) — the rules of a single-file GenosDB application, the exact API it may use and a complete example to follow — plus GenosDB's own [summary for models](https://cdn.jsdelivr.net/gh/estebanrfp/gdb@main/llms.txt), fetched fresh on each first use so the agent follows the engine; and whatever the model does with the rules, the skeleton is enforced as the file lands: a module script, the CDN import, the room named after the brief. Edit the prompt file to change how it builds. It needs a browser with WebGPU: Chrome, Edge or Safari 26.

## The files

`index.html` is the shell, and the import map in its head is the whole build step: one line per module with the version they share, so a publish can never leave a visitor running today's markup against a module the browser still had cached.

Four modules, and one direction. **`app.js`** is the application: the database and its constitution, the store a single subscription feeds, the derivations every page reads, the writes, the router, the session and the index. **`repo.js`** is the repository view — the page's skeleton, the four panels of the dock, the timeline, the diff, the merges, and everything pressed on them. **`editor.js`** is the buffer itself: a line as a node, the debounced save, the value that lands merged under the caret, whole-line selection, the syntax colours, the HTML · CSS · JS views over the one file, and the ephemeral channel that carries the carets and the keystrokes. **`text.js`** is the diff and the three-way merge over lines — pure functions, no DOM and no database, which is why they can be read on their own. Beside them, `constitution.js` holds the rules the room runs under and `styles.css` the tokens and the rules.

**The search is a query the engine answers.** Typing in the index runs `db.map` with `$text` over the name and the description — accents and case folded, per field, so *cafe* finds *café* — and it is a subscription, not a loop: a repository another peer creates, renames or removes while you are reading the results enters or leaves them on its own. One live query at a time; emptying the box drops it. The owners whose name matches ride in the same query as an `$in`, because a name lives on its identity's own node.

**A room with nobody in it is empty — that is the model, not a defect** — so the door offers to fill this one: *Seed the example projects* writes **two hundred single-file pages** into the room from your own browser, as the New form writes them, signed by the two demo identities. Sixteen kinds of small application over fifty subjects: landings, forms, to-do lists, boards, price lists, questions, a timer, a quiz, notes, a bill split, a chart, photographs, a menu, a week, a shelf and a waiting list, each with its own palette and its own script. They arrive with [`examples.js`](examples.js), which is fetched only if the button is pressed, and they live on whoever holds them — you, from then on.

**The list is a window that grows as you reach the end of the column.** Under **Newest** the pages are the engine's own: `field` and `order` make the cursor deterministic between peers — without them `$after` walks each peer's insertion order — `$limit` is the page, and the next one is asked for by the id of the last row, the shape of [`infinite-scroll.html`](https://estebanrfp.github.io/gdb/examples/infinite-scroll.html). The other three orders are the application's: the newest commit's time and a count of stars live on other nodes, and the engine cannot order by what it cannot compute, so there the window is a slice of what the store already holds.

**Nothing of a repository is fetched until one is opened.** The router asks for `repo.js`, which brings `editor.js`, `text.js` and `agent.js` with it; `activity.js` arrives only with the identity page. A visitor who lands on dCode parses 52 KB of JavaScript instead of 126, and the rest arrives when it is about to be used.

The direction of the dependency is what keeps that honest: a view speaks the application's own vocabulary and imports it from `app.js`, and `app.js` never imports a view — the router asks for one. Each module owns its own markup, what draws it and what is pressed on it, so the shell's events are the chrome's, the repository's are the view's, and the buffer's are the editor's. What a change to the buffer means to the page around it is not the editor's business either: it is a function whoever mounts it hands over.

## Testing

The door offers **Reset: wipe this device (testing)** under the identities: `db.clear()` and nothing else, so this device's copy of the graph goes and the page shows it empty at once. It is not a reset of the room and cannot be — every other peer still holds what it holds and hands it back on the next connection — but what lived only here does go with it, which is how a graph from an older shape of the app, or operations nobody accepts any more, leave a device.

Signed in, the home page offers **Delete my repositories**, asked twice: every repository you own goes, with its branches, commits, pull requests and lines — on every peer, since a removal is a signed write like any other. Forks and commits by other people are theirs and stay. It is the one honest reset in a peer-to-peer room: what is yours goes everywhere; a room cannot be emptied of what is not yours, and the URL never changes for it — everyone who opens dCode is in the same room.

## The constitution

[`constitution.js`](constitution.js) is rendered verbatim on the site's **constitution** page. Writing is free from the first second — on an owned node a write or a deletion is only ever the owner's, and `delete` is what lets a shared buffer lose a line — so there is no ladder to climb and no authority to wait for. The authority's only power is to restrict an identity, with its signature — a form on the constitution page, signed in as the authority: `db.sm.assignRole`, honoured by every peer. A restricted identity reads and syncs; its buffer is read-only, its commits are refused everywhere, and what it wrote before stays. The authority cannot touch a repository, a branch or a commit it does not own.

**To change a rule, open a pull request.** The discussion is public, the diff is the amendment, and the site renders the file as merged.

## What it demonstrates of GenosDB

- **Collaborative editing without a CRDT library.** One node per line, fractional order keys, live typing over an ephemeral channel, remote carets — the [block editor](https://estebanrfp.github.io/gdb/examples/block-editor.html)'s technique on a code editor with line numbers and a running result.
- **Ownership enforced on every peer.** `db.sm.acls.set` makes the creator the owner; live or through catch-up, the engine refuses anyone else's edit or deletion. Branch protection and immutable history are the same rule read twice.
- **Ids that carry their author.** A node whose id begins with an address can only be created by that address, on a peer that never saw it — which is what lets a commit name itself by its content.
- **Collaborators as data.** `grant` and `revoke` on the branch node, honoured by every receiver; no server decides who may push.
- **Derived state from one subscription.** One `db.map` feeds a store; the buffer, the branches, the timeline, the diff and every pull request's state are pure functions of it.
- **Encryption with keys the engine keeps.** `db.sm.put` stores the vault encrypted with a key wrapped per reader; `grant` and `revoke` on it add and remove envelopes and rotate the key. The app seals the code with one symmetric key it keeps there — no key server, no secret typed anywhere.
- **Identity with no server.** The design guide's door: mnemonic recovery, passkey sessions that resume silently on a reload and open with one click in a new tab, a session opened with a phrase that takes a passkey later from the identity view behind the session pill, and demo identities so two windows can meet in one click. **A name is a label you sign:** it is a field of your own `user:` node — the one the engine ties to your key — so only you can write it, every peer recovers the signature before accepting it, and the same gate refuses the write if it tries to touch your role. Two identities may choose the same name; the address underneath cannot be copied. The theme follows the [design guide](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-design-guide.md): system, light or dark, one button, tokens only.

## Run it

Serve the folder with any static server — there is nothing to build:

```bash
bun tests/server.mjs        # http://localhost:5805
```

Two useful query parameters: `?room=anything` opens a private sandbox of the whole site (the tests use it), and `?relay=ws://…` points signalling at a relay of your own.

**Demo identities.** The identity door — the design guide's modal, open on every load without a session and dismissible, since reading needs none — offers three one-click identities from the guide: Superadmin, Alice and Bob — the canonical set of the guide, one ghost button each. Open two browsers, create a repository as Alice in one, open it as Bob in the other: type in both and watch the carets; Bob's commit goes to a branch of his own, his pull request appears on Alice's side, and her merge moves `main` everywhere.

## Tests

```bash
pnpm install
pnpm test
```

Playwright, one `BrowserContext` per simulated visitor (own storage, own identity), a fresh room per test, real WebRTC between them. Twenty-five tests in ten files:

- `tests/repo.spec.js` — a repository and its buffer crossing to another visitor line for line, an edit landing live, the commit under the same ids, the head and an older version running in the frame, the diff, the download of the buffer and of an older version, the owner renaming the repository in place; the views as filters over one file — HTML the markup with the two blocks folded to their tag lines, CSS the `<style>` block, JS the `<script>` block, with the file's line numbers — an edit in a view landing as the same node, the code coloured; the buffer as the block editor: two people on two lines at once, Enter splitting a node and Backspace merging it back on both peers, Discard returning everyone to the head. Whole lines: Shift+↓ selecting a range, copy joining its text, Backspace removing the nodes on both peers with the caret landing on the line that followed, the line numbers selecting another range with a Shift+click, a paste replacing it with the first node kept and the rest gone everywhere, Escape letting go.
- `tests/branches.spec.js` — a fork with a copy of the buffer, a pull request, a proposal brought up to date and a fast-forward merge that the target's buffer follows; a tampered client that writes another's branch head and is refused by every receiver, proved against a later write that lands; a collaborator granted `write` who moves the head directly, and is back to forking once revoked. A branch you own deleted, asked twice, its lines gone on both peers and the owner back on main; main and other people's branches offer no such button.
- `tests/merge.spec.js` — divergent edits on different lines merged into one commit with two parents; the same line changed both ways, the conflict markers landing in the shared buffer on both screens, the refusal to commit them, and the merge commit made from the resolution pasted over the whole buffer.
- `tests/sync.spec.js` — a repository and a commit made with no peer in sight, read back from this device's disk with its buffer and delivered once it is back.
- `tests/private.spec.js` — a private repository: the authority itself meets the locked door and holds only ciphertext on its disk, a grant opens Bob's page on its own, a member's sealed lines reach the other member in clear and nobody else, a revocation closes his page and seals what comes after with a new key, and the owner reads everything back after a reload — with no plaintext ever written to any disk, hers included.
- `tests/restricted.spec.js` — the constitution's one power: the authority restricts an identity from the constitution page; its identity view says so, its buffer turns read-only and its commit button closes; a write of its own straight into the graph is refused by every peer — judged by the receiver when the write arrives, so an edit painted over the channel a moment before the restriction lands does not — and what it wrote before stays; lifted, it is a guest again and writes.
- `tests/agent.spec.js` — the agent as your own hands, with the model replaced by a stub that streams a fixed file: the template becoming the app in the buffer under Alice's session, on Bob's screen too, committed to main as hers with the brief as the message; a second brief fitted onto the file with every node kept, the heading rewritten in place, one node for the added line and a second commit on main with no branch anywhere; and Bob asking on Alice's repository — the shared buffer changing for everyone, the fork the button makes for him, the pull request from him.
- `tests/session.spec.js` — the identity view: a session opened with a phrase protected with a passkey there (Playwright's virtual authenticator), resumed silently after a reload and reopened with the passkey; the theme toggle cycling system → light → dark, kept across a reload and following the OS on `system`. Delete my repositories, asked twice: gone on both peers; a visitor who owns nothing has no such button; the URL never changes.

Signalling goes through the public relays; set `DCODE_RELAY=ws://…` to use a local one, which makes discovery immediate.

## Contributing

Pull requests are welcome — to the code, and to the constitution. A change to `constitution.js` is an amendment: say in the PR what behaviour it changes and why the rule is fairer.

## Author

Esteban Fuster Pozzi (@estebanrfp) - Full Stack JavaScript Developer

## License

MIT
