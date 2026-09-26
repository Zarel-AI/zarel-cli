// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { createClient } from '../../client';
import { handleCommandError } from '../../error-handler';
import { parseOutputFormat } from '../../parsers/output-format';
import { printOutput } from '../../printers/output';

/**
 * `zarel trace get <trace_id>` — fetch the chronology of a single agent
 * dispatch. Faithful-layer wrapper around `client.runtime.traces.get(traceId)`.
 *
 * Default `--format table` renders a header block + ordered event list.
 */
export function registerTraceGetCommand(traceCmd: Command): void {
    traceCmd
        .command('get <trace_id>')
        .description('Fetch the full chronology of a trace by id')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (traceId: string, opts: { format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const trace = await client.runtime.traces.get(traceId);
                printOutput(trace, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
