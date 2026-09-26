// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * `zarel runtime llm-credential ...` commands.
 *
 *   zarel runtime llm-credential list
 *   zarel runtime llm-credential get <name>
 *   zarel runtime llm-credential set <name> --api-key-stdin [--base-url URL]
 *   zarel runtime llm-credential unset <name>
 *
 * Security baseline:
 *   - `set` reads the api_key from STDIN. There is no `--api-key <value>` flag —
 *     plaintext on a command line would land in shell history. STDIN data is
 *     consumed once and never echoed.
 *   - `get` and `list` print only metadata. The CLI MUST NOT have any
 *     "decrypt and print" command.
 */

import { Command } from 'commander';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const LOCALE_HELP = 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.';

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    return await new Promise<string>((resolve, reject) => {
        process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
        process.stdin.on('error', reject);
    });
}

export function registerLlmCredentialCommands(program: Command): void {
    const cmd = program
        .command('llm-credential')
        .description('Manage encrypted LLM credentials (write-only on api_key)');

    cmd
        .command('list')
        .description('List masked metadata for credentials the actor can manage')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.llm.credentials.list({ locale })
                    : await client.runtime.llm.credentials.list();
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    cmd
        .command('get <name>')
        .description('Fetch masked metadata for one credential (404 if not authorized)')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (name: string, opts: { locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.llm.credentials.get(name, { locale })
                    : await client.runtime.llm.credentials.get(name);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    cmd
        .command('set <name>')
        .description('Set / replace a credential. The api_key is read from STDIN — never from a flag.')
        .requiredOption('--api-key-stdin', 'Confirms the api_key is being supplied via STDIN')
        .option('--base-url <url>', 'Optional base URL override (self-hosted endpoints)')
        .action(async (name: string, opts: { baseUrl?: string }) => {
            try {
                if (process.stdin.isTTY) {
                    throw new Error('--api-key-stdin requires the api_key on STDIN, e.g. `echo "$KEY" | zarel runtime llm-credential set primary --api-key-stdin`');
                }
                const apiKey = await readStdin();
                if (!apiKey) {
                    throw new Error('STDIN was empty — no api_key provided');
                }
                const client = createClient();
                const response = await client.runtime.llm.credentials.put(name, {
                    apiKey,
                    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
                });
                // Print metadata (already masked server-side).
                console.log(JSON.stringify(response, null, 2));
            } catch (err) {
                handleCommandError(err);
            }
        });

    cmd
        .command('unset <name>')
        .description('Remove a credential (409 if any active session is pinned to the service)')
        .action(async (name: string) => {
            try {
                const client = createClient();
                await client.runtime.llm.credentials.delete(name);
                console.log(`Credential for '${name}' removed.`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
