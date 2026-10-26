# stellar.chat

## Summary

stellar.chat is an AI security audit service for Stellar (Soroban) contracts, powered by [Savant Chat](https://savant.chat).

Services like this are a quality-control step, not a substitute for a manual audit. A human audit is still where novel economic design and cross-protocol invariants get judged. An automated pass belongs earlier: in CI/CD, on each change, so known bug classes are caught before review and before a senior auditor spends time on them.

The same audit covers more than the smart contracts. It is language-agnostic and reviews the project as a whole: the contracts, the ZK circuits and cryptography, the node and infrastructure, and the off-chain services that touch keys. Solidity, Vyper, Rust, and the rest of the stack go through one pipeline.

The app on port 5173 edits source, asks Savant Chat for a price, and starts an audit only after a tier is chosen. The editor opens on `self-transfer-mint.rs`.

## Setup

For the audit app:

- Node.js and npm.
- A Savant API key. Create it in the [Savant Chat](https://savant.chat) UI while signed in. The full key (`svk_…`) is shown once. The key acts as the user who created it and spends that account’s balance. Requests use `Authorization: Bearer <key>` against `https://savant.chat`.

For the contracts:

- Rust 1.91.0, pinned in `contracts/rust-toolchain.toml`.
- The `wasm32v1-none` target, listed in that same file.
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli) for `stellar contract build`.
- `soroban-sdk` 29.0.1 in `contracts/self-transfer-mint`, and exactly 25.2.0 in `contracts/fr-nullifier`. Do not bump the nullifier crate onto a patched SDK if the point is to keep CVE-2026-32322.

The contracts are not wired to a network, a deploy account, or a local node.

## Test samart contracts

**Self-transfer mint** (`contracts/self-transfer-mint`). `transfer_internal` reads the sender and recipient balances into local variables before it writes storage. If `from` and `to` are the same address, both reads hit one `Balance` key. The second write puts the stale snapshot back, plus `value`. A transfer to yourself increases that balance by `value`. `total_supply` does not change, so the sum of balances no longer matches the supply.

**Unreduced scalar equality** (`contracts/fr-nullifier`). `FrNullifier.spend` treats a BN254 `Fr` nullifier as already spent only when `==` matches a stored one. `soroban-sdk` 25.2.0 is in the affected range of CVE-2026-32322 (patched in 25.3.0). `Fr` is a raw `U256`: `from_bytes` does not reduce modulo the field order, and `PartialEq` compares those bytes. Two writings of the same field element — one canonical, one unreduced (`>= r`) — are not equal, so `spend` accepts the second one.

## Installation

Audit app:

```bash
npm install
npm run dev
```

The dev server listens on [http://localhost:5173](http://localhost:5173) and proxies audit calls to Savant. `npm run build` typechecks and writes the static app.

Contracts:

```bash
cd contracts/self-transfer-mint && cargo check
cd contracts/fr-nullifier && cargo check
stellar contract build
```

Run `stellar contract build` inside the crate you want as wasm.

## Environment variables

| Variable | Who reads it | Purpose |
| --- | --- | --- |
| `SAVANT_API_KEY` | `server/audit.mjs`, when `npm run dev` is running | Savant API key (`svk_…`) |

The contracts do not read the environment. Copy nothing into the repo: `.env.example` only says where the key comes from. On macOS, if the variable is unset, the dev server also tries `launchctl getenv SAVANT_API_KEY`.

```bash
export SAVANT_API_KEY=svk_...
npm run dev
```

## Demo

1. Export `SAVANT_API_KEY` and start `npm run dev`.
2. Open [http://localhost:5173](http://localhost:5173). The editor loads the self-transfer example. **Load example** restores it. **Open** and **Archive** replace it with a file or a zip / tar / tar.gz.
3. **Run audit** asks Savant for Lite, Advanced, and Pro estimates. Nothing is charged yet. The quote screen shows each tier’s cost.
4. Choose a tier. The app polls until the report is ready. Savant’s own page for a typical run is 10–30 minutes; this UI says about 10–15. Closing the tab does not stop the job. The report lists findings; a link opens the same audit in the Savant dashboard.
5. To try the other bug, paste `contracts/fr-nullifier/src/lib.rs` into the editor, or open that file, then run the audit again.
