/**
 * The constitution of dCode.
 *
 * Everything that decides who may do what here is in this file, and nowhere
 * else. The app renders it verbatim on the "constitution" page, so the rules
 * you read there are the rules that run. Changing them is a pull request.
 *
 * The rules are ENFORCED BY THE ENGINE. GenosDB's Security Manager signs
 * every operation and every peer verifies it: a node can only be changed by
 * its owner or by an address its owner granted, a role is only valid with the
 * authority's signature, and an operation outside a role's permissions is
 * refused on every receiver. Nobody can act outside them — not the authority,
 * not the person who deployed the page.
 *
 * What GitHub runs servers for, the engine supplies:
 *
 *  - A COMMIT is a node its author owns. Its id begins with the author's
 *    address and ends with a hash of what it contains, so nobody else can
 *    create it, rewrite it or delete it, on any peer.
 *  - A BRANCH is a node its owner owns, with a `head`. Only the owner, and
 *    the addresses the owner granted `write`, can move it. That is branch
 *    protection, with no server to enforce it.
 *  - A PULL REQUEST is a node its proposer owns. Merging is the target's
 *    owner writing a merge commit and moving their own head; whether a pull
 *    request is merged is derived by every peer from the graph — the
 *    proposed commit is an ancestor of the target's head, or it is not.
 *  - A REPOSITORY is a node its owner owns: a name and a description. Its
 *    branches belong to whoever created them; a fork is a branch you own in
 *    someone else's repository.
 */

// Public, throwaway demo identities (they protect nothing), so every window
// of the demo can sign in with one click — the canonical set of the GenosDB
// design guide. A production deployment ships no mnemonic in its source.
export const SUPERADMIN = {
  name: "constitution", emoji: "🛡️",
  mnemonic: "panic now afford carbon donate lecture drift excite collect essay stuff prosper",
  address: "0xbfDe0eCEC5332Fd86D2570085571D6051Df098dA",
}
export const ALICE = {
  name: "alice", emoji: "👩‍🦰",
  mnemonic: "prosper fossil kitten crisp view spread jeans shield prosper myself awake usage",
  address: "0x3546D4BA0ac3bfDea3F1511F82a078DDdb3F4931",
}
export const BOB = {
  name: "bob", emoji: "👨‍🦱",
  mnemonic: "salmon grant recall neutral banner glow pluck divert cactus theory rally ship captain shaft cactus",
  address: "0x8089C0480139d85D82c1E20eeF08a77EF8cD7DEC",
}
export const DEMO_IDENTITIES = [ALICE, BOB, SUPERADMIN]

export const CONSTITUTION = {
  /** The one address whose signature makes a role valid. Its only power. */
  authority: SUPERADMIN.address,

  /**
   * What each role may do. Enforced by the engine on every peer. Writing is
   * free from the first second — as on any code host, you sign up and you
   * push — because a write can only ever create or change a node you own.
   */
  roles: {
    guest:      { can: ["read", "sync", "write", "link"] },
    restricted: { can: ["read", "sync"] },
    superadmin: { can: ["assignRole"], inherits: ["guest"] },
  },
  roleText: {
    guest: "Everyone, from the first second: reads everything and writes nodes of its own — repositories, branches, commits, pull requests — and nothing else. There is no ladder to climb.",
    restricted: "Lost the right to write. Reads and syncs like anyone; its repositories, branches and commits stay exactly where they are, signed by it.",
    superadmin: "The authority. Its only power is to restrict an identity, with its signature. It cannot touch a repository, a branch or a commit it does not own.",
  },

  /** No governance rules: nobody is promoted, because nobody needs to be. */
  rules: [],

  /** What ownership means here — the engine's rule, read as a code host. */
  principles: [
    ["A commit is immutable", "Its id begins with its author's address and ends with a hash of its content, parents, message and time. No other identity can create a node under that id, and the author cannot rewrite it without changing the id."],
    ["A branch is protected", "Only its owner and the addresses granted `write` on it can move its head. Anyone else's write is refused on every peer — there is no server to ask, and none to compromise."],
    ["Two pushes at once", "If two writers move the same head at the same moment, the hybrid logical clock keeps one; the other commit stays in the graph, behind, and merges like any other. The same outcome as a rejected non-fast-forward push, without the error."],
    ["A fork is yours", "A fork is a branch you own in someone else's repository, pointing at any commit. Nobody can move it but you."],
    ["A pull request is a proposal", "It is a node its proposer owns. The target's owner merges by writing a merge commit and moving their own head; whether the proposal is merged is read from the graph by every peer, not written by anyone."],
    ["Offline is normal", "A commit made with no peer in sight is a commit. It reaches the others when a path exists, signed, and lands only if the rules above allow it."],
  ],

  /** How this file changes. */
  amendment: "This constitution is a file in the repository. To change a rule, open a pull request. The discussion is public, the diff is the amendment, and the app renders the file as merged.",
}

/** The rules as the engine takes them — the human text stays here. */
export const governanceRules = CONSTITUTION.rules.map(({ text, ...rule }) => rule)
