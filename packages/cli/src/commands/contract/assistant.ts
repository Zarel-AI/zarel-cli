// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * `zarel contract assistant ...` — conversational contract authoring.
 *
 * Thin wrappers over `client.contract.assistant.*` (the contract-plane
 * conversational authoring surface). Reads/stages via conversation; the SOLE
 * contract-mutation path is `changeset apply`, which REQUIRES `--base-hash`
 * (deliberate out-of-band consent over a known base).
 */

import { Command, InvalidArgumentError } from 'commander';
import { createClient } from '../../client';
import { handleCommandError } from '../../error-handler';
import { parseOutputFormat } from '../../parsers/output-format';
import { printOutput } from '../../printers/output';

export function registerAssistantCommands(program: Command): void {
    const assistant = program
        .command('assistant')
        .description('Conversational contract authoring (conversation + staged changesets)');

    // ── session ──────────────────────────────────────────────────────────
    const session = assistant.command('session').description('Assistant conversation sessions');
    session
        .command('create')
        .description('Open a contract-assistant conversation')
        .option('--llm-service <name>', 'Pin a usable contract-scope LLM service')
        .option('--locale <locale>', 'Conversation locale')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { llmService?: string; locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const res = await client.contract.assistant.createSession({
                    ...(opts.llmService !== undefined ? { llm_service: opts.llmService } : {}),
                    ...(opts.locale !== undefined ? { locale: opts.locale } : {}),
                });
                printOutput(res, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    // ── conversation ─────────────────────────────────────────────────────────────
    const conversation = assistant.command('conversation').description('Converse with the assistant');
    conversation
        .command('send')
        .description('Send one conversational turn (stages; never applies)')
        .requiredOption('--session <key>', 'Session key from `assistant session create`')
        .requiredOption('--message <text>', 'The message to send')
        .option('--llm-service <name>', 'Per-turn LLM service override')
        .option('--locale <locale>', 'Turn locale')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { session: string; message: string; llmService?: string; locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const res = await client.contract.assistant.conversationSend({
                    session_key: opts.session,
                    message: opts.message,
                    ...(opts.llmService !== undefined ? { llm_service: opts.llmService } : {}),
                    ...(opts.locale !== undefined ? { locale: opts.locale } : {}),
                });
                printOutput(res, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    // ── changeset ──────────────────────────────────────────────────────────
    const changeset = assistant.command('changeset').description('Inspect / apply / discard the staged changeset');
    changeset
        .command('get <id>')
        .description('Preview the staged changeset (status, base, diff, YAML)')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (id: string, opts: { format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                printOutput(await client.contract.assistant.getChangeset(id), format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    changeset
        .command('apply <id>')
        .description('Apply the changeset — the sole contract-mutation path (one version bump)')
        .requiredOption('--base-hash <version>', 'The base the changeset was staged on (consent over a known base)')
        .option('--reject-breaking', 'Block the apply if it contains breaking changes')
        .option('--max-changes <n>', 'Block the apply if it exceeds this many changes', (v) => {
            const n = Number.parseInt(v, 10);
            if (Number.isNaN(n) || n < 0) throw new InvalidArgumentError('must be a non-negative integer.');
            return n;
        })
        .option('--force', 'Apply even if plan-ceiling grants would be stripped')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (id: string, opts: { baseHash: string; rejectBreaking?: boolean; maxChanges?: number; force?: boolean; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const gating = {
                    ...(opts.rejectBreaking ? { reject_breaking_changes: true } : {}),
                    ...(opts.maxChanges !== undefined ? { max_changes: opts.maxChanges } : {}),
                };
                const res = await client.contract.assistant.applyChangeset(id, {
                    base_hash: opts.baseHash,
                    ...(Object.keys(gating).length > 0 ? { gating } : {}),
                    ...(opts.force ? { force: true } : {}),
                });
                printOutput(res, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    changeset
        .command('discard <id>')
        .description('Discard a pending/stale changeset')
        .action(async (id: string) => {
            try {
                const client = createClient();
                await client.contract.assistant.discardChangeset(id);
                console.log(`Discarded changeset ${id}.`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
