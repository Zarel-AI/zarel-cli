// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerRuntimeCommands } from './commands/runtime';
import { registerContractCommands } from './commands/contract';
import { registerConfigCommands } from './commands/config';
// Trust-keys + offline verify
import { registerTrustKeysCommands } from './commands/trust-keys';
import { registerVerifyCommand } from './commands/verify';
// Audit tamper-evidence bundle download
import { registerAuditCommands } from './commands/audit';
// The caller's own governance receipts (self-scoped)
import { registerReceiptsCommands } from './commands/receipts';

const program = new Command();

/**
 * READ FROM THE MANIFEST, not restated. It said `0.1.0` while the package shipped 0.2.1 — and this
 * is the first release under a new package name, where "did the rename actually install?" is
 * exactly the question `--version` is asked.
 *
 * `__dirname` because this package is CommonJS; from `dist/` the manifest is one level up, and npm
 * puts `package.json` in every tarball regardless of `files`, so it is there at runtime.
 */
const VERSION: string = (JSON.parse(
    readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
) as { version: string }).version;

program
    .name('zarel')
    .description('CLI for the Zarel (Zarel) API')
    .version(VERSION)
    .option('--debug', 'Log HTTP requests/responses to stderr (equivalent to ZAREL_DEBUG=1)');

// The global --debug flag is sugar for the ZAREL_DEBUG env the SDK client reads;
// set it before any command action constructs the client.
program.hook('preAction', () => {
    if (program.opts().debug === true) process.env.ZAREL_DEBUG = '1';
});

// Plane-namespaced groups
registerRuntimeCommands(program);
registerContractCommands(program);

// CLI-local commands
registerConfigCommands(program);
registerTrustKeysCommands(program);
registerVerifyCommand(program);
registerAuditCommands(program);
registerReceiptsCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
