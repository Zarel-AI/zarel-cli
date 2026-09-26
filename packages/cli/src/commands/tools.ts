// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { parseKeyValuePairs, parseStructuredValue } from '../parsers/key-value';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

export function registerToolsCommands(program: Command): void {
    const toolsCmd = program
        .command('tools')
        .description('Discover and invoke tools');

    toolsCmd
        .command('list')
        .description('List available tools for the current user')
        .option('-f, --format <format>', 'Output format', 'table')
        .option('--locale <code>', 'Locale for tool labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.')
        .action(async (opts: { format: string; locale?: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale ? await client.runtime.tools.list({ locale }) : await client.runtime.tools.list();
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    toolsCmd
        .command('mcp')
        .description('List raw MCP tools')
        .option('-f, --format <format>', 'Output format', 'json')
        .option('--locale <code>', 'Locale for tool descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.')
        .action(async (opts: { format: string; locale?: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale ? await client.runtime.tools.mcp({ locale }) : await client.runtime.tools.mcp();
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    toolsCmd
        .command('call <name>')
        .description('Invoke a tool by name')
        .option('-p, --param <kv...>', 'Parameters as key=value pairs')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (name: string, opts: { param?: string[]; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const params = parseKVPairs(opts.param ?? []);
                const client = createClient();
                const response = await client.runtime.tools.call(name, params);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}

function parseKVPairs(pairs: string[]): Record<string, unknown> {
    return parseKeyValuePairs<unknown>(pairs, parseStructuredValue, true);
}
