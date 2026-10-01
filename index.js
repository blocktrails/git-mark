/**
 * git-mark - Git commits anchored to Bitcoin via Blocktrails
 *
 * Blocktrails Core with the state being the commit hash as text: at every step
 *   t = TapTweak(x(P) || sha256(utf8(commit)))   P' = P + t·G   (on the full point, never its even-y lift)
 * Every TXO carries the commit it was tweaked by, the genesis one too; the base key is never an
 * output and travels with the trail as a full compressed point (pubkeyBase). This is the rule the
 * live trails follow (profile: blocktrails.org/spec/profiles/gitmark.html). TXO URIs track the
 * on-chain state.
 */

import {
  p2trXonly,
  bytesToHex,
  hexToBytes
} from 'blocktrails';
export { bytesToHex, hexToBytes };
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
// the Core scalar is computed here, not taken from the blocktrails package: the published 0.0.3
// still derives with the earlier simple rule (t = sha256(state), no key binding), which is not
// what the live trails use. BIP 340's tagged hash: sha256(sha256(tag) || sha256(tag) || msg)
const TAG = sha256(new TextEncoder().encode('TapTweak'));
const taggedTapTweak = (xOnly32, h32) => sha256(new Uint8Array([...TAG, ...TAG, ...xOnly32, ...h32]));

// secp256k1 curve order
const N = secp.CURVE.n;

// Network HRPs for bech32m
// sidestr chain ids behind the network names above (explorer: https://sidestr.com/explorer/?chain=<id>)
export const NETWORK_CHAIN = { gitmark: 'sidestr:gitmark' };
const NETWORK_HRP = {
  mainnet: 'bc',
  tbtc4: 'tb',
  signet: 'tb',
  regtest: 'bcrt',
  // sidestr chains (sidestr.com): the same taproot math; marks land in seconds and the chain is
  // checkpointed into the BLAKE2b testnet4. A network name has no colon (txo URIs split on ':'),
  // so the chain id is mapped here.
  gitmark: 'gm'
};

/**
 * The tweak for a commit at the current point: the Core scalar with the state being the commit's
 * 40 hex characters as text (sha256 of the text, then TapTweak with x(P)). Depends on the point.
 * @param {Uint8Array} pubkey - Current public key (33 bytes compressed)
 * @param {string} commitHash - 40 hex char git commit hash
 * @returns {bigint} Scalar value in range [1, n-1]
 */
export function commitScalar(pubkey, commitHash) {
  if (!validateCommitHash(commitHash)) throw new Error('Invalid commit: must be 40 hex chars lowercase');
  const h = sha256(new TextEncoder().encode(commitHash));           // the 40 hex characters as text
  const t = bytesToBigInt(taggedTapTweak(pubkey.slice(1), h)) % N;  // x(P) of the current point, as it is
  if (t === 0n) throw new Error('Invalid commit: scalar is zero');
  return t;
}

/**
 * Derive chained public key from commits (the package's chain, commits as string states)
 * P = P_base + t₀·G + t₁·G + …, each tᵢ from the point before it
 */
function deriveChainedPublicKeyFromCommits(publicKeyBase, commits) {
  let P = secp.ProjectivePoint.fromHex(publicKeyBase);
  for (const commit of commits) {
    const t = commitScalar(P.toRawBytes(true), commit);
    P = P.add(secp.ProjectivePoint.BASE.multiply(t)); // the point as it is: never lifted between steps
  }
  return P.toRawBytes(true);
}

/**
 * Derive chained private key from commits: d = d_base + t₀ + t₁ + … (mod n)
 */
function deriveChainedPrivateKeyFromCommits(privateKeyBase, commits) {
  let d = bytesToBigInt(privateKeyBase);
  for (const commit of commits) {
    const P = secp.ProjectivePoint.BASE.multiply(d).toRawBytes(true);
    d = (d + commitScalar(P, commit)) % N;
  }
  return bigIntToBytes(d, 32);
}

// Utility: bytes to bigint (big-endian)
function bytesToBigInt(bytes) {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) + BigInt(byte);
  }
  return result;
}

// Utility: bigint to bytes (big-endian)
function bigIntToBytes(num, length) {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(num & 0xffn);
    num >>= 8n;
  }
  return bytes;
}

/**
 * Parse a TXO URI string
 * Format: txo:<network>:<txid>:<vout>?amount=<sats>&pubkey=<hex>[&commit=<git_hash>]
 *
 * @param {string} uri - TXO URI string
 * @returns {Object} Parsed components
 */
