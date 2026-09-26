// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Types ───────────────────────────────────────────────────────────────

export interface ZarelConfig {
    /** Runtime-plane JWT (`token_class: tenant`). Used by `client.runtime.*`. */
    runtimeToken?: string;
    /** Contract-plane JWT (`token_class: contract`). Used by `client.contract.*`. */
    contractToken?: string;
    tenant?: string;
    baseUrl?: string;
    // Contract-plane API base URL. Auto-derived
    // from `baseUrl` (inserting `.admin.` before the parent zone) when
    // omitted; an explicit value pins the contract plane to a different
    // host than the runtime plane.
    contractBaseUrl?: string;
    // Persisted locale preference (lowest priority in the resolution
    // chain: per-command --locale flag → ZAREL_LOCALE → this).
    locale?: string;
}

// ── Paths ───────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.zarel');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
    return CONFIG_DIR;
}

export function getConfigPath(): string {
    return CONFIG_FILE;
}

// ── Read ────────────────────────────────────────────────────────────────

export function loadConfig(): ZarelConfig {
    try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        warnIfReadableByOthers();
        return JSON.parse(raw) as ZarelConfig;
    } catch {
        return {};
    }
}

/**
 * The repair in `saveConfig` reaches an install that WRITES AGAIN. The common shape is the
 * opposite: a token was set once under a version that had no mode, every command since has only
 * READ, and that file stays 0644 with both plane JWTs in plaintext for the life of the account —
 * upgrading changes nothing and says nothing.
 *
 * So the read path says something. It does not repair: a read that mutates the user's files is a
 * surprise, and the one-line fix belongs to the person who can also decide the file was fine.
 * Warned once per process, on stderr, so it never contaminates `--format json` on stdout.
 */
let warnedAboutMode = false;
function warnIfReadableByOthers(): void {
    if (warnedAboutMode) return;
    try {
        if ((fs.statSync(CONFIG_FILE).mode & 0o077) === 0) return;
        warnedAboutMode = true;
        process.stderr.write(
            `warning: ${CONFIG_FILE} is readable by other users on this machine and holds your `
            + `plane tokens in plaintext. Fix it with: chmod 600 ${CONFIG_FILE}\n`,
        );
    } catch { /* the file is gone or the filesystem has no modes — nothing to say */ }
}

// ── Write ───────────────────────────────────────────────────────────────

export function saveConfig(config: ZarelConfig): void {
    // OWNER-ONLY, because this file holds `runtimeToken` and `contractToken` — the runtime-plane
    // and contract-plane JWTs, in plaintext, which is what `zarel config set token …` puts there.
    // Without a mode the default umask yields 0755/0644, so on any shared host — a CI runner, a
    // jump box, a container image built with the CLI configured — another local user reads both
    // planes' credentials with `cat`. `gh`, `aws` and `npm` all take 0700/0600 for the same reason.
    //
    // WRITE-THEN-RENAME, not write-then-chmod. `mode` applies only at CREATION, and `writeFileSync`
    // on an EXISTING path truncates and writes with that file's current mode — so for the case this
    // repair exists for, a config left at 0644 by an earlier version, the sequence would be
    // truncate → write both plane tokens at 0644 → narrow. Another local user polling the file, or
    // a crash between the two calls, gets or leaves plaintext JWTs world-readable. Writing a fresh
    // 0600 temp file and renaming over the old one closes that window and makes the update atomic:
    // a reader sees either the whole previous config or the whole new one, never a truncated file.
    //
    // The directory is repaired too. `mkdirSync` with `recursive` is a no-op on an existing path
    // and never touches its mode, so `~/.zarel` created 0755 by an earlier version would stay
    // world-traversable for the life of the account while the file inside it was narrowed.
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    // A REPAIR MUST NOT BREAK THE WRITE IT IS HARDENING. `chmod` needs ownership, where the
    // `mkdirSync` above is a silent no-op on any existing writable directory — so an unconditional
    // one turns `zarel config set` into EPERM wherever `~/.zarel` is not ours: a container whose
    // build stage created it as root and whose runtime runs as another uid, a group-shared HOME, a
    // DrvFs/CIFS mount that rejects chmod outright. Narrow it when we can; never fail because we
    // could not.
    try {
        if ((fs.statSync(CONFIG_DIR).mode & 0o077) !== 0) fs.chmodSync(CONFIG_DIR, 0o700);
    } catch { /* not ours, or the filesystem has no modes — the file below is still 0600 */ }

    // A SYMLINK IS A DELIBERATE CHOICE. `writeFileSync` followed it; `renameSync` would replace it
    // with a regular file and the target — a dotfiles repo, a mounted secrets volume — would
    // silently stop receiving updates while its stale token kept being read. Resolve it and write
    // through, keeping the atomic rename on the real path.
    let target = CONFIG_FILE;
    try {
        if (fs.lstatSync(CONFIG_FILE).isSymbolicLink()) target = fs.realpathSync(CONFIG_FILE);
    } catch { /* no config yet, or a dangling link — write the path we were given */ }

    const scratch = `${target}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(scratch, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
        fs.chmodSync(scratch, 0o600);
        fs.renameSync(scratch, target);
    } finally {
        // A crash between write and rename would otherwise leave plaintext JWTs in a stray
        // `.tmp` — at 0600 inside a 0700 directory, so not an exposure, but not litter to keep.
        if (fs.existsSync(scratch)) fs.rmSync(scratch, { force: true });
    }
}

// ── Get / Set / Delete / List ───────────────────────────────────────────

const VALID_KEYS: ReadonlySet<string> = new Set(['runtimeToken', 'contractToken', 'tenant', 'baseUrl', 'contractBaseUrl', 'locale']);

export function isValidConfigKey(key: string): key is keyof ZarelConfig {
    return VALID_KEYS.has(key);
}

export function getConfigValue(key: keyof ZarelConfig): string | undefined {
    const config = loadConfig();
    return config[key];
}

export function setConfigValue(key: keyof ZarelConfig, value: string): void {
    const config = loadConfig();
    config[key] = value;
    saveConfig(config);
}

export function deleteConfigValue(key: keyof ZarelConfig): void {
    const config = loadConfig();
    delete config[key];
    saveConfig(config);
}

export function listConfig(): ZarelConfig {
    return loadConfig();
}
