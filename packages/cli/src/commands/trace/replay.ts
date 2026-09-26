// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { createClient } from '../../client';
import { handleCommandError } from '../../error-handler';
import { parseOutputFormat } from '../../parsers/output-format';
import { printOutput } from '../../printers/output';
import { printStdout } from '../../printers/stdout';

/**
 * `zarel trace replay <id>`.
 *
 * Replays a settled trace against the current deployed spec or the
 * client-supplied proposed spec. Default `--format table` renders the
 * side-by-side stage outcome list. Exit 0 on `deterministic_match: true`,
 * exit 1 on any divergence (CI-gate convention).
 */
export function registerTraceReplayCommand(traceCmd: Command): void {
    traceCmd
        .command('replay <trace_id>')
        .description('Replay a settled trace against the current deployed spec')
        .option('--against-current-spec', 'Replay against the current spec rather than the historical one', false)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (traceId: string, opts: { againstCurrentSpec: boolean; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const result = await client.runtime.traces.replay(traceId, {
                    against_current_spec: opts.againstCurrentSpec,
                });

                if (format === 'json') {
                    printOutput(result, 'json');
                } else {
                    printStdout(`Replay — trace ${result.trace_id}`);
                    printStdout(`Spec: ${result.proposed_spec_version} (hash ${result.proposed_spec_hash.slice(0, 12)}...)`);
                    printStdout(`Deterministic match: ${result.deterministic_match ? 'YES' : 'NO'}`);
                    printStdout('');
                    printStdout('Stage           | Original             | Replayed             | Match');
                    printStdout('---------------+----------------------+----------------------+------');
                    for (const s of result.stages) {
                        printStdout(
                            `${s.stage.padEnd(15)} | ${s.original.verdict.padEnd(20)} | ${s.replayed.verdict.padEnd(20)} | ${s.match ? '✓' : '✗'}`,
                        );
                    }
                    if (result.stages_diverged.length > 0) {
                        printStdout('');
                        printStdout(`Stages diverged: ${result.stages_diverged.join(', ')}`);
                    }
                }

                if (!result.deterministic_match) {
                    process.exitCode = 1;
                }
            } catch (err) {
                handleCommandError(err);
            }
        });
}
