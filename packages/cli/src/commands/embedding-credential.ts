// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * `zarel runtime embedding-credential ...` commands.
 *
 *   zarel runtime embedding-credential list
 *   zarel runtime embedding-credential get <name>
 *   zarel runtime embedding-credential set <name> --api-key-stdin [--base-url URL]
 *   zarel runtime embedding-credential set <name> --aws-stdin   (AWS JSON on STDIN)
 *   zarel runtime embedding-credential unset <name>
 *
 * `<name>` is the DECLARED `embeddings.services[].name`, not a provider
 * — the server resolves the provider from that declaration, so which STDIN flag
 * applies follows the CONTRACT, not the argument you type. Keyed per
 * (tenant, declared service). Mirrors `llm-credential`:
 *   - secrets are read from STDIN only — never a `--…<value>` flag (shell history).
 *   - `get` / `list` print only masked metadata; there is no decrypt-and-print.
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

export function registerEmbeddingCredentialCommands(program: Command): void {
    const cmd = program
        .command('embedding-credential')
        .description('Manage encrypted embedding credentials per (tenant, declared service) — write-only on the secret');

    cmd
        .command('list')
        .description('List masked metadata for the tenant\'s embedding credentials')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.embeddings.credentials.list({ locale })
                    : await client.runtime.embeddings.credentials.list();
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    cmd
        .command('get <name>')
        .description('Fetch masked metadata for one declared service\'s credential (404 if not authorized / not configured)')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (name: string, opts: { locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.embeddings.credentials.get(name, { locale })
                    : await client.runtime.embeddings.credentials.get(name);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    cmd
        .command('set <name>')
        .description('Set / replace a credential. The secret is read from STDIN — never a flag.')
        .option('--api-key-stdin', 'the service is declared on an apiKey provider (gemini/openai/anthropic): the api key is on STDIN')
        .option('--aws-stdin', 'the service is declared on bedrock: an AWS credential JSON {accessKeyId,secretAccessKey,region,sessionToken?} is on STDIN')
        .option('--base-url <url>', 'Optional base URL override (apiKey providers)')
        .action(async (name: string, opts: { apiKeyStdin?: boolean; awsStdin?: boolean; baseUrl?: string }) => {
            try {
                if (Boolean(opts.apiKeyStdin) === Boolean(opts.awsStdin)) {
                    throw new Error('provide exactly one of --api-key-stdin or --aws-stdin');
                }
                if (process.stdin.isTTY) {
                    throw new Error('the secret must be supplied via STDIN, e.g. `echo "$KEY" | zarel runtime embedding-credential set semantic --api-key-stdin`');
                }
                const raw = await readStdin();
                if (!raw) {
                    throw new Error('STDIN was empty — no credential provided');
                }
                const client = createClient();
                let input:
                    | { apiKey: string; baseUrl?: string }
                    | { accessKeyId: string; secretAccessKey: string; region: string; sessionToken?: string };
                if (opts.awsStdin) {
                    try {
                        input = JSON.parse(raw) as { accessKeyId: string; secretAccessKey: string; region: string; sessionToken?: string };
                    } catch {
                        throw new Error('--aws-stdin expects a JSON object {accessKeyId,secretAccessKey,region,sessionToken?} on STDIN');
                    }
                } else {
                    input = { apiKey: raw, ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}) };
                }
                const response = await client.runtime.embeddings.credentials.put(name, input);
                console.log(JSON.stringify(response, null, 2));
            } catch (err) {
                handleCommandError(err);
            }
        });

    cmd
        .command('unset <name>')
        .description('Remove a declared service\'s embedding credential (soft-delete + sensitive wipe)')
        .action(async (name: string) => {
            try {
                const client = createClient();
                await client.runtime.embeddings.credentials.delete(name);
                console.log(`Embedding credential for service '${name}' removed.`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
