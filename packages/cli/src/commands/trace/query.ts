// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import type { TraceListParams, TraceOutcome, TraceSummary } from '@zarel-ai/sdk';
import { createClient } from '../../client';
import { handleCommandError } from '../../error-handler';
import { parseIntegerOption } from '../../parsers/numeric-options';
import { parseOutputFormat } from '../../parsers/output-format';
import { printOutput } from '../../printers/output';

const TRACE_OUTCOMES: ReadonlyArray<TraceOutcome> = ['executed', 'refused', 'awaiting_human_decision', 'failed'];

function parseOutcome(value: string): TraceOutcome {
    if (!(TRACE_OUTCOMES as ReadonlyArray<string>).includes(value)) {
        throw new Error(`Unknown --outcome value: ${value}. Expected one of: ${TRACE_OUTCOMES.join(', ')}.`);
    }
    return value as TraceOutcome;
}

/**
 * `zarel trace query` — list traces matching filters with cursor pagination.
 * Faithful-layer wrapper around `client.runtime.traces.list({...})`.
 */
export function registerTraceQueryCommand(traceCmd: Command): void {
    traceCmd
        .command('query')
        .description('Query traces by flow / user / window / outcome')
        .option('--flow <name>', 'Filter by originating flow name')
        .option('--user <name>', 'Filter by originating user name')
        .option('--from <iso8601>', 'Lower bound (inclusive) on started_at')
        .option('--to <iso8601>', 'Upper bound (inclusive) on completed_at')
        .option('--outcome <outcome>', 'Filter by outcome (executed | refused | awaiting_human_decision | failed)')
        .option('--limit <n>', 'Max results per page (1–500, default 50)')
        .option('--cursor <opaque>', 'Continuation cursor from a previous page')
        .option('--all', 'Fetch every page (auto-paginate across cursors); --limit becomes the page size')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: {
            flow?: string;
            user?: string;
            from?: string;
            to?: string;
            outcome?: string;
            limit?: string;
            cursor?: string;
            all?: boolean;
            format: string;
        }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const params: TraceListParams = {
                    ...(opts.flow !== undefined ? { flow: opts.flow } : {}),
                    ...(opts.user !== undefined ? { user: opts.user } : {}),
                    ...(opts.from !== undefined ? { from: opts.from } : {}),
                    ...(opts.to !== undefined ? { to: opts.to } : {}),
                    ...(opts.outcome !== undefined ? { outcome: parseOutcome(opts.outcome) } : {}),
                    ...(opts.limit !== undefined ? { limit: parseIntegerOption(opts.limit, '--limit') } : {}),
                    ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
                };
                const client = createClient();
                if (opts.all) {
                    // Auto-paginate over every page via the SDK PagePromise.
                    const traces: TraceSummary[] = [];
                    for await (const trace of client.runtime.traces.list(params)) traces.push(trace);
                    printOutput({ traces, next_cursor: null }, format);
                } else {
                    const response = await client.runtime.traces.list(params);
                    printOutput(response, format);
                }
            } catch (err) {
                handleCommandError(err);
            }
        });
}
