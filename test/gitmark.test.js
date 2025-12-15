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
  encodeBech32m
} from '../index.js';

// Test data
const TEST_PRIVKEY = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
const TEST_TXID = '34cea31b10e809e7cef4e19ce6e681da22ba1d2ae723af110cbba191e854be0e';
const TEST_COMMIT = 'cf97baba489e88c1ffbe6758c0fe8c18ff83d17d';
const TEST_COMMIT2 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

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
    const result = gm.genesis(TEST_TXID, 0, 1000000);

    assert.strictEqual(gm.txos.length, 1);
    assert.strictEqual(gm.commits.length, 0);
    assert.strictEqual(result.txo.commit, null);
    assert.ok(result.address.startsWith('tb1p'));
    assert.ok(result.uri.startsWith('txo:tbtc4:'));
  });

  test('genesis pubkey is deterministic', () => {
    const gm1 = new Gitmark(TEST_PRIVKEY);
    const gm2 = new Gitmark(TEST_PRIVKEY);

    gm1.genesis(TEST_TXID, 0, 1000000);
    gm2.genesis(TEST_TXID, 0, 1000000);

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
    gm.genesis(TEST_TXID, 0, 1000000);

    const result = gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    assert.strictEqual(gm.txos.length, 2);
    assert.strictEqual(gm.commits.length, 1);
    assert.strictEqual(result.txo.commit, TEST_COMMIT);
    assert.ok(result.uri.includes('commit='));
  });

  test('advance changes pubkey', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);
    const pubkey1 = gm.currentPubkey();

    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);
    const pubkey2 = gm.currentPubkey();

    assert.notStrictEqual(pubkey1, pubkey2);
  });

  test('multiple advances chain correctly', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);

    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);
    gm.advance(TEST_COMMIT2, 'b'.repeat(64), 0, 998000);

    assert.strictEqual(gm.txos.length, 3);
    assert.strictEqual(gm.commits.length, 2);
    assert.strictEqual(gm.commits[0], TEST_COMMIT);
    assert.strictEqual(gm.commits[1], TEST_COMMIT2);
  });

  test('txoUris returns correct format', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const uris = gm.txoUris();
    assert.strictEqual(uris.length, 2);
    assert.ok(!uris[0].includes('commit=')); // genesis
    assert.ok(uris[1].includes('commit=')); // after advance
  });

  test('address changes with network', () => {
    const gm1 = new Gitmark(TEST_PRIVKEY, 'tbtc4');
    const gm2 = new Gitmark(TEST_PRIVKEY, 'mainnet');

    gm1.genesis(TEST_TXID, 0, 1000000);
    gm2.genesis(TEST_TXID, 0, 1000000);

    assert.ok(gm1.address().startsWith('tb1p'));
    assert.ok(gm2.address().startsWith('bc1p'));
  });

  test('export and import roundtrip', () => {
    const gm1 = new Gitmark(TEST_PRIVKEY);
    gm1.genesis(TEST_TXID, 0, 1000000);
    gm1.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const exported = gm1.export();

    const gm2 = new Gitmark(TEST_PRIVKEY);
    gm2.import(exported);

    assert.strictEqual(gm2.currentPubkey(), gm1.currentPubkey());
    assert.strictEqual(gm2.commits.length, 1);
  });
});

describe('Gitmark.verify', () => {
  test('valid chain returns true', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);
    gm.advance(TEST_COMMIT2, 'b'.repeat(64), 0, 998000);

    const result = Gitmark.verify(gm.txoUris());
    assert.strictEqual(result.valid, true);
  });

  test('detects tampered pubkey', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const uris = gm.txoUris();
    // Tamper with pubkey in second URI
    const parsed = parseTxoUri(uris[1]);
    parsed.pubkey = 'deadbeef'.repeat(8);
    uris[1] = formatTxoUri({ network: 'tbtc4', ...parsed });

    const result = Gitmark.verify(uris);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('mismatch'));
  });

  test('detects genesis with commit', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);

    const uris = gm.txoUris();
    // Add commit to genesis (invalid)
    const parsed = parseTxoUri(uris[0]);
    parsed.commit = TEST_COMMIT;
    uris[0] = formatTxoUri({ network: 'tbtc4', ...parsed });

    const result = Gitmark.verify(uris);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('Genesis'));
  });

  test('rejects empty array', () => {
    const result = Gitmark.verify([]);
    assert.strictEqual(result.valid, false);
  });
});

describe('Gitmark.fromTxoUris', () => {
  test('loads state from URIs', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const loaded = Gitmark.fromTxoUris(gm.txoUris());

    assert.strictEqual(loaded.network, 'tbtc4');
    assert.strictEqual(loaded.commits.length, 1);
    assert.strictEqual(loaded.commits[0], TEST_COMMIT);
  });
});

describe('addressAt', () => {
  test('returns correct address at each index', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);
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
    gm.genesis(TEST_TXID, 0, 1000000);

    assert.throws(() => {
      gm.addressAt(5);
    }, /out of range/i);
  });
});

describe('spendingKey', () => {
  test('returns base key for genesis', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);

    assert.strictEqual(gm.spendingKey(), TEST_PRIVKEY);
  });

  test('returns derived key after advance', () => {
    const gm = new Gitmark(TEST_PRIVKEY);
    gm.genesis(TEST_TXID, 0, 1000000);
    gm.advance(TEST_COMMIT, 'a'.repeat(64), 0, 999000);

    const key = gm.spendingKey();
    assert.strictEqual(key.length, 64);
    assert.notStrictEqual(key, TEST_PRIVKEY);
  });
});