export function parseTxoUri(uri) {
  if (!uri.startsWith('txo:')) {
    throw new Error('Invalid TXO URI: must start with txo:');
  }

  const [path, query] = uri.slice(4).split('?');
  const [network, txid, voutStr] = path.split(':');

  if (!network || !txid || voutStr === undefined) {
    throw new Error('Invalid TXO URI: missing network, txid, or vout');
  }

  const vout = parseInt(voutStr, 10);
  if (isNaN(vout) || vout < 0) {
    throw new Error('Invalid TXO URI: vout must be non-negative integer');
  }

  // Parse query params
  const params = {};
  if (query) {
    for (const pair of query.split('&')) {
      const [key, value] = pair.split('=');
      params[key] = decodeURIComponent(value);
    }
  }

  const amount = params.amount ? parseInt(params.amount, 10) : null;
  const pubkey = params.pubkey || null;
  const commit = params.commit || null;

  return { network, txid, vout, amount, pubkey, commit };
}

/**
 * Format a TXO URI from components
 *
 * @param {Object} obj - TXO components
 * @returns {string} TXO URI string
 */
export function formatTxoUri({ network, txid, vout, amount, pubkey, commit }) {
  let uri = `txo:${network}:${txid}:${vout}`;

  const params = [];
  if (amount != null) params.push(`amount=${amount}`);
  if (pubkey) params.push(`pubkey=${pubkey}`);
  if (commit) params.push(`commit=${commit}`);

  if (params.length > 0) {
    uri += '?' + params.join('&');
  }

  return uri;
}

/**
 * Validate a git commit hash (40 hex chars)
 * @param {string} hash - Git commit hash
 * @returns {boolean}
 */
export function validateCommitHash(hash) {
  return typeof hash === 'string' && /^[0-9a-f]{40}$/.test(hash);
}

/**
 * Validate a pubkey (64 hex chars, x-only)
 * @param {string} pubkey - X-only pubkey
 * @returns {boolean}
 */
export function validatePubkey(pubkey) {
  return typeof pubkey === 'string' && /^[0-9a-f]{64}$/.test(pubkey);
}

/**
 * Validate a txid (64 hex chars)
 * @param {string} txid - Transaction ID
 * @returns {boolean}
 */
export function validateTxid(txid) {
  return typeof txid === 'string' && /^[0-9a-f]{64}$/.test(txid);
}

/**
 * Gitmark - manages git commit anchoring to Bitcoin
 */
export class Gitmark {
  /**
   * @param {string|Uint8Array} privateKey - Private key (32 bytes hex or Uint8Array)
   * @param {string} network - Network name (default: tbtc4)
   */
  constructor(privateKey, network = 'tbtc4') {
    this.privateKeyBase = typeof privateKey === 'string'
      ? hexToBytes(privateKey)
      : privateKey;
    this.publicKeyBase = secp.getPublicKey(this.privateKeyBase, true);
    this.network = network;
    this.txos = []; // Array of { txid, vout, amount, pubkey, commit }
    this.commits = []; // Array of commit hashes (states)
  }

  /**
   * Get HRP for current network
   */
  get hrp() {
    return NETWORK_HRP[this.network] || 'tb';
  }

  /**
   * Initialize with the genesis UTXO and the first commit: the genesis output is the base key
   * tweaked by that commit (the base key itself is never an output)
   * @param {string} txid - Genesis transaction ID
   * @param {number} vout - Output index
   * @param {number} amount - Amount in satoshis
   * @param {string} commitHash - Git commit hash (40 hex chars)
   * @returns {Object} Genesis info
   */
  genesis(txid, vout, amount, commitHash) {
    if (!validateTxid(txid)) {
      throw new Error('Invalid txid: must be 64 hex chars');
    }
    if (!validateCommitHash(commitHash)) {
      throw new Error('Invalid commit hash: must be 40 hex chars lowercase (the genesis TXO carries the first commit)');
    }

    this.commits = [commitHash];
    const pubkey = bytesToHex(p2trXonly(deriveChainedPublicKeyFromCommits(this.publicKeyBase, this.commits)));

    const txo = { txid, vout, amount, pubkey, commit: commitHash };
    this.txos = [txo];

    return {
      txo,
      uri: formatTxoUri({ network: this.network, ...txo }),
      address: this.address()
    };
  }

