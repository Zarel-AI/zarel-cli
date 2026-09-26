// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { handleCommandError } from '../../error-handler';
import { printStdout } from '../../printers/stdout';

/**
 * `zarel trust-keys fetch <deployment-host>`.
 *
 * Downloads the deployment's `.well-known/zarel-trust-keys.json`, validates
 * its schema (best-effort here; the standalone `zarel verify` command runs
 * the full validator), and writes it to
 * `~/.zarel/trust-keys/<deployment>.json`.
 *
 * `<deployment-host>` is the public-facing host (e.g., `acme-prod.zarel.io`).
 * The fetch is plain HTTPS; no auth required (the file is public).
 */
export function registerTrustKeysFetchCommand(trustKeysCmd: Command): void {
    trustKeysCmd
        .command('fetch <deployment>')
        .description('Download a deployment\'s public trust-keys manifest')
        .option('-o, --output <path>', 'Override the default output path (~/.zarel/trust-keys/<deployment>.json)')
        .action(async (deployment: string, opts: { output?: string }) => {
            try {
                const url = `https://${deployment}/.well-known/zarel-trust-keys.json`;
                const res = await fetch(url);
                if (!res.ok) {
                    throw new Error(`Failed to fetch ${url} — HTTP ${res.status}`);
                }
                const text = await res.text();
                // `unknown`, not `any`: `JSON.parse` hands back a value nobody has checked, and
                // the shape test below is what makes it a manifest.
                const parsed: unknown = JSON.parse(text);
                const manifest = parsed as { schema_version?: unknown; keys?: unknown } | null;
                if (!manifest?.schema_version || !Array.isArray(manifest.keys)) {
                    throw new Error(`Manifest at ${url} did not match the trust-keys schema (schema_version + keys[] required).`);
                }
                const outPath = opts.output ?? defaultOutputPath(deployment);
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, text);
                printStdout(`Wrote trust-keys manifest to ${outPath} (${manifest.keys.length} keys)`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}

function defaultOutputPath(deployment: string): string {
    return path.join(os.homedir(), '.zarel', 'trust-keys', `${deployment}.json`);
}
