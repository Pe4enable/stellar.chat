# stellar.chat

## Summary

The repository contains Stellar (Soroban) smart contracts and a web app that sends a contract to Savant for an audit. `SuperToken` in `contracts/self-transfer-mint` is a Soroban port of a simple fungible token (`soroban-sdk` 29.0.1). The contract mints a fixed supply in the constructor and exposes `transfer`, `approve`, and `transfer_from`.

## Problem

In `transfer_internal`, the sender and recipient balances are read into local variables before they are written to storage. If `from` and `to` are the same address, the second write overwrites the already reduced balance with a stale snapshot. A self-transfer increases the balance by the transfer amount, and `total_supply` does not change. The sum of balances diverges from the stated supply.

## Setup

Required to build the contract:

- Rust 1.91.0. The version is pinned in `contracts/rust-toolchain.toml`.
- The `wasm32v1-none` target (listed in the same file).
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli) — the `stellar contract build` command.
- Contract dependency: `soroban-sdk` 29.0.1 (`contracts/self-transfer-mint/Cargo.toml`).

The network (local / testnet / mainnet), the deploy account, and how to run a node are not specified in the repository.

The audit app reads `SAVANT_API_KEY` from the environment. Do not commit the key.

## Installation

```bash
cd contracts/self-transfer-mint
cargo check
stellar contract build
```

The web app:

```bash
npm install
npm run dev
```

## Environment variables

The contract does not read environment variables. The dev server reads `SAVANT_API_KEY` from the process environment. See `.env.example`. Do not put the key in the repository.

## Demo

`npm run dev` opens the audit UI. The example contract is `contracts/self-transfer-mint/src/lib.rs`. **Run audit** asks Savant for an advanced price. The audit starts only after **Start advanced**.
