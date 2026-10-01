/**
 * git-mark test suite
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  Gitmark,
  parseTxoUri,
  formatTxoUri,
  validateCommitHash,
  validatePubkey,
  validateTxid,
  encodeBech32m,
  bytesToHex
} from '../index.js';

// Test data
const TEST_PRIVKEY = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
const TEST_TXID = '34cea31b10e809e7cef4e19ce6e681da22ba1d2ae723af110cbba191e854be0e';
const TEST_COMMIT = 'cf97baba489e88c1ffbe6758c0fe8c18ff83d17d';
const TEST_COMMIT2 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const TEST_COMMIT0 = '0123456789abcdef0123456789abcdef01234567'; // the genesis TXO carries the first commit
const BASE = bytesToHex(new Gitmark(TEST_PRIVKEY).publicKeyBase);

describe('TXO URI parsing', () => {
  test('parses complete URI', () => {
    const uri = 'txo:tbtc4:34cea31b10e809e7cef4e19ce6e681da22ba1d2ae723af110cbba191e854be0e:0?amount=1000000&pubkey=3e458cc6f434c2292b3a23c044f4b046d5726c5ddee91c85f920c16817a5c8cf&commit=cf97baba489e88c1ffbe6758c0fe8c18ff83d17d';
    const parsed = parseTxoUri(uri);

    assert.strictEqual(parsed.network, 'tbtc4');
    assert.strictEqual(parsed.txid, '34cea31b10e809e7cef4e19ce6e681da22ba1d2ae723af110cbba191e854be0e');
    assert.strictEqual(parsed.vout, 0);
    assert.strictEqual(parsed.amount, 1000000);
    assert.strictEqual(parsed.pubkey, '3e458cc6f434c2292b3a23c044f4b046d5726c5ddee91c85f920c16817a5c8cf');
    assert.strictEqual(parsed.commit, 'cf97baba489e88c1ffbe6758c0fe8c18ff83d17d');
  });

  test('parses genesis URI (no commit)', () => {
    const uri = 'txo:tbtc4:34cea31b10e809e7cef4e19ce6e681da22ba1d2ae723af110cbba191e854be0e:0?amount=1000000&pubkey=3e458cc6f434c2292b3a23c044f4b046d5726c5ddee91c85f920c16817a5c8cf';
    const parsed = parseTxoUri(uri);

    assert.strictEqual(parsed.commit, null);
    assert.strictEqual(parsed.amount, 1000000);
  });

  test('parses minimal URI', () => {
    const uri = 'txo:mainnet:abcd1234:1';
    const parsed = parseTxoUri(uri);

    assert.strictEqual(parsed.network, 'mainnet');
    assert.strictEqual(parsed.txid, 'abcd1234');
    assert.strictEqual(parsed.vout, 1);
    assert.strictEqual(parsed.amount, null);
  });

  test('rejects invalid prefix', () => {
    assert.throws(() => {
      parseTxoUri('btc:mainnet:abcd:0');
    }, /must start with txo:/);
  });
});

describe('TXO URI formatting', () => {
  test('formats complete URI', () => {
    const uri = formatTxoUri({
      network: 'tbtc4',
      txid: TEST_TXID,
      vout: 0,
      amount: 1000000,
      pubkey: 'abcd1234',
      commit: TEST_COMMIT
    });

    assert.ok(uri.startsWith('txo:tbtc4:'));
    assert.ok(uri.includes('amount=1000000'));
    assert.ok(uri.includes('pubkey=abcd1234'));
    assert.ok(uri.includes('commit=' + TEST_COMMIT));
  });

  test('formats genesis URI (no commit)', () => {
    const uri = formatTxoUri({
      network: 'tbtc4',
      txid: TEST_TXID,
      vout: 0,
      amount: 1000000,
      pubkey: 'abcd1234',
      commit: null
    });

    assert.ok(!uri.includes('commit='));
  });

  test('roundtrip parse/format', () => {
    const original = {
      network: 'tbtc4',
      txid: TEST_TXID,
      vout: 2,
      amount: 500000,
      pubkey: 'deadbeef'.repeat(8),
      commit: TEST_COMMIT
    };

    const uri = formatTxoUri(original);
    const parsed = parseTxoUri(uri);

    assert.strictEqual(parsed.network, original.network);
    assert.strictEqual(parsed.txid, original.txid);
    assert.strictEqual(parsed.vout, original.vout);
    assert.strictEqual(parsed.amount, original.amount);
    assert.strictEqual(parsed.pubkey, original.pubkey);
    assert.strictEqual(parsed.commit, original.commit);
  });
});

describe('Validators', () => {
  test('validateCommitHash accepts valid', () => {
    assert.strictEqual(validateCommitHash(TEST_COMMIT), true);
    assert.strictEqual(validateCommitHash('a'.repeat(40)), true);
  });

  test('validateCommitHash rejects invalid', () => {
    assert.strictEqual(validateCommitHash('abc'), false);
    assert.strictEqual(validateCommitHash('A'.repeat(40)), false); // uppercase
    assert.strictEqual(validateCommitHash('g'.repeat(40)), false); // non-hex
  });

  test('validatePubkey accepts valid', () => {
    assert.strictEqual(validatePubkey('a'.repeat(64)), true);
  });

  test('validatePubkey rejects invalid', () => {
    assert.strictEqual(validatePubkey('a'.repeat(63)), false);
    assert.strictEqual(validatePubkey('A'.repeat(64)), false);
  });

  test('validateTxid accepts valid', () => {
    assert.strictEqual(validateTxid(TEST_TXID), true);
  });

  test('validateTxid rejects invalid', () => {
    assert.strictEqual(validateTxid('abc'), false);
  });
});

describe('Gitmark', () => {
  test('creates instance with privkey', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    assert.strictEqual(gm.network, 'tbtc4');
    assert.strictEqual(gm.txos.length, 0);
  });

  test('creates instance with custom network', () => {
    const gm = new Gitmark(TEST_PRIVKEY, 'mainnet');
    assert.strictEqual(gm.network, 'mainnet');
  });

  test('genesis creates first TXO', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    const result = gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);

    assert.strictEqual(gm.txos.length, 1);
    assert.strictEqual(gm.commits.length, 1);
    assert.strictEqual(result.txo.commit, TEST_COMMIT0);
    assert.ok(result.address.startsWith('tb1p'));
    assert.ok(result.uri.startsWith('txo:tbtc4:'));
  });

  test('genesis pubkey is deterministic', () => {
    const gm1 = new Gitmark(TEST_PRIVKEY);
    const gm2 = new Gitmark(TEST_PRIVKEY);

    gm1.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm2.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);

    assert.strictEqual(gm1.currentPubkey(), gm2.currentPubkey());
  });

  test('advance requires genesis first', () => {
    const gm = new Gitmark(TEST_PRIVKEY);

    assert.throws(() => {
      gm.advance(TEST_COMMIT, TEST_TXID, 0, 999000);
    }, /genesis/i);
  });

  test('advance adds commit and TXO', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);

    const result = gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    assert.strictEqual(gm.txos.length, 2);
    assert.strictEqual(gm.commits.length, 2);
    assert.strictEqual(result.txo.commit, TEST_COMMIT);
    assert.ok(result.uri.includes('commit='));
  });

  test('advance changes pubkey', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    const pubkey1 = gm.currentPubkey();

    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);
    const pubkey2 = gm.currentPubkey();

    assert.notStrictEqual(pubkey1, pubkey2);
  });

  test('multiple advances chain correctly', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);

    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);
    gm.advance(TEST_COMMIT2, 'b'.repeat(64), 0, 998000);

    assert.strictEqual(gm.txos.length, 3);
    assert.strictEqual(gm.commits.length, 3);
    assert.strictEqual(gm.commits[0], TEST_COMMIT0);
    assert.strictEqual(gm.commits[1], TEST_COMMIT);
    assert.strictEqual(gm.commits[2], TEST_COMMIT2);
  });

  test('txoUris returns correct format', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const uris = gm.txoUris();
    assert.strictEqual(uris.length, 2);
    assert.ok(uris[0].includes('commit=' + TEST_COMMIT0)); // the genesis TXO carries the first commit
    assert.ok(uris[1].includes('commit=' + TEST_COMMIT)); // after advance
  });

  test('address changes with network', () => {
    const gm1 = new Gitmark(TEST_PRIVKEY, 'tbtc4');
    const gm2 = new Gitmark(TEST_PRIVKEY, 'mainnet');

    gm1.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm2.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);

    assert.ok(gm1.address().startsWith('tb1p'));
    assert.ok(gm2.address().startsWith('bc1p'));
  });

  test('export and import roundtrip', () => {
    const gm1 = new Gitmark(TEST_PRIVKEY);
    gm1.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm1.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const exported = gm1.export();

    const gm2 = new Gitmark(TEST_PRIVKEY);
    gm2.import(exported);

    assert.strictEqual(gm2.currentPubkey(), gm1.currentPubkey());
    assert.strictEqual(gm2.commits.length, 2);
    assert.strictEqual(exported.pubkeyBase, BASE);
  });
});

describe('Gitmark.verify', () => {
  test('valid chain returns true', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);
    gm.advance(TEST_COMMIT2, 'b'.repeat(64), 0, 998000);

    const result = Gitmark.verify(gm.txoUris(), BASE);
    assert.strictEqual(result.valid, true);
  });

  test('detects tampered pubkey', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const uris = gm.txoUris();
    // Tamper with pubkey in second URI
    const parsed = parseTxoUri(uris[1]);
    parsed.pubkey = 'deadbeef'.repeat(8);
    uris[1] = formatTxoUri({ network: 'tbtc4', ...parsed });

    const result = Gitmark.verify(uris, BASE);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('mismatch'));
  });

  test('a TXO without a commit is refused (every TXO carries one, the genesis one too)', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    const uris = gm.txoUris();
    const parsed = parseTxoUri(uris[0]);
    parsed.commit = null;
    uris[0] = formatTxoUri({ network: 'tbtc4', ...parsed });
    const result = Gitmark.verify(uris, BASE);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('no valid commit'));
  });

  test('without the base key nothing is guessed: verify asks for it', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    const result = Gitmark.verify(gm.txoUris());
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('pubkeyBase'));
  });

  test('the live rule, pinned by the first three marks of an on-chain trail (1 Oct 2026): base, commits, outputs', () => {
    // the same numbers a verifier gets back from the chain for these marks' outputs
    const base = '0273c7f6cf0f135a63bc95a2e676bcf0a592c8b508fae8697e43f778c74e232b24';
    const commits = ['9adc596cfd1100333393a12f2f41b2d820f16d0b', '4490c4c39e145915c59c0964b6dcd8dc720c9d2e', '699ee3a3ea9332cc9ec435acf8fd8cd07eecf940'];
    const outputs = ['e403de73c97cb7ca2efddab823493a7b949085e40087ac97fe6884db12cc77df', '3ef39ed4fc2a739d8d67f59db78da7b06ac4224d9919b05f963889086e3f58f6', 'd7abfea9a395ab2218d4a68558186ade4be4f632125f8520485e62443b3e59cf'];
    const txids = ['51d87101b7cbb01cc5a68785bf3141ec6fd00894d71ab1168d4daa20420eeacf', '0ffaa7d29beebdf5207cd8ee7ea11eb74e38864c861ad7a33302b7dabbf37a08', '3d90109823521b006f45f15640410abe52a4dce79820567b9b7045aa035bf4f0'];
    // URIs as the live trail records them: no pubkey param, so verify returns the expected outputs
    const uris = txids.map((txid, i) => formatTxoUri({ network: 'tbtc4', txid, vout: 0, amount: 999700 - 300 * i, commit: commits[i] }));
    const r = Gitmark.verify(uris, base);
    assert.strictEqual(r.valid, true);
    assert.deepStrictEqual(r.expected, outputs);
    // with the pubkeys written in, they match too
    const withPk = txids.map((txid, i) => formatTxoUri({ network: 'tbtc4', txid, vout: 0, amount: 999700 - 300 * i, commit: commits[i], pubkey: outputs[i] }));
    assert.strictEqual(Gitmark.verify(withPk, base).valid, true);
    // the base as a bare x reads as the 02 point (this base is 02, so it agrees)
    assert.strictEqual(Gitmark.verify(withPk, base.slice(2)).valid, true);
  });

  test('every link is checked: two commits swapped give the same sum but other outputs, and are refused', () => {
    const base = '0273c7f6cf0f135a63bc95a2e676bcf0a592c8b508fae8697e43f778c74e232b24';
    const commits = ['9adc596cfd1100333393a12f2f41b2d820f16d0b', '699ee3a3ea9332cc9ec435acf8fd8cd07eecf940', '4490c4c39e145915c59c0964b6dcd8dc720c9d2e'];
    const outputs = ['e403de73c97cb7ca2efddab823493a7b949085e40087ac97fe6884db12cc77df', '3ef39ed4fc2a739d8d67f59db78da7b06ac4224d9919b05f963889086e3f58f6', 'd7abfea9a395ab2218d4a68558186ade4be4f632125f8520485e62443b3e59cf'];
    const uris = commits.map((c, i) => formatTxoUri({ network: 'tbtc4', txid: 'ab'.repeat(32), vout: 0, amount: 1000, commit: c, pubkey: outputs[i] }));
    const r = Gitmark.verify(uris, base);
    assert.strictEqual(r.valid, false);
    assert.ok(r.error.includes('mismatch at index 1'));
  });

  test('trail() is the blocktrails.json shape: the base as a full point, the states, the TXO URIs', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);
    const t = gm.trail();
    assert.strictEqual(t['@type'], 'Blocktrail');
    assert.strictEqual(t.profile, 'gitmark');
    assert.strictEqual(t.pubkeyBase, BASE);
    assert.deepStrictEqual(t.states, [TEST_COMMIT0, TEST_COMMIT]);
    assert.strictEqual(t.txo.length, 2);
    assert.strictEqual(Gitmark.verify(t.txo, t.pubkeyBase).valid, true);
  });

  test('rejects empty array', () => {
    const result = Gitmark.verify([]);
    assert.strictEqual(result.valid, false);
  });
});

describe('Gitmark.fromTxoUris', () => {
  test('loads state from URIs', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const loaded = Gitmark.fromTxoUris(gm.txoUris());

    assert.strictEqual(loaded.network, 'tbtc4');
    assert.strictEqual(loaded.commits.length, 2);
    assert.strictEqual(loaded.commits[0], TEST_COMMIT0);
    assert.strictEqual(loaded.commits[1], TEST_COMMIT);
  });
});

describe('addressAt', () => {
  test('returns correct address at each index', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    const addr0 = gm.address();

    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);
    const addr1 = gm.address();

    // addressAt(0) should return genesis address
    assert.strictEqual(gm.addressAt(0), addr0);
    // addressAt(1) should return current address
    assert.strictEqual(gm.addressAt(1), addr1);
  });

  test('throws for out of range', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);

    assert.throws(() => {
      gm.addressAt(5);
    }, /out of range/i);
  });
});

describe('spendingKey', () => {
  test('the genesis output is already tweaked: its spending key is not the base key', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);

    assert.strictEqual(gm.spendingKey().length, 64);
    assert.notStrictEqual(gm.spendingKey(), TEST_PRIVKEY);
  });

  test('returns derived key after advance', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000, TEST_COMMIT0);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const key = gm.spendingKey();
    assert.strictEqual(key.length, 64);
    assert.notStrictEqual(key, TEST_PRIVKEY);
  });
});
