// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import type {
    AuditRowLogName,
    BindingViolationAuditListParams,
    TopicRefusalAuditListParams,
    BindingViolationAuditRow,
    TopicRefusalAuditRow,
} from '@zarel-ai/sdk';
import { createClient } from '../../client';
import { handleCommandError } from '../../error-handler';
import { parseIntegerOption } from '../../parsers/numeric-options';
import { parseOutputFormat } from '../../parsers/output-format';
import { printOutput } from '../../printers/output';

const ROW_LOGS: ReadonlyArray<AuditRowLogName> = ['binding_violations', 'topic_refusals'];
const BINDING_MODES = ['bind', 'assert', 'immutable'] as const;
const TOPIC_REASONS = ['matched', 'no_verdict'] as const;

function assertRowLog(log: string): asserts log is AuditRowLogName {
    if (!(ROW_LOGS as ReadonlyArray<string>).includes(log)) {
        throw new Error(`Unknown audit log '${log}' — expected one of: ${ROW_LOGS.join(', ')}. (For 'state_machine'/'flows' use 'zarel audit evidence <log>'.)`);
    }
}

function parseEnum<T extends string>(value: string, allowed: ReadonlyArray<T>, flag: string): T {
    if (!(allowed as ReadonlyArray<string>).includes(value)) {
        throw new Error(`Invalid ${flag} value '${value}' — expected one of: ${allowed.join(', ')}.`);
    }
    return value as T;
}

interface AuditListOpts {
    entity?: string;
    field?: string;
    bindingMode?: string;
    category?: string;
    reason?: string;
    verdict?: string;
    from?: string;
    to?: string;
    limit?: string;
    cursor?: string;
    all?: boolean;
    format: string;
}

/**
 * `zarel audit list <log>` — list rows of a privacy-preserving
 * audit table (`binding_violations` | `topic_refusals`). Faithful wrapper over
 * `client.runtime.audit.list(log, {...})`. Sibling of `zarel audit evidence <log>`.
 */
export function registerAuditListCommand(auditCmd: Command): void {
    auditCmd
        .command('list <log>')
        .description('List rows of an audit table (binding_violations | topic_refusals); newest first, cursor-paginated')
        .option('--entity <name>', 'binding_violations: filter by entity')
        .option('--field <name>', 'binding_violations: filter by field')
        .option('--binding-mode <mode>', 'binding_violations: filter by binding mode (bind | assert | immutable)')
        .option('--category <slug>', 'topic_refusals: filter by category')
        .option('--reason <reason>', 'topic_refusals: filter by reason (matched | no_verdict)')
        .option('--verdict <verdict>', 'topic_refusals: filter by verdict')
        .option('--from <iso8601>', 'Lower bound (inclusive) on created_at')
        .option('--to <iso8601>', 'Upper bound (inclusive) on created_at')
        .option('--limit <n>', 'Max results per page (1–500, default 50)')
        .option('--cursor <opaque>', 'Continuation cursor from a previous page')
        .option('--all', 'Fetch every page (auto-paginate across cursors); --limit becomes the page size')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (log: string, opts: AuditListOpts) => {
            try {
                assertRowLog(log);
                const format = parseOutputFormat(opts.format);
                const client = createClient();

                if (log === 'binding_violations') {
                    const params: BindingViolationAuditListParams = {
                        ...(opts.entity !== undefined ? { entity: opts.entity } : {}),
                        ...(opts.field !== undefined ? { field: opts.field } : {}),
                        ...(opts.bindingMode !== undefined ? { bindingMode: parseEnum(opts.bindingMode, BINDING_MODES, '--binding-mode') } : {}),
                        ...(opts.from !== undefined ? { from: opts.from } : {}),
                        ...(opts.to !== undefined ? { to: opts.to } : {}),
                        ...(opts.limit !== undefined ? { limit: parseIntegerOption(opts.limit, '--limit') } : {}),
                        ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
                    };
                    if (opts.all) {
                        const items: BindingViolationAuditRow[] = [];
                        for await (const row of client.runtime.audit.list('binding_violations', params)) items.push(row);
                        printOutput({ items, next_cursor: null }, format);
                    } else {
                        printOutput(await client.runtime.audit.list('binding_violations', params), format);
                    }
                    return;
                }

                const params: TopicRefusalAuditListParams = {
                    ...(opts.category !== undefined ? { category: opts.category } : {}),
                    ...(opts.reason !== undefined ? { reason: parseEnum(opts.reason, TOPIC_REASONS, '--reason') } : {}),
                    ...(opts.verdict !== undefined ? { verdict: opts.verdict } : {}),
                    ...(opts.from !== undefined ? { from: opts.from } : {}),
                    ...(opts.to !== undefined ? { to: opts.to } : {}),
                    ...(opts.limit !== undefined ? { limit: parseIntegerOption(opts.limit, '--limit') } : {}),
                    ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
                };
                if (opts.all) {
                    const items: TopicRefusalAuditRow[] = [];
                    for await (const row of client.runtime.audit.list('topic_refusals', params)) items.push(row);
                    printOutput({ items, next_cursor: null }, format);
                } else {
                    printOutput(await client.runtime.audit.list('topic_refusals', params), format);
                }
            } catch (err) {
                handleCommandError(err);
            }
        });
}
