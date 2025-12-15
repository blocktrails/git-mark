#!/usr/bin/env node

/**
 * git-mark CLI - Git commits anchored to Bitcoin
 *
 * Usage:
 *   git mark init                              Initialize .well-known/txo/
 *   git mark genesis --txid <txid> --vout <n> --amount <sats>
 *   git mark advance --txid <txid> --vout <n> --amount <sats> [--commit <hash>]
 *   git mark show                              Display current state
 *   git mark verify                            Verify TXO chain
 *   git mark address                           Show current address
 *   git mark export                            Output txo.json
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Gitmark, parseTxoUri, formatTxoUri } from '../index.js';

const TXO_DIR = '.well-known/txo';
const TXO_FILE = join(TXO_DIR, 'txo.json');
const STATE_FILE = '.gitmark.json';

// Parse CLI arguments
function parseArgs(args) {
  const result = { command: null, options: {} };

  let i = 0;
  if (args.length > 0 && !args[0].startsWith('--')) {
    result.command = args[0];
    i = 1;
  }

  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result.options[key] = next;
        i += 2;
      } else {
        result.options[key] = true;
        i += 1;
      }
    } else {
      i += 1;
    }
  }

  return result;
}

// Get private key from options or git config
function getPrivateKey(options) {
  if (options.key) {
    return options.key;
  }

  try {
    const key = execSync('git config nostr.privkey', { encoding: 'utf8' }).trim();
    if (key && /^[0-9a-f]{64}$/i.test(key)) {
      return key.toLowerCase();
    }
  } catch {
    // Not configured
  }

  return null;
}

// Get current git HEAD commit
function getHeadCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim().toLowerCase();
  } catch {
    return null;
  }
}

// Check if in git repo
function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Load state from file
function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  }
  return null;
}

// Save state to file
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

// Load TXO URIs from .well-known/txo/txo.json
function loadTxoJson() {
  if (existsSync(TXO_FILE)) {
    return JSON.parse(readFileSync(TXO_FILE, 'utf8'));
  }
  return [];
}

// Save TXO URIs to .well-known/txo/txo.json
function saveTxoJson(uris) {
  if (!existsSync(TXO_DIR)) {
    mkdirSync(TXO_DIR, { recursive: true });
  }
  writeFileSync(TXO_FILE, JSON.stringify(uris, null, 2) + '\n');
}

// Commands
const commands = {
  init() {
    if (!isGitRepo()) {
      console.error('Error: not a git repository');
      process.exit(1);
    }

    if (!existsSync(TXO_DIR)) {
      mkdirSync(TXO_DIR, { recursive: true });
      console.log(`Created ${TXO_DIR}/`);
    }

    if (!existsSync(TXO_FILE)) {
      saveTxoJson([]);
      console.log(`Created ${TXO_FILE}`);
    }

    console.log('Initialized git-mark');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Set your private key:');
    console.log('     git config nostr.privkey <64-char-hex>');
    console.log('');
    console.log('  2. Create genesis with your first UTXO:');
    console.log('     git mark genesis --txid <txid> --vout 0 --amount <sats>');
  },

  genesis(options) {
    const { txid, vout, amount, network = 'tbtc4' } = options;

    if (!txid || vout === undefined || !amount) {
      console.error('Usage: git mark genesis --txid <txid> --vout <n> --amount <sats>');
      process.exit(1);
    }

    const privkey = getPrivateKey(options);
    if (!privkey) {
      console.error('Error: no private key found');
      console.error('Set with: git config nostr.privkey <64-char-hex>');
      process.exit(1);
    }

    const gm = new Gitmark(privkey, network);
    const result = gm.genesis(txid, parseInt(vout), parseInt(amount));

    // Save state
    saveState(gm.export());
    saveTxoJson(gm.txoUris());

    console.log('Genesis created');
    console.log('');
    console.log('Address:', result.address);
    console.log('Pubkey:', result.txo.pubkey);
    console.log('');
    console.log('TXO URI:');
    console.log(result.uri);
    console.log('');
    console.log(`Saved to ${TXO_FILE}`);
  },

  advance(options) {
    const { txid, vout, amount, commit } = options;

    if (!txid || vout === undefined || !amount) {
      console.error('Usage: git mark advance --txid <txid> --vout <n> --amount <sats> [--commit <hash>]');
      process.exit(1);
    }

    const privkey = getPrivateKey(options);
    if (!privkey) {
      console.error('Error: no private key found');
      process.exit(1);
    }

    const state = loadState();
    if (!state) {
      console.error('Error: no existing state. Run genesis first.');
      process.exit(1);
    }

    // Use provided commit or HEAD
    const commitHash = commit || getHeadCommit();
    if (!commitHash) {
      console.error('Error: no commit hash provided and not in git repo');
      process.exit(1);
    }

    const gm = new Gitmark(privkey, state.network);
    gm.import(state);

    const result = gm.advance(commitHash, txid, parseInt(vout), parseInt(amount));

    // Save state
    saveState(gm.export());
    saveTxoJson(gm.txoUris());

    console.log('State advanced');
    console.log('');
    console.log('Commit:', commitHash);
    console.log('New address:', result.address);
    console.log('New pubkey:', result.txo.pubkey);
    console.log('');
    console.log('TXO URI:');
    console.log(result.uri);
  },

  show() {
    const state = loadState();
    if (!state) {
      console.error('No gitmark state found. Run init and genesis first.');
      process.exit(1);
    }

    console.log('Network:', state.network);
    console.log('Commits:', state.commits.length);
    console.log('');

    console.log('TXO Chain:');
    for (let i = 0; i < state.uris.length; i++) {
      const uri = state.uris[i];
      const txo = state.txos[i];
      console.log(`  [${i}] ${txo.commit || '(genesis)'}`);
      console.log(`      ${uri}`);
    }

    console.log('');
    console.log('Current pubkey:', state.txos[state.txos.length - 1]?.pubkey);
  },

  verify(options) {
    const uris = loadTxoJson();
    if (uris.length === 0) {
      console.error('No TXO URIs found in', TXO_FILE);
      process.exit(1);
    }

    if (options.full) {
      // Full verification: EC_ADD + git ancestry
      const result = Gitmark.verifyFull(uris);
      if (result.valid) {
        console.log('Valid');
        console.log('  EC_ADD chain: valid');
        console.log('  Git ancestry: valid');
        console.log('Chain length:', uris.length);
      } else {
        console.log('Invalid:', result.error);
        if (result.ecValid === false) {
          console.log('  EC_ADD chain: invalid');
        } else if (result.gitValid === false) {
          console.log('  EC_ADD chain: valid');
          console.log('  Git ancestry: invalid');
        }
        process.exit(1);
      }
    } else {
      // EC_ADD verification only
      const result = Gitmark.verify(uris);
      if (result.valid) {
        console.log('Valid');
        console.log('Chain length:', uris.length);
      } else {
        console.log('Invalid:', result.error);
        process.exit(1);
      }
    }
  },

  address(options) {
    const state = loadState();

    if (state) {
      // Show current address from state
      const privkey = getPrivateKey(options);
      if (privkey) {
        const gm = new Gitmark(privkey, state.network);
        gm.import(state);
        console.log(gm.address());
      } else {
        // No privkey, show from stored pubkey
        console.log('Current pubkey:', state.txos[state.txos.length - 1]?.pubkey);
      }
    } else {
      // Show genesis address from privkey
      const privkey = getPrivateKey(options);
      if (!privkey) {
        console.error('No state or private key found');
        process.exit(1);
      }

      const network = options.network || 'tbtc4';
      const gm = new Gitmark(privkey, network);
      console.log('Genesis address:', gm.address());
    }
  },

  export() {
    const uris = loadTxoJson();
    console.log(JSON.stringify(uris, null, 2));
  },

  help() {
    console.log(`git-mark - Git commits anchored to Bitcoin

Usage: git mark <command> [options]

Commands:
  init      Initialize .well-known/txo/ directory
  genesis   Create genesis with first UTXO
  advance   Advance state with a git commit
  show      Display current state and TXO chain
  verify    Verify TXO chain integrity (--full for git ancestry check)
  address   Show current Taproot address
  export    Output txo.json to stdout

Options:
  --key <hex>       Private key (64 hex chars)
  --network <net>   Network (tbtc4, mainnet, signet, regtest)
  --txid <hex>      Transaction ID
  --vout <n>        Output index
  --amount <sats>   Amount in satoshis
  --commit <hash>   Git commit hash (default: HEAD)
  --full            Full verification including git ancestry

Examples:
  git mark init
  git config nostr.privkey <your-64-char-hex-key>
  git mark genesis --txid abc123... --vout 0 --amount 1000000
  git commit -m "initial state"
  git mark advance --txid def456... --vout 0 --amount 999000

More info: https://blocktrails.org/spec/profiles.html`);
  }
};

// Main
const args = process.argv.slice(2);
const { command, options } = parseArgs(args);

if (!command || command === 'help' || options.help) {
  commands.help();
} else if (commands[command]) {
  commands[command](options);
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run "git mark help" for usage');
  process.exit(1);
}
