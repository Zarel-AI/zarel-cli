// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const LOCALE_HELP = 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.';

export function registerConversationCommands(program: Command): void {
    const conversationCmd = program
        .command('conversation')
        .description('Conversation with the cognitive agent');

    conversationCmd
        .command('send <message>')
        .description('Send a message to the agent')
        // REQUIRED. The server never creates a session lazily, so a send with no key is refused
        // with `400 session_key is required`. The published request body types the key as
        // required; making the flag required turns that refusal into a usage message before a
        // request is sent at all.
        .requiredOption('-s, --session-key <sessionKey>', 'Existing session key (create one first with `conversation session create`)')
        .option('--llm-service <name>', 'Override the LLM service for this turn')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (message: string, opts: { sessionKey: string; llmService?: string; locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = await client.runtime.conversation.send(
                    {
                        message,
                        session_key: opts.sessionKey,
                        ...(opts.llmService !== undefined ? { llm_service: opts.llmService } : {}),
                    },
                    ...(locale ? [{ locale }] as const : [] as const),
                );
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    // Explicit conversation session creation surface.
    const sessionCmd = conversationCmd
        .command('session')
        .description('Manage conversation sessions explicitly (sessions are never created lazily)');

    sessionCmd
        .command('create')
        .description('Create a new conversation session with an explicit scope (the server mints the key)')
        .requiredOption('--scope <scope>', 'Session scope: "runtime" or "contract"')
        .requiredOption('-c, --channel <channel>', 'Channel name (as declared in the tenant contract; built-ins: desk, cli, api)')
        .option('-r, --roles-snapshot <roles>', 'Comma-separated snapshot of actor roles for this session (NOT a security gate — authorization is DB-resolved)', '')
        .option('--service <name>', 'Pin the session to a specific LLM service')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (opts: { scope: string; channel: string; rolesSnapshot: string; service?: string; format: string }) => {
            try {
                if (opts.scope !== 'runtime' && opts.scope !== 'contract') {
                    throw new Error('--scope must be "runtime" or "contract"');
                }
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const rolesSnapshot = opts.rolesSnapshot ? opts.rolesSnapshot.split(',').map((r) => r.trim()).filter(Boolean) : [];
                const response = await client.runtime.conversation.sessions.create({
                    scope: opts.scope,
                    channel_name: opts.channel,
                    rolesSnapshot,
                    ...(opts.service !== undefined ? { llmService: opts.service } : {}),
                });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    sessionCmd
        .command('get <session_key>')
        .description('Get a conversation session by key')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (sessionKey: string, opts: { format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const response = await client.runtime.conversation.sessions.get(sessionKey);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    sessionCmd
        .command('close <session_key>')
        .description('Close a conversation session (idempotent — sets status="cleared")')
        .action(async (sessionKey: string) => {
            try {
                const client = createClient();
                await client.runtime.conversation.sessions.delete(sessionKey);
                console.log(`Session ${sessionKey} cleared.`);
            } catch (err) {
                handleCommandError(err);
            }
        });

    conversationCmd
        .command('clear')
        .description('Clear the most recent active conversation session')
        .action(async () => {
            try {
                const client = createClient();
                const sessions = await client.runtime.conversation.sessions.list({ status: 'active', limit: 1 });
                const active = sessions?.[0];
                if (!active) {
                    console.log('No active session.');
                    return;
                }
                await client.runtime.conversation.sessions.delete(active.session_key);
                console.log(`Session ${active.session_key} cleared.`);
            } catch (err) {
                handleCommandError(err);
            }
        });

    conversationCmd
        .command('sessions')
        .description('List past conversation sessions')
        .option('-c, --channel <channel>', 'Filter by channel name (as declared in the tenant contract; built-ins: desk, cli, api)')
        .option('-s, --status <status>', 'Filter by status (active, expired, cleared)')
        .option('-l, --limit <limit>', 'Maximum number of results', '20')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { channel?: string; status?: string; limit: string; locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const params = {
                    ...(opts.channel !== undefined ? { channel_name: opts.channel } : {}),
                    ...(opts.status !== undefined ? { status: opts.status as 'active' | 'expired' | 'cleared' } : {}),
                    limit: parseInt(opts.limit, 10),
                };
                const response = locale
                    ? await client.runtime.conversation.sessions.list(params, { locale })
                    : await client.runtime.conversation.sessions.list(params);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    conversationCmd
        .command('show <session_key>')
        .description('Show a session with its turn history')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (sessionKey: string, opts: { locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.conversation.sessions.get(sessionKey, { locale })
                    : await client.runtime.conversation.sessions.get(sessionKey);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    conversationCmd
        .command('actions <session_key>')
        .description('Show actions (record mutations) linked to a session')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (sessionKey: string, opts: { locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.conversation.sessions.actions.list(sessionKey, { locale })
                    : await client.runtime.conversation.sessions.actions.list(sessionKey);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
