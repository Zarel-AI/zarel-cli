// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import * as fs from 'node:fs';
import { Command } from 'commander';
import { createClient } from '../../client';
import { handleCommandError } from '../../error-handler';
import { printStdout } from '../../printers/stdout';

/**
 * `zarel trace bundle <id>`.
 *
 * Downloads a signed evidence bundle as `.tar.gz`. Streams to disk via
 * `--output <path>` (default `<trace_id>.tar.gz` in the current directory).
 */
export function registerTraceBundleCommand(traceCmd: Command): void {
    traceCmd
        .command('bundle <trace_id>')
        .description('Download a signed evidence bundle for a settled trace')
        .option('-o, --output <path>', 'Output file path; defaults to <trace_id>.tar.gz')
        .action(async (traceId: string, opts: { output?: string }) => {
            try {
                const client = createClient();
                const bytes = await client.runtime.traces.bundle(traceId);
                const outPath = opts.output ?? `${traceId}.tar.gz`;
                fs.writeFileSync(outPath, Buffer.from(bytes));
                printStdout(`Wrote evidence bundle to ${outPath} (${bytes.byteLength} bytes)`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
