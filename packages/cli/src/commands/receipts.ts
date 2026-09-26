// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import type { Receipt, ReceiptSignal, ReceiptListParams } from '@zarel-ai/sdk';
import { createClient } from '../client';
import { handleCommandError } from '../error-handler';
import { parseIntegerOption } from '../parsers/numeric-options';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const SIGNALS: ReadonlyArray<ReceiptSignal> = ['refusal', 'binding_violation', 'validation_violation'];

function parseSignal(value: string): ReceiptSignal {
    if (!(SIGNALS as ReadonlyArray<string>).includes(value)) {
        throw new Error(`Invalid --signal value '${value}' — expected one of: ${SIGNALS.join(', ')}.`);
    }
    return value as ReceiptSignal;
}

interface ReceiptsListOpts {
    signal?: string;
    traceId?: string;
    from?: string;
    to?: string;
    limit?: string;
    cursor?: string;
    all?: boolean;
    format: string;
}

/**
 * `zarel receipts list` — list the AUTHENTICATED user's OWN
 * governance receipts (refusals + binding/validation violations), normalized.
 * Always scoped server-side to the caller (no view_traces). Faithful wrapper over
 * `client.runtime.receipts.list({...})`; sibling of `zarel audit list <log>`
 * (the operator, tenant-wide surface).
 */
export function registerReceiptsCommands(program: Command): void {
    const receiptsCmd = program
        .command('receipts')
        .description('List the caller\'s own governance receipts (self-scoped, normalized over the 3 audit signals)');

    receiptsCmd
        .command('list')
        .description('List your own receipts; newest first, cursor-paginated')
        .option('--signal <signal>', 'Filter by signal (refusal | binding_violation | validation_violation)')
        .option('--trace-id <id>', 'Filter by conversation/request correlation id')
        .option('--from <iso8601>', 'Lower bound (inclusive) on created_at')
        .option('--to <iso8601>', 'Upper bound (inclusive) on created_at')
        .option('--limit <n>', 'Max results per page (1–100, default 50)')
        .option('--cursor <opaque>', 'Continuation cursor from a previous page')
        .option('--all', 'Fetch every page (auto-paginate across cursors); --limit becomes the page size')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: ReceiptsListOpts) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const params: ReceiptListParams = {
                    ...(opts.signal !== undefined ? { signal: parseSignal(opts.signal) } : {}),
                    ...(opts.traceId !== undefined ? { trace_id: opts.traceId } : {}),
                    ...(opts.from !== undefined ? { from: opts.from } : {}),
                    ...(opts.to !== undefined ? { to: opts.to } : {}),
                    ...(opts.limit !== undefined ? { limit: parseIntegerOption(opts.limit, '--limit') } : {}),
                    ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
                };
                if (opts.all) {
                    const items: Receipt[] = [];
                    for await (const row of client.runtime.receipts.list(params)) items.push(row);
                    printOutput({ items, next_cursor: null }, format);
                } else {
                    printOutput(await client.runtime.receipts.list(params), format);
                }
            } catch (err) {
                handleCommandError(err);
            }
        });
}
