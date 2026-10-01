# git-mark

Git commits anchored to Bitcoin via [Blocktrails](https://blocktrails.org).

## Install

```bash
npm install git-seal
```

## CLI Usage

```bash
# Initialize in your repo
git mark init

# Set your private key
git config nostr.privkey <64-char-hex>

# Create genesis with your first UTXO
git mark genesis --txid <txid> --vout 0 --amount 1000000 [--commit <hash>]   # the first commit; default HEAD

# Make changes and commit
git commit -m "initial state"

# Anchor the commit to Bitcoin
git mark advance --txid <new-txid> --vout 0 --amount 999000

# Show current state
git mark show

# Verify chain integrity
git mark verify

# Show current address
git mark address

# Export txo.json
git mark export
```

## Library Usage

```javascript
import { Gitmark } from 'git-seal';

// Create instance with private key
const gm = new Gitmark(privateKey, 'tbtc4');

// Initialize genesis
const genesis = gm.genesis(txid, vout, amount, commitHash); // the genesis TXO carries the first commit
console.log(genesis.address); // tb1p...
console.log(genesis.uri);     // txo:tbtc4:...

// Advance with git commit
const commitHash = 'cf97baba489e88c1ffbe6758c0fe8c18ff83d17d';
const result = gm.advance(commitHash, newTxid, vout, amount);

// Get current state
console.log(gm.address());
console.log(gm.currentPubkey());
console.log(gm.spendingKey());

// Export TXO URIs
const uris = gm.exportTxoJson();

// Verify a chain (no private key needed)
const valid = Gitmark.verify(uris);
if (!valid.valid) console.error(valid.error);
```

## TXO URI Format

```
txo:<network>:<txid>:<vout>?amount=<sats>&commit=<git_hash>[&pubkey=<hex>]
```

### Components

| Field | Description |
|-------|-------------|
| `network` | Bitcoin network (`tbtc4`, `mainnet`, `signet`) |
| `txid` | Transaction ID (64 hex chars) |
| `vout` | Output index |
| `amount` | Value in satoshis |
| `commit` | Git commit hash (40 hex): every TXO carries one, the genesis one too |
| `pubkey` | X-only pubkey (64 hex chars), optional: a verifier recomputes it from the base key and the commits |

### Example

Genesis (tweaked by the first commit; the base key itself is never an output):
```
txo:tbtc4:51d87101b7cbb01cc5a68785bf3141ec6fd00894d71ab1168d4daa20420eeacf:0?amount=999700&commit=9adc596cfd1100333393a12f2f41b2d820f16d0b
```

After commit:
```
txo:tbtc4:45fbcbd79fc639204ae3dbe940881c66f7db1ad9b99eb49ff74fd83c481a9f7d:0?amount=999000&pubkey=b5bc388cf7a77362e7ec18cb4ba5ea9a9bc1cfd41b07322de3c40d20fa8e920c&commit=cf97baba489e88c1ffbe6758c0fe8c18ff83d17d
```

## How It Works

Git-mark uses single-use seals to bind Git commits to Bitcoin:

```
Base:      P_base = privkey × G                                    (published with the trail, as 02/03 + x)
Genesis:   P₀ = P_base + t₀ × G,  t₀ = TapTweak(x(P_base) || sha256(commit₀))
Commit 1:  P₁ = P₀ + t₁ × G,      t₁ = TapTweak(x(P₀) || sha256(commit₁))
...
```

This is Blocktrails Core with the state being the commit hash as text (the 40 hex characters, hashed). Each tweak depends on the point before it, and is added to that point as it is — never to its even-y lift — so the private and public derivations agree at every step whatever the parity along the way. The output of each mark is `x(Pᵢ)`; the sign a BIP 340 signature needs is applied only when signing. The UTXO chain on Bitcoin mirrors the commit chain in Git.

### Verification

Clients verify, from the trail's base key (`pubkeyBase`, a full compressed point, nothing to guess):
1. Walking every link: `tᵢ = TapTweak(x(Pᵢ₋₁) || sha256(commitᵢ))`, `Pᵢ = Pᵢ₋₁ + tᵢ × G`
2. Comparing `x(Pᵢ)` with the output on-chain (or the pubkey the URI records)
3. Every link, not the head alone: the head commits only to the sum of the tweaks; the intermediate outputs pin each commit in its place

## Directory Structure

```
.well-known/
└── txo/
    └── txo.json      # Array of TXO URIs
```

## API Reference

### `new Gitmark(privateKey, network = 'tbtc4')`

Create a new Gitmark instance.

### `gm.genesis(txid, vout, amount, commitHash)`

Initialize with the genesis UTXO and the first commit (the genesis output is the base key tweaked by it). Returns `{ txo, uri, address }`.

### `gm.trail()`

The trail as `blocktrails.json`: `{ '@type', version, profile: 'gitmark', pubkeyBase, chain, states, txo }`, what a verifier reads.

### `Gitmark.verify(uris, pubkeyBase)`

Walk every link from the base key. Returns `{ valid, error?, expected }` with the expected x-only output of every TXO.

### `gm.advance(commitHash, txid, vout, amount)`

Advance state with a git commit. Returns `{ txo, uri, address, prevAddress }`.

### `gm.address()`

Get current Taproot address.

### `gm.currentPubkey()`

Get current x-only pubkey (64 hex chars).

### `gm.spendingKey()`

Get current spending private key.

### `gm.txoUris()`

Get array of TXO URI strings.

### `gm.exportTxoJson()`

Export URIs for `.well-known/txo/txo.json`.

### `Gitmark.verify(uris)`

Verify a chain of TXO URIs. Returns `{ valid: boolean, error?: string }`.

### `parseTxoUri(uri)`

Parse a TXO URI string into components.

### `formatTxoUri(obj)`

Format components into a TXO URI string.

## Links

- [Blocktrails](https://blocktrails.org)
- [Blocktrails Spec](https://blocktrails.org/spec/)
- [Legacy gitmark](https://git-mark.com)
- [Single-Use Seals](https://petertodd.org/2016/commitments-and-single-use-seals)

## License

MIT

## Networks

`tbtc4` (default), `mainnet`, `signet`, `regtest`, and `gitmark`: a [sidestr](https://sidestr.com)
sidechain beside the BLAKE2b testnet4 made for trails — addresses `gm1p…`, transactions mined in
seconds, and the chain's tip checkpointed into testnet4 every few blocks, so the parent's proof of
work bounds when a mark was made. Get trail dust from the faucet in the
[sidestr wallet](https://sidestr.com/wallet/?chain=sidestr:gitmark), send it to `git mark address`,
and `git mark advance` with the txid the wallet shows. Explorer:
https://sidestr.com/explorer/?chain=sidestr:gitmark.
