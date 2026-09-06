# dCode | Code with a timeline, and no server

A code host for projects that are **one HTML file**, with branches, forks and pull requests — and no server. Every commit is a signed node in a [GenosDB](https://github.com/estebanrfp/gdb) graph that lives in your browser and syncs peer-to-peer over WebRTC, and every commit is a whole page, so every row of the timeline **runs**. Nobody hosts it, nobody can rewrite your history, and nobody can move your branch: the engine's ownership rules do what GitHub runs servers for.

**Live:** [estebanrfp.github.io/dCode](https://estebanrfp.github.io/dCode/) · **Engine:** [GenosDB](https://github.com/estebanrfp/gdb) — if this is interesting, [star the engine ★](https://github.com/estebanrfp/gdb): that is where the work is.

Plain HTML, CSS and JavaScript. No framework, no build step, no backend. Four files.

## What is different from a code host

| On GitHub | On dCode |
|---|---|
| A server holds the repositories | Every visitor holds the graph; peers sync it directly over WebRTC |
| An account is a row in a database | An identity is a key pair on your device: a mnemonic recovers it, a passkey keeps it |
| Branch protection is a server rule | A branch is a node its owner owns: only the owner, and the addresses granted `write`, can move its head — refused on every peer otherwise |
| A commit is trusted because the server says so | A commit's id begins with its author's address and ends with a hash of its content: nobody else can create it, rewrite it or delete it, anywhere |
| A pull request's state is a column | Whether a proposal is merged is read from the graph by every peer: the proposed commit is an ancestor of the target's head, or it is not |
| History is browsed | History **runs**: a project is one HTML file, so any commit opens in a sandboxed frame as it was |
| Offline is an error | A commit made with no peer in sight waits on this device's disk and lands when a path exists, signed like any other |

## The model

Four kinds of node, each owned by whoever wrote it:

- **repository** — a name and a description. Its branches belong to whoever created them.
- **branch** — a name and a `head`. The owner grants `write` to collaborators with `db.sm.acls.grant`; anyone else who commits gets a branch of their own, forked from the head they stood on. Two writers moving one head at once: the hybrid logical clock keeps one, the other commit stays in the graph, behind, and merges like any other.
- **commit** — the whole file, a message, its parents and the branch it was made on. Its id is `<author>:<sha-256 of repo, parents, message, content, time>`.
- **pull request** — a proposal from one branch into another, with the commit it proposes. The proposer updates or withdraws it; the target's owner merges it — a fast-forward when the target's head is an ancestor of the proposal, a merge commit with two parents otherwise, made by a line-based three-way merge. Conflicts go to the owner's editor with the usual markers, and the commit made from there is the merge.

The working copy is local, per branch, like git's working tree: the commit is what travels.

## The constitution

[`constitution.js`](constitution.js) is rendered verbatim on the site's **constitution** page. Writing is free from the first second — every write can only create or change a node you own — so there is no ladder to climb and no authority to wait for. The authority's only power is to restrict an identity, with its signature; it cannot touch a repository, a branch or a commit it does not own.

**To change a rule, open a pull request.** The discussion is public, the diff is the amendment, and the site renders the file as merged.

## What it demonstrates of GenosDB

- **Ownership enforced on every peer.** `db.sm.acls.set` makes the creator the owner; live or through catch-up, the engine refuses anyone else's edit or deletion. Branch protection and immutable history are the same rule read twice.
- **Ids that carry their author.** A node whose id begins with an address can only be created by that address, on a peer that never saw it — which is what lets a commit name itself by its content.
- **Collaborators as data.** `grant` and `revoke` on the branch node, honoured by every receiver; no server decides who may push.
- **Derived state from one subscription.** One `db.map` feeds a store; branches, the timeline, the diff and every pull request's state are pure functions of it.
- **Identity with no server.** Mnemonic recovery, passkey sessions, and demo identities so two windows can meet in one click.

## Run it

Serve the folder with any static server — there is nothing to build:

```bash
bun tests/server.mjs        # http://localhost:5805
```

Two useful query parameters: `?room=anything` opens a private sandbox of the whole site (the tests use it), and `?relay=ws://…` points signalling at a relay of your own.

**Demo identities.** The sign-in page offers three one-click identities from the GenosDB design guide: `alice`, `bob`, and the `constitution` authority. Open two browsers, create a repository as Alice in one, open it as Bob in the other: Bob's commit goes to a branch of his own, his pull request appears on Alice's side, and her merge moves `main` everywhere.

## Tests

```bash
pnpm install
pnpm test
```

Playwright, one `BrowserContext` per simulated visitor (own storage, own identity), a fresh room per test, real WebRTC between them. Six tests in four files:

- `tests/repo.spec.js` — a repository and its commits crossing to another visitor under the same ids, the head and an older version running in the frame, the diff of a commit; the working copy that belongs to the device.
- `tests/branches.spec.js` — a fork, a pull request, a proposal brought up to date and a fast-forward merge; a tampered client that writes another's branch head and is refused by every receiver, proved against a later write that lands; a collaborator granted `write` who moves the head directly, and is back to forking once revoked.
- `tests/merge.spec.js` — divergent edits on different lines merged into one commit with two parents; the same line changed both ways, the conflict markers in the owner's editor, the refusal to commit them, and the merge commit made from the resolution.
- `tests/sync.spec.js` — a repository and a commit made with no peer in sight, read back from this device's disk and delivered once it is back.

Signalling goes through the public relays; set `DCODE_RELAY=ws://…` to use a local one, which makes discovery immediate.

## Contributing

Pull requests are welcome — to the code, and to the constitution. A change to `constitution.js` is an amendment: say in the PR what behaviour it changes and why the rule is fairer.

## Author

Esteban Fuster Pozzi (@estebanrfp) - Full Stack JavaScript Developer

## License

MIT
