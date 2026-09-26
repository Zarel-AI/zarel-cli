// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * `zarel runtime llm-service ...` commands.
 *
 * Read-only over the LLM service catalog. The wire surface is always
 * actor-filtered (it never lists a service the caller may not use); privileged
 * operators see the full catalog
 * because their YAML policies grant them `use` on every service.
 */

import { Command } from 'commander';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const LOCALE_HELP = 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.';

export function registerLlmServiceCommands(program: Command): void {
    const llm = program
        .command('llm-service')
        .description('Inspect the LLM service catalog (actor-filtered)');

    llm
        .command('list')
        .description('List the LLM services the current actor can `use` in `--scope`')
        .requiredOption('--scope <scope>', '"runtime" or "contract"')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { scope: string; locale?: string; format: string }) => {
            try {
                if (opts.scope !== 'runtime' && opts.scope !== 'contract') {
                    throw new Error('--scope must be "runtime" or "contract"');
                }
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.llm.services.list({ scope: opts.scope }, { locale })
                    : await client.runtime.llm.services.list({ scope: opts.scope });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    llm
        .command('get <name>')
        .description('Fetch one LLM service by name in `--scope` (404 if not authorized)')
        .requiredOption('--scope <scope>', '"runtime" or "contract"')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (name: string, opts: { scope: string; locale?: string; format: string }) => {
            try {
                if (opts.scope !== 'runtime' && opts.scope !== 'contract') {
                    throw new Error('--scope must be "runtime" or "contract"');
                }
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.llm.services.get(name, { scope: opts.scope }, { locale })
                    : await client.runtime.llm.services.get(name, { scope: opts.scope });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
