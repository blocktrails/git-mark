/**
 * git-mark - Git commits anchored to Bitcoin via Blocktrails
 *
 * Uses git commit hashes directly as tweaks for pubkey derivation.
 * No additional hashing - the commit hash is already SHA-1.
 * TXO URIs track the on-chain state.
 */

import {
  p2trXonly,
  bytesToHex,
  hexToBytes
} from 'blocktrails';
import * as secp from '@noble/secp256k1';

// secp256k1 curve order
const N = secp.CURVE.n;

// Network HRPs for bech32m
const NETWORK_HRP = {
  mainnet: 'bc',
  tbtc4: 'tb',
  signet: 'tb',
  regtest: 'bcrt'
};

/**
 * Convert git commit hash to scalar (no additional hashing)
 * Git commit hash is already SHA-1, so we just interpret it as bigint mod n
 *
 * @param {string} commitHash - 40 hex char git commit hash
 * @returns {bigint} Scalar value in range [1, n-1]
 */
export function commitScalar(commitHash) {
  // Pad to 32 bytes (64 hex) for consistent bigint conversion
  // SHA-1 is 20 bytes, we pad with leading zeros
  const padded = commitHash.padStart(64, '0');
  const bytes = hexToBytes(padded);
  const t = bytesToBigInt(bytes) % N;

  if (t === 0n) {
    throw new Error('Invalid commit: scalar is zero');
  }

  return t;
}

/**
 * Derive chained public key from commits
 * P = P_base + scalar(commit₁)·G + scalar(commit₂)·G + ...
 *
 * @param {Uint8Array} publicKeyBase - Base public key (33 bytes compressed)
 * @param {string[]} commits - Array of commit hashes
 * @returns {Uint8Array} Derived public key (33 bytes compressed)
 */
function deriveChainedPublicKeyFromCommits(publicKeyBase, commits) {
  let P = secp.ProjectivePoint.fromHex(publicKeyBase);

  for (const commit of commits) {
    const t = commitScalar(commit);
    const tG = secp.ProjectivePoint.BASE.multiply(t);
    P = P.add(tG);
  }

  return P.toRawBytes(true);
}

/**
 * Derive chained private key from commits
 * d = d_base + scalar(commit₁) + scalar(commit₂) + ...
 *
 * @param {Uint8Array} privateKeyBase - Base private key (32 bytes)
 * @param {string[]} commits - Array of commit hashes
 * @returns {Uint8Array} Derived private key (32 bytes)
 */
function deriveChainedPrivateKeyFromCommits(privateKeyBase, commits) {
  let d = bytesToBigInt(privateKeyBase);

  for (const commit of commits) {
    const t = commitScalar(commit);
    d = (d + t) % N;
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
   * Initialize with genesis UTXO (no commit yet)
   * @param {string} txid - Genesis transaction ID
   * @param {number} vout - Output index
   * @param {number} amount - Amount in satoshis
   * @returns {Object} Genesis info
   */
  genesis(txid, vout, amount) {
    if (!validateTxid(txid)) {
      throw new Error('Invalid txid: must be 64 hex chars');
    }

    // Genesis pubkey is just the base pubkey (no tweaks yet)
    const pubkey = bytesToHex(p2trXonly(this.publicKeyBase));

    const txo = { txid, vout, amount, pubkey, commit: null };
    this.txos = [txo];
    this.commits = [];

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
      prevAddress: this.addressAt(this.commits.length - 1)
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
   * Get address at specific state index
   * @param {number} index - State index (0 = genesis, 1 = after first commit, etc.)
   * @returns {string} bech32m address
   */
  addressAt(index) {
    if (index < 0 || index > this.commits.length) {
      throw new Error('Index out of range');
    }

    if (index === 0) {
      return encodeBech32m(this.hrp, p2trXonly(this.publicKeyBase));
    }

    const states = this.commits.slice(0, index);
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
   * Verify a chain of TXO URIs
   * @param {string[]} uris - Array of TXO URI strings
   * @returns {Object} { valid: boolean, error?: string }
   */
  static verify(uris) {
    if (!Array.isArray(uris) || uris.length === 0) {
      return { valid: false, error: 'Empty or invalid URI array' };
    }

    const txos = uris.map(parseTxoUri);

    // Genesis should have no commit
    if (txos[0].commit) {
      return { valid: false, error: 'Genesis TXO should not have commit' };
    }

    // We need the base pubkey to verify - extract from genesis
    const genesisPubkey = txos[0].pubkey;
    if (!genesisPubkey || !validatePubkey(genesisPubkey)) {
      return { valid: false, error: 'Invalid genesis pubkey' };
    }

    // Try both Y parities (even=0x02, odd=0x03) since x-only loses parity info
    for (const prefix of [0x02, 0x03]) {
      const basePubkeyBytes = new Uint8Array(33);
      basePubkeyBytes[0] = prefix;
      basePubkeyBytes.set(hexToBytes(genesisPubkey), 1);

      const result = Gitmark._verifyWithBase(txos, basePubkeyBytes);
      if (result.valid) {
        return result;
      }
    }

    // Neither parity worked - return error from even parity attempt
    const basePubkeyBytes = new Uint8Array(33);
    basePubkeyBytes[0] = 0x02;
    basePubkeyBytes.set(hexToBytes(genesisPubkey), 1);
    return Gitmark._verifyWithBase(txos, basePubkeyBytes);
  }

  /**
   * Internal: verify with specific base pubkey
   */
  static _verifyWithBase(txos, basePubkeyBytes) {
    const commits = [];
    for (let i = 1; i < txos.length; i++) {
      const txo = txos[i];

      if (!txo.commit || !validateCommitHash(txo.commit)) {
        return { valid: false, error: `Invalid commit at index ${i}` };
      }

      commits.push(txo.commit);

      // Derive expected pubkey
      const expectedP = deriveChainedPublicKeyFromCommits(basePubkeyBytes, commits);
      const expectedPubkey = bytesToHex(p2trXonly(expectedP));

      if (expectedPubkey !== txo.pubkey) {
        return {
          valid: false,
          error: `Pubkey mismatch at index ${i}: expected ${expectedPubkey}, got ${txo.pubkey}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Load from TXO URIs (for verification/display only, no private key)
   * @param {string[]} uris - Array of TXO URI strings
   * @returns {Object} Loaded state info
   */
  static fromTxoUris(uris) {
    const txos = uris.map(parseTxoUri);
    const commits = txos.slice(1).map(t => t.commit).filter(Boolean);
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
      commits: [...this.commits],
      txos: [...this.txos],
      uris: this.txoUris()
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
