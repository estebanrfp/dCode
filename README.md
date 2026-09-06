# dCode | Code with a timeline, and no server

A shared code editor and a code host in one page, for projects that are **one HTML file** — HTML, CSS and JavaScript together, as on CodePen or JSFiddle — with no server. The editor is [GenosDB](https://github.com/estebanrfp/gdb)'s block editor applied to code: **one node per line**, edited live by everyone on the branch, with named carets. Beside it, behind a divider you can drag, the project runs as you type. Underneath, the history: branches, forks, pull requests, and a timeline where every commit is a signed node its author owns — and a page you can run.

**Live:** [estebanrfp.github.io/dCode](https://estebanrfp.github.io/dCode/) · **Engine:** [GenosDB](https://github.com/estebanrfp/gdb) — if this is interesting, [star the engine ★](https://github.com/estebanrfp/gdb): that is where the work is.

Plain HTML, CSS and JavaScript. No framework, no build step, no backend. Four files.

## What is different from a code host

| On GitHub, on CodePen | On dCode |
|---|---|
| A server holds the repositories, a server runs the collaboration | Every visitor holds the graph; peers sync it directly over WebRTC, live typing included |
| An account is a row in a database | An identity is a key pair on your device: a mnemonic recovers it, a passkey keeps it |
| A shared editor needs a CRDT library and a relay | A line is a node: two people on different lines never collide, the same line is last-write-wins, carets ride an ephemeral channel — the block editor's technique, for code |
| Branch protection is a server rule | A branch is a node its owner owns: only the owner, and the addresses granted `write`, can move its head — refused on every peer otherwise |
| A commit is trusted because the server says so | A commit's id begins with its author's address and ends with a hash of its content: nobody else can create it, rewrite it or delete it, anywhere |
| A pull request's state is a column | Whether a proposal is merged is read from the graph by every peer: the proposed commit is an ancestor of the target's head, or it is not |
| History is browsed | History **runs**: a project is one HTML file, so any commit opens in a sandboxed frame as it was |
| Offline is an error | A commit made with no peer in sight waits on this device's disk and lands when a path exists, signed like any other |

## The model

Two layers, one graph.

**The buffer is shared.** Every line of a branch's code is a plain node `{ text, order }`, keyed fractionally, that anyone on the branch may rewrite, split, merge, move or remove — live, with everyone's carets in view. Line-level last-write-wins means two people on different lines never collide; Enter splits a line into two nodes, Backspace at its start merges them back, Alt+↑/↓ moves one with a new key, a multi-line paste mints its keys in one batch, Ctrl/Cmd+A twice selects the whole buffer. Live typing and the carets ride one ephemeral GenosRTC channel; the debounced write is the truth that persists. Line numbers are positions, derived, and stay put while long lines scroll. The page on the right re-runs a moment after the last keystroke. A new repository asks only for a name and a description and opens here, with a starter page seeded into the buffer as its first commit — replace it with your own file with Ctrl/Cmd+A twice and a paste. The project is one file and leaves as one: **Download .html** saves the buffer as `<repository>.html`, and every commit in the timeline downloads as it was.

**The history is owned.** Four kinds of node, each owned by whoever wrote it:

- **repository** — a name and a description, which its owner renames or rewrites in place with **Edit** — one write on a node they own. Its branches belong to whoever created them.
- **branch** — a name and a `head`. The owner grants `write` to collaborators with `db.sm.acls.grant`; anyone else who commits gets a branch of their own, forked from where they stood, with a copy of the buffer. Two writers moving one head at once: the hybrid logical clock keeps one, the other commit stays in the graph, behind, and merges like any other.
- **commit** — the whole file, a message, its parents and the branch it was made on. Its id is `<author>:<sha-256 of repo, parents, message, content, time>`.
- **pull request** — a proposal from one branch into another, with the commit it proposes. The proposer updates or withdraws it; the target's owner merges it — a fast-forward when the target's head is an ancestor of the proposal, a merge commit with two parents otherwise, made by a line-based three-way merge. The target's buffer follows the merge; conflicts land in it with the usual markers, and the commit made from the resolution is the merge.

## The constitution

[`constitution.js`](constitution.js) is rendered verbatim on the site's **constitution** page. Writing is free from the first second — on an owned node a write or a deletion is only ever the owner's, and `delete` is what lets a shared buffer lose a line — so there is no ladder to climb and no authority to wait for. The authority's only power is to restrict an identity, with its signature; it cannot touch a repository, a branch or a commit it does not own.

**To change a rule, open a pull request.** The discussion is public, the diff is the amendment, and the site renders the file as merged.

## What it demonstrates of GenosDB

- **Collaborative editing without a CRDT library.** One node per line, fractional order keys, live typing over an ephemeral channel, remote carets — the [block editor](https://estebanrfp.github.io/gdb/examples/block-editor.html)'s technique on a code editor with line numbers and a running result.
- **Ownership enforced on every peer.** `db.sm.acls.set` makes the creator the owner; live or through catch-up, the engine refuses anyone else's edit or deletion. Branch protection and immutable history are the same rule read twice.
- **Ids that carry their author.** A node whose id begins with an address can only be created by that address, on a peer that never saw it — which is what lets a commit name itself by its content.
- **Collaborators as data.** `grant` and `revoke` on the branch node, honoured by every receiver; no server decides who may push.
- **Derived state from one subscription.** One `db.map` feeds a store; the buffer, the branches, the timeline, the diff and every pull request's state are pure functions of it.
- **Identity with no server.** Mnemonic recovery, passkey sessions, and demo identities so two windows can meet in one click.

## Run it

Serve the folder with any static server — there is nothing to build:

```bash
bun tests/server.mjs        # http://localhost:5805
```

Two useful query parameters: `?room=anything` opens a private sandbox of the whole site (the tests use it), and `?relay=ws://…` points signalling at a relay of your own.

**Demo identities.** The sign-in page offers three one-click identities from the GenosDB design guide: `alice`, `bob`, and the `constitution` authority. Open two browsers, create a repository as Alice in one, open it as Bob in the other: type in both and watch the carets; Bob's commit goes to a branch of his own, his pull request appears on Alice's side, and her merge moves `main` everywhere.

## Tests

```bash
pnpm install
pnpm test
```

Playwright, one `BrowserContext` per simulated visitor (own storage, own identity), a fresh room per test, real WebRTC between them. Six tests in four files:

- `tests/repo.spec.js` — a repository and its buffer crossing to another visitor line for line, an edit landing live, the commit under the same ids, the head and an older version running in the frame, the diff; the buffer as the block editor: two people on two lines at once, Enter splitting a node and Backspace merging it back on both peers, Discard returning everyone to the head.
- `tests/branches.spec.js` — a fork with a copy of the buffer, a pull request, a proposal brought up to date and a fast-forward merge that the target's buffer follows; a tampered client that writes another's branch head and is refused by every receiver, proved against a later write that lands; a collaborator granted `write` who moves the head directly, and is back to forking once revoked.
- `tests/merge.spec.js` — divergent edits on different lines merged into one commit with two parents; the same line changed both ways, the conflict markers landing in the shared buffer on both screens, the refusal to commit them, and the merge commit made from the resolution pasted over the whole buffer.
- `tests/sync.spec.js` — a repository and a commit made with no peer in sight, read back from this device's disk with its buffer and delivered once it is back.

Signalling goes through the public relays; set `DCODE_RELAY=ws://…` to use a local one, which makes discovery immediate.

## Contributing

Pull requests are welcome — to the code, and to the constitution. A change to `constitution.js` is an amendment: say in the PR what behaviour it changes and why the rule is fairer.

## Author

Esteban Fuster Pozzi (@estebanrfp) - Full Stack JavaScript Developer

## License

MIT
