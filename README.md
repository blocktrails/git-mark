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
git mark genesis --txid <txid> --vout 0 --amount 1000000

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
const genesis = gm.genesis(txid, vout, amount);
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
txo:<network>:<txid>:<vout>?amount=<sats>&pubkey=<hex>[&commit=<git_hash>]
```

### Components

| Field | Description |
|-------|-------------|
| `network` | Bitcoin network (`tbtc4`, `mainnet`, `signet`) |
| `txid` | Transaction ID (64 hex chars) |
| `vout` | Output index |
| `amount` | Value in satoshis |
| `pubkey` | X-only pubkey (64 hex chars) |
| `commit` | Git commit hash (40 hex, absent for genesis) |

### Example

Genesis (no commit):
```
txo:tbtc4:34cea31b10e809e7cef4e19ce6e681da22ba1d2ae723af110cbba191e854be0e:0?amount=1000000&pubkey=3e458cc6f434c2292b3a23c044f4b046d5726c5ddee91c85f920c16817a5c8cf
```

After commit:
```
txo:tbtc4:45fbcbd79fc639204ae3dbe940881c66f7db1ad9b99eb49ff74fd83c481a9f7d:0?amount=999000&pubkey=b5bc388cf7a77362e7ec18cb4ba5ea9a9bc1cfd41b07322de3c40d20fa8e920c&commit=cf97baba489e88c1ffbe6758c0fe8c18ff83d17d
```

## How It Works

Git-mark uses single-use seals to bind Git commits to Bitcoin:

```
Genesis:   P₀ = privkey × G              (base pubkey)
Commit 1:  P₁ = P₀ + sha256(commit₁) × G  (tweaked by git commit)
Commit 2:  P₂ = P₁ + sha256(commit₂) × G
...
```

Each commit hash becomes a scalar tweak that derives the next pubkey. The UTXO chain on Bitcoin mirrors the commit chain in Git.

### Verification

Clients verify by:
1. Checking genesis has no commit
2. Computing `P_new = P_prev + sha256(commit) × G` for each step
3. Comparing computed pubkeys against recorded pubkeys

## Directory Structure

```
.well-known/
└── txo/
    └── txo.json      # Array of TXO URIs
```

## API Reference

### `new Gitmark(privateKey, network = 'tbtc4')`

Create a new Gitmark instance.

### `gm.genesis(txid, vout, amount)`

Initialize with genesis UTXO. Returns `{ txo, uri, address }`.

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