  /**
   * Advance state with a git commit
   * @param {string} commitHash - Git commit hash (40 hex chars)
   * @param {string} txid - New transaction ID
   * @param {number} vout - Output index
   * @param {number} amount - Amount in satoshis
   * @returns {Object} Transition info
   */
  advance(commitHash, txid, vout, amount) {
    if (this.txos.length === 0) {
      throw new Error('Must call genesis() first');
    }

    if (!validateCommitHash(commitHash)) {
      throw new Error('Invalid commit hash: must be 40 hex chars lowercase');
    }

    if (!validateTxid(txid)) {
      throw new Error('Invalid txid: must be 64 hex chars');
    }

    // Add commit to states
    this.commits.push(commitHash);

    // Derive new pubkey using commit hash as state
    const newP = deriveChainedPublicKeyFromCommits(this.publicKeyBase, this.commits);
    const pubkey = bytesToHex(p2trXonly(newP));

    const txo = { txid, vout, amount, pubkey, commit: commitHash };
    this.txos.push(txo);

    return {
      txo,
      uri: formatTxoUri({ network: this.network, ...txo }),
      address: this.address(),
      prevAddress: this.addressAt(this.commits.length - 2)
    };
  }

  /**
   * Get current x-only pubkey
   * @returns {string} Hex pubkey (64 chars)
   */
  currentPubkey() {
    if (this.commits.length === 0) {
      return bytesToHex(p2trXonly(this.publicKeyBase));
    }
    const P = deriveChainedPublicKeyFromCommits(this.publicKeyBase, this.commits);
    return bytesToHex(p2trXonly(P));
  }

  /**
   * Get current Taproot address
   * @returns {string} bech32m address
   */
  address() {
    const wp = this.commits.length === 0
      ? p2trXonly(this.publicKeyBase)
      : p2trXonly(deriveChainedPublicKeyFromCommits(this.publicKeyBase, this.commits));
    return encodeBech32m(this.hrp, wp);
  }

  /**
   * Get address at a TXO index (0 = the genesis output, tweaked by the first commit; 1 = after the second commit, …)
   * @param {number} index - TXO index
   * @returns {string} bech32m address
   */
  addressAt(index) {
    if (index < 0 || index >= this.commits.length) {
      throw new Error('Index out of range');
    }

    const states = this.commits.slice(0, index + 1);
    const P = deriveChainedPublicKeyFromCommits(this.publicKeyBase, states);
    return encodeBech32m(this.hrp, p2trXonly(P));
  }

  /**
   * Get current spending private key
   * @returns {string} Hex private key (64 chars)
   */
  spendingKey() {
    if (this.commits.length === 0) {
      return bytesToHex(this.privateKeyBase);
    }
    const d = deriveChainedPrivateKeyFromCommits(this.privateKeyBase, this.commits);
    return bytesToHex(d);
  }

  /**
   * Get all TXO URIs
   * @returns {string[]} Array of TXO URI strings
   */
  txoUris() {
    return this.txos.map(txo => formatTxoUri({ network: this.network, ...txo }));
  }

  /**
   * Verify a chain of TXO URIs against the trail's base key: every link, not the head alone.
   * Each TXO must carry a commit; its expected pubkey is recomputed from the base and the commits so
   * far and compared with the pubkey the URI records (when it records one). The expected pubkeys are
   * returned too, so a caller with the chain can compare them with the outputs on-chain.
   * @param {string[]} uris - Array of TXO URI strings
   * @param {string} pubkeyBase - The base key: 33-byte compressed hex (02/03 + x); a bare x is read as the 02 point
   * @returns {Object} { valid: boolean, error?: string, expected?: string[] }
   */
  static verify(uris, pubkeyBase) {
    if (!Array.isArray(uris) || uris.length === 0) {
      return { valid: false, error: 'Empty or invalid URI array' };
    }
    const base = String(pubkeyBase || '').toLowerCase();
    const baseHex = /^0[23][0-9a-f]{64}$/.test(base) ? base : /^[0-9a-f]{64}$/.test(base) ? '02' + base : null;
    if (!baseHex) {
      return { valid: false, error: 'pubkeyBase is needed: the trail\'s base key as a compressed point (02/03 + x)' };
    }
    const basePubkeyBytes = hexToBytes(baseHex);

    const txos = uris.map(parseTxoUri);
    const commits = [];
    const expected = [];
    for (let i = 0; i < txos.length; i++) {
      const txo = txos[i];
      if (!txo || !txo.commit || !validateCommitHash(txo.commit)) {
        return { valid: false, error: `TXO ${i} carries no valid commit (every TXO does, the genesis one too)` };
      }
      commits.push(txo.commit);
      const expectedPubkey = bytesToHex(p2trXonly(deriveChainedPublicKeyFromCommits(basePubkeyBytes, commits)));
      expected.push(expectedPubkey);
      if (txo.pubkey && expectedPubkey !== txo.pubkey) {
        return {
          valid: false,
          error: `Pubkey mismatch at index ${i}: expected ${expectedPubkey}, got ${txo.pubkey}`,
          expected
        };
      }
    }

    return { valid: true, expected };
  }

