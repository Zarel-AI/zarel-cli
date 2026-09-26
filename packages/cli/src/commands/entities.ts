// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
// `entities` is a contract-plane command: `client.contract.*` targets
// `{tenant}.admin.{baseDomain}`, derived from the runtime base URL unless a
// contract base URL is configured.
import { Command } from 'commander';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { parseJsonObject } from '../parsers/json-input';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

export function registerEntitiesCommands(program: Command): void {
    const entitiesCmd = program
        .command('entities')
        .description('Manage entity definitions');

    entitiesCmd
        .command('list')
        .description('List all entities')
        .option('-f, --format <format>', 'Output format', 'table')
        .option('--locale <code>', 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.')
        .action(async (opts: { format: string; locale?: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.contract.entities.list({ locale })
                    : await client.contract.entities.list();
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    entitiesCmd
        .command('get <name>')
        .description('Get entity details')
        .option('-f, --format <format>', 'Output format', 'json')
        .option('--locale <code>', 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.')
        .action(async (name: string, opts: { format: string; locale?: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.contract.entities.get(name, { locale })
                    : await client.contract.entities.get(name);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    entitiesCmd
        .command('create')
        .description('Create a new entity')
        .requiredOption('-n, --name <name>', 'Entity name')
        .option('-d, --data <json>', 'Additional entity config as JSON')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (opts: { name: string; data?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const extra = opts.data ? parseJsonObject<Record<string, unknown>>(opts.data, 'Entity data') : {};
                const client = createClient();
                const response = await client.contract.entities.create({ name: opts.name, ...extra });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
