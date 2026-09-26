// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * `~/.zarel/config.json` holds `runtimeToken` and `contractToken` — the runtime-plane and
 * contract-plane JWTs, in plaintext. It must be readable by its owner and nobody else.
 *
 * WHY A TEST AND NOT JUST THE MODE. A permission is invisible: the CLI works identically at 0644
 * and at 0600, every existing test passes either way, and the difference only shows on a host where
 * somebody else is looking. `saveConfig` shipped without a mode until 2026-08-23, so the default
 * umask produced 0755/0644 and any other local user on a CI runner, a jump box or a shared VM read
 * both planes' credentials with `cat`. A fix nothing asserts is a fix that comes back.
 *
 * Its own directory is separate from `config.test.ts`, which MOCKS `saveConfig` and therefore
 * cannot see what the real one writes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The real module reads `os.homedir()` at LOAD time, so the spy must precede the import. */
function loadConfigModuleWithHome(home: string): typeof import('../src/config') {
    jest.resetModules();
    jest.spyOn(os, 'homedir').mockReturnValue(home);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../src/config') as typeof import('../src/config');
}

const modeOf = (p: string): string => (fs.statSync(p).mode & 0o777).toString(8);

describe('the credential store is owner-only', () => {
    let home: string;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'zarel-cli-perms-'));
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('creates the directory 0700 and the file 0600', () => {
        const { saveConfig, getConfigDir, getConfigPath } = loadConfigModuleWithHome(home);
        saveConfig({ runtimeToken: 'eyJhbGciOiJIUzI1NiJ9.stand-in', contractToken: 'eyJhbGciOiJIUzI1NiJ9.other' });
        expect(modeOf(getConfigDir())).toBe('700');
        expect(modeOf(getConfigPath())).toBe('600');
    });

    it('REPAIRS a file AND a directory an earlier version left world-readable', () => {
        // `mode` on writeFileSync/mkdirSync applies at CREATION only, and `mkdirSync` with
        // `recursive` is a no-op on an existing path that never touches its mode — so without the
        // explicit chmods, a `~/.zarel` created 0755 and a config written 0644 by the shipped 0.2.0
        // would keep those modes for the life of the account.
        //
        // This covers every install that runs `zarel config set` AGAIN, which is narrower than it
        // first reads: an install that set a token once and has only read since never reaches here.
        // That one is reached by the warning on the READ path — see the case below.
        const { saveConfig, getConfigPath, getConfigDir } = loadConfigModuleWithHome(home);
        fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o755 });
        fs.writeFileSync(getConfigPath(), '{}\n', { encoding: 'utf-8', mode: 0o644 });
        expect([modeOf(getConfigDir()), modeOf(getConfigPath())]).toEqual(['755', '644']);

        saveConfig({ tenant: 'acme' });
        expect([modeOf(getConfigDir()), modeOf(getConfigPath())]).toEqual(['700', '600']);
    });

    it('never widens the window: the tokens are written to a fresh 0600 file and renamed over', () => {
        // `writeFileSync` on an EXISTING path truncates and writes with that file's CURRENT mode,
        // so write-then-chmod would put both plane JWTs on disk at 0644 before narrowing them. The
        // observable consequence of doing it the other way round is that the file the tokens land
        // in is NEW — a different inode — so the old 0644 one is never the file that held them.
        const { saveConfig, getConfigPath, getConfigDir } = loadConfigModuleWithHome(home);
        fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
        fs.writeFileSync(getConfigPath(), '{}\n', { encoding: 'utf-8', mode: 0o644 });
        const before = fs.statSync(getConfigPath()).ino;

        saveConfig({ runtimeToken: 'eyJhbGciOiJIUzI1NiJ9.stand-in' });

        expect(fs.statSync(getConfigPath()).ino).not.toBe(before);
        expect(modeOf(getConfigPath())).toBe('600');
        // and no scratch file is left behind
        expect(fs.readdirSync(getConfigDir())).toEqual(['config.json']);
    });

    it('writes THROUGH a symlink instead of replacing it', () => {
        // `writeFileSync` followed a symlink; a bare `renameSync` would replace it with a regular
        // file, and a dotfiles repo or a mounted secrets volume would silently stop receiving
        // updates while its stale token kept being read.
        const { saveConfig, getConfigDir, getConfigPath } = loadConfigModuleWithHome(home);
        const real = path.join(home, 'dotfiles-config.json');
        fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
        fs.writeFileSync(real, '{}\n', { encoding: 'utf-8', mode: 0o600 });
        fs.symlinkSync(real, getConfigPath());

        saveConfig({ tenant: 'acme' });

        expect(fs.lstatSync(getConfigPath()).isSymbolicLink()).toBe(true);
        expect(JSON.parse(fs.readFileSync(real, 'utf-8'))).toEqual({ tenant: 'acme' });
        expect(modeOf(real)).toBe('600');
    });

    it('a directory it does not own does not stop the write', () => {
        // `chmod` needs ownership where `mkdirSync` is a silent no-op, so an unconditional repair
        // turns every config-writing command into EPERM on a HOME the process cannot chmod. The
        // hardening must not break the write it is hardening.
        const { saveConfig, loadConfig, getConfigDir } = loadConfigModuleWithHome(home);
        fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
        // The real one has to be captured BEFORE the spy: `jest.requireActual('node:fs')` returns
        // the same module object the spy is installed on, so calling through it recurses forever.
        const realChmod = fs.chmodSync;
        const chmod = jest.spyOn(fs, 'chmodSync').mockImplementation((p, mode) => {
            if (String(p) === getConfigDir()) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
            return realChmod(p, mode);
        });

        expect(() => saveConfig({ tenant: 'acme' })).not.toThrow();
        expect(loadConfig()).toEqual({ tenant: 'acme' });
        chmod.mockRestore();
    });

    it('the READ path tells a user whose config it will never rewrite', () => {
        // The repair only reaches a write. Someone who ran `zarel config set` once under a version
        // with no mode, and has only read since, keeps 0644 forever and is told nothing — so the
        // read says it. On stderr, so `--format json` on stdout stays parseable.
        const { loadConfig, getConfigDir, getConfigPath } = loadConfigModuleWithHome(home);
        fs.mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
        fs.writeFileSync(getConfigPath(), '{"tenant":"acme"}\n', { encoding: 'utf-8', mode: 0o644 });
        const written: string[] = [];
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            written.push(String(chunk));
            return true;
        });

        expect(loadConfig()).toEqual({ tenant: 'acme' });
        expect(written.join('')).toMatch(/readable by other users/);
        // and it does not repair — that is the user's call, and a read must not mutate their files
        expect(modeOf(getConfigPath())).toBe('644');

        // once per process, not once per command
        written.length = 0;
        loadConfig();
        expect(written).toEqual([]);
        stderr.mockRestore();
    });

    it('says nothing when the config is already owner-only', () => {
        const { loadConfig, saveConfig } = loadConfigModuleWithHome(home);
        saveConfig({ tenant: 'acme' });
        const written: string[] = [];
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            written.push(String(chunk));
            return true;
        });
        expect(loadConfig()).toEqual({ tenant: 'acme' });
        expect(written).toEqual([]);
        stderr.mockRestore();
    });

    it('still round-trips what it stored — the mode is not the only thing asserted', () => {
        const { saveConfig, loadConfig } = loadConfigModuleWithHome(home);
        saveConfig({ tenant: 'acme', locale: 'es' });
        expect(loadConfig()).toEqual({ tenant: 'acme', locale: 'es' });
    });
});