  /**
   * Verify git ancestry of commits (requires git CLI)
   * Checks that each commit is a descendant of the previous
   * @param {string[]} commits - Array of commit hashes
   * @returns {Object} { valid: boolean, error?: string }
   */
  static verifyGitAncestry(commits) {
    if (!Array.isArray(commits) || commits.length < 2) {
      return { valid: true }; // Nothing to verify
    }

    // Dynamic import for execSync (only works in Node.js)
    let execSync;
    try {
      execSync = require('child_process').execSync;
    } catch {
      return { valid: false, error: 'Git ancestry check requires Node.js' };
    }

    for (let i = 1; i < commits.length; i++) {
      const ancestor = commits[i - 1];
      const descendant = commits[i];

      try {
        // Check if ancestor is an ancestor of descendant
        execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, {
          stdio: 'ignore'
        });
      } catch {
        return {
          valid: false,
          error: `Commit ${descendant.slice(0, 8)} is not a descendant of ${ancestor.slice(0, 8)}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Verify both EC_ADD chain and git ancestry
   * @param {string[]} uris - Array of TXO URI strings
   * @returns {Object} { valid: boolean, error?: string, ecValid?: boolean, gitValid?: boolean }
   */
  static verifyFull(uris, pubkeyBase) {
    // First verify EC_ADD chain
    const ecResult = Gitmark.verify(uris, pubkeyBase);
    if (!ecResult.valid) {
      return { ...ecResult, ecValid: false, gitValid: null };
    }

    // Extract commits and verify git ancestry
    const txos = uris.map(parseTxoUri);
    const commits = txos.map(t => t.commit).filter(Boolean);

    const gitResult = Gitmark.verifyGitAncestry(commits);

    return {
      valid: gitResult.valid,
      error: gitResult.error,
      ecValid: true,
      gitValid: gitResult.valid
    };
  }

  /**
   * Load from TXO URIs (for verification/display only, no private key)
   * @param {string[]} uris - Array of TXO URI strings
   * @returns {Object} Loaded state info
   */
  static fromTxoUris(uris) {
    const txos = uris.map(parseTxoUri);
    const commits = txos.map(t => t.commit).filter(Boolean);
    const network = txos[0]?.network || 'tbtc4';

    return {
      network,
      txos,
      commits,
      currentPubkey: txos[txos.length - 1]?.pubkey || null
    };
  }

  /**
   * Export for .well-known/txo/txo.json
   * @returns {string[]} Array of TXO URI strings
   */
  exportTxoJson() {
    return this.txoUris();
  }

  /**
   * Export full state
   * @returns {Object}
   */
  export() {
    return {
      network: this.network,
      publicKeyBase: bytesToHex(this.publicKeyBase),
      pubkeyBase: bytesToHex(this.publicKeyBase),
      commits: [...this.commits],
      txos: [...this.txos],
      uris: this.txoUris()
    };
  }

  /**
   * The trail as blocktrails.json: what a verifier reads (base key as a full point, the states,
   * the TXO URIs)
   * @returns {Object}
   */
  trail() {
    return {
      '@type': 'Blocktrail',
      version: '0.0.3',
      profile: 'gitmark',
      pubkeyBase: bytesToHex(this.publicKeyBase),
      chain: this.network,
      states: [...this.commits],
      txo: this.txoUris()
    };
  }

  /**
   * Import state (requires private key for signing)
   * @param {Object} data - Exported data
   */
  import(data) {
    this.network = data.network || this.network;
    this.commits = [...(data.commits || [])];
    this.txos = [...(data.txos || [])];
  }
}

// Bech32m encoding for P2TR addresses
const BECH32M_CONST = 0x2bc830a3;
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (const c of hrp) {
    ret.push(c.charCodeAt(0) >> 5);
  }
  ret.push(0);
  for (const c of hrp) {
    ret.push(c.charCodeAt(0) & 31);
  }
  return ret;
}

function bech32CreateChecksum(hrp, data, spec) {
  const values = [...bech32HrpExpand(hrp), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ spec;
  const ret = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 31);
  }
  return ret;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }
  return ret;
}

function encodeBech32m(hrp, witnessProgram) {
  const version = 1; // P2TR is witness version 1
  const data = [version, ...convertBits(witnessProgram, 8, 5, true)];
  const checksum = bech32CreateChecksum(hrp, data, BECH32M_CONST);
  return hrp + '1' + [...data, ...checksum].map(d => CHARSET[d]).join('');
}

export { encodeBech32m };
