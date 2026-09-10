// Private repositories: the engine keeps the key, this module seals the code.
//
// A private repository has a vault: one encrypted node (`db.sm.put`) holding
// its key ring, newest key first. The owner grants `read` on that one node to
// each member — a key envelope per reader, wrapped and rotated by the engine —
// and every line and every commit of the repository is sealed with the current
// key before it is written as an ordinary node. Members open it on arrival;
// everyone else syncs ciphertext. Revoking a member turns both keys: the
// vault's, by the engine, and the repository's, a new one on the ring, so
// what is written afterwards is unreadable to them.
//
// It arrives the first time this room shows something sealed, and never
// before: a room with no private repository never downloads a line of it.
// The key ring itself stays in the shell, because a synchronous "is this
// sealed for me?" is asked all over the app; what is here is the crypto and
// the vault's protocol.
import { db, me, nodes, keyRings, unlocking, scheduleRender, remountBuffer } from "@app"

const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const newKeyHex = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")
const importKey = (hex) => crypto.subtle.importKey("raw", Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16)), "AES-GCM", false, ["encrypt", "decrypt"])

export const seal = async (repo, text) => {
  const key = keyRings.get(repo)?.[0]; if (!key) throw new Error("No key for this repository on this device")
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return `${b64(iv)}.${b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text))))}`
}
export const unseal = async (repo, sealed) => {
  const [iv, ct] = sealed.split(".").map(unb64)
  for (const key of keyRings.get(repo) ?? []) { try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)) } catch {} }
  return null
}
/** Fetch the vault: with an envelope the ring opens; without one the repository stays sealed for this identity. */
export const unlock = async (repoId) => {
  const repo = nodes.get(repoId); if (!repo?.value.vault || !me || unlocking.has(repoId)) return false
  unlocking.add(repoId)
  try {
    const { result } = await db.sm.get(repo.value.vault).catch(() => ({ result: null }))
    if (!result?.decrypted || !Array.isArray(result.value.keys)) { keyRings.set(repoId, null); return false }
    keyRings.set(repoId, await Promise.all(result.value.keys.map(importKey)))
    await decryptStored(repoId)
    return true
  } finally { unlocking.delete(repoId); scheduleRender() }
}
/** Open every sealed line and commit of the repository already in the store, then redraw. */
const decryptStored = async (repoId) => {
  for (const n of [...nodes.values()]) {
    if (n.value.repo !== repoId || n.value.ct === undefined) continue
    const text = await unseal(repoId, n.value.ct)
    if (text === null) continue
    if (n.value.type === "line") n.value.text = text; else if (n.value.type === "commit") n.value.content = text
  }
  remountBuffer(repoId) // the buffer on screen, if it is this repository's, now has text to show
}
/** A new repository's vault: the first key, sealed for its owner alone. Returns the node the repository points at. */
export const createVault = async (repo) => {
  const hex = newKeyHex()
  const vault = await db.sm.put({ type: "vault", repo, keys: [hex] })
  keyRings.set(repo, [await importKey(hex)])
  return vault
}
/** Turn the repository's key: a new one at the head of the ring, written into the vault the engine has just re-wrapped. */
export const turnKey = async (repo) => {
  const { result } = await db.sm.get(repo.value.vault), hex = newKeyHex()
  await db.sm.put({ ...result.value, keys: [hex, ...result.value.keys] }, repo.value.vault)
  keyRings.set(repo.id, [await importKey(hex), ...(keyRings.get(repo.id) ?? [])])
}
