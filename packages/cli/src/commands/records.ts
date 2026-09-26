// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import type { RecordData } from '@zarel-ai/sdk';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { readJsonArrayInput, readJsonObjectInput, parseJsonObject } from '../parsers/json-input';
import { parseKeyValuePairs, parseStructuredValue } from '../parsers/key-value';
import { parseIntegerOption } from '../parsers/numeric-options';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const LOCALE_HELP = 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.';

export function registerRecordsCommands(program: Command): void {
    const recordsCmd = program
        .command('records')
        .description('Manage entity records');

    recordsCmd
        .command('list <entity>')
        .description('List records for an entity')
        .option('-l, --limit <n>', 'Max records to return', '20')
        .option('-o, --offset <n>', 'Offset for pagination')
        .option('--all', 'Fetch every page (auto-paginate); --limit becomes the page size')
        .option('--filter <kv...>', 'Filters as key=value pairs')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (entity: string, opts: { limit: string; offset?: string; all?: boolean; filter?: string[]; locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const filters = parseKVPairs(opts.filter ?? []);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const params = {
                    limit: parseIntegerOption(opts.limit, '--limit'),
                    ...(opts.offset !== undefined ? { offset: parseIntegerOption(opts.offset, '--offset') } : {}),
                    ...(Object.keys(filters).length > 0 ? { filters } : {}),
                };
                if (opts.all) {
                    // Auto-paginate over every page via the SDK PagePromise.
                    const records: RecordData[] = [];
                    const iterable = locale
                        ? client.runtime.records.list(entity, params, { locale })
                        : client.runtime.records.list(entity, params);
                    for await (const record of iterable) records.push(record);
                    printOutput({ records, total: records.length }, format);
                } else {
                    const response = locale
                        ? await client.runtime.records.list(entity, params, { locale })
                        : await client.runtime.records.list(entity, params);
                    printOutput(response, format);
                }
            } catch (err) {
                handleCommandError(err);
            }
        });

    recordsCmd
        .command('bulk <entity>')
        .description('Create multiple records from a JSON array (reads JSON from stdin or --items)')
        .option('-i, --items <json>', 'Bulk items as JSON array')
        .option('-m, --mode <mode>', 'Import mode: strict|best_effort', 'strict')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (entity: string, opts: { items?: string; mode: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const items = readJsonArrayInput<Array<Record<string, unknown>>>(opts.items, 'Bulk import items');
                const client = createClient();
                const response = await client.runtime.records.bulk(entity, {
                    items: items.map((item) => ({
                        data: isRecord(item.data) ? item.data : item,
                        ...(typeof item.owner_name === 'string' ? { owner_name: item.owner_name } : {}),
                    })),
                    mode: opts.mode === 'best_effort' ? 'best_effort' : 'strict',
                });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    recordsCmd
        .command('get <entity> <id>')
        .description('Get a single record by ID')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (entity: string, id: string, opts: { locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const recordId = id.length > 0 && !isNaN(Number(id)) ? Number(id) : id;
                const response = locale
                    ? await client.runtime.records.get(entity, recordId, { locale })
                    : await client.runtime.records.get(entity, recordId);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    recordsCmd
        .command('create <entity>')
        .description('Create a new record (reads JSON from stdin or --data)')
        .option('-d, --data <json>', 'Record data as JSON string')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (entity: string, opts: { data?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const data = readJsonObjectInput<Record<string, unknown>>(opts.data, 'Record data');
                const client = createClient();
                const response = await client.runtime.records.create(entity, data);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    recordsCmd
        .command('update <entity> <id>')
        .description('Update an existing record')
        .option('-d, --data <json>', 'Fields to update as JSON string')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (entity: string, id: string, opts: { data?: string; format: string }) => {
            try {
                if (!opts.data) {
                    console.error('Error: --data <json> is required');
                    process.exitCode = 2;
                    return;
                }
                const format = parseOutputFormat(opts.format);
                const data = parseJsonObject<Record<string, unknown>>(opts.data, 'Record data');
                const client = createClient();
                const recordId = id.length > 0 && !isNaN(Number(id)) ? Number(id) : id;
                const response = await client.runtime.records.update(entity, recordId, data);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    recordsCmd
        .command('delete <entity> <id>')
        .description('Delete a record')
        .action(async (entity: string, id: string) => {
            try {
                const client = createClient();
                const recordId = id.length > 0 && !isNaN(Number(id)) ? Number(id) : id;
                await client.runtime.records.delete(entity, recordId);
                console.log(`Deleted ${entity}/${id}`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}

function parseKVPairs(pairs: string[]): Record<string, string | number | boolean> {
    return parseKeyValuePairs<string | number | boolean>(
        pairs,
        value => {
            const parsed = parseStructuredValue(value);
            if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
                return parsed;
            }
            return JSON.stringify(parsed);
        },
        true,
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
