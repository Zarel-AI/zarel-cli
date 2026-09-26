// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { parseIntegerOption } from '../parsers/numeric-options';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const LOCALE_HELP = 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.';

export function registerEventsCommands(program: Command): void {
    const eventsCmd = program
        .command('events')
        .description('Manage webhook event subscriptions');

    eventsCmd
        .command('subscribe')
        .description('Create a new webhook event subscription')
        .requiredOption('-e, --event <name>', 'Event name to subscribe to (e.g. app.requested)')
        .requiredOption('-u, --url <url>', 'Webhook URL to receive event payloads')
        .option('-s, --secret <secret>', 'Shared secret for webhook signature verification')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (opts: { event: string; url: string; secret?: string; format: string }) => {
            try {
                const client = createClient();
                const format = parseOutputFormat(opts.format);
                const response = await client.runtime.events.subscriptions.create({
                    event_name: opts.event,
                    webhook_url: opts.url,
                    ...(opts.secret ? { secret: opts.secret } : {}),
                });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    eventsCmd
        .command('list')
        .description('List all active webhook subscriptions')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { locale?: string; format: string }) => {
            try {
                const client = createClient();
                const format = parseOutputFormat(opts.format);
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.events.subscriptions.list({ locale })
                    : await client.runtime.events.subscriptions.list();
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    eventsCmd
        .command('tail')
        .description('Stream live tenant events to the terminal (Ctrl-C to stop)')
        .option('-b, --buffer-size <n>', 'Bounded buffer capacity; oldest events drop on overflow', '1024')
        .option('--last-event-id <id>', 'Resume the stream from a known SSE event id')
        .option('--no-reconnect', 'Do not reconnect on a transient disconnect (default: reconnect)')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (opts: { bufferSize: string; lastEventId?: string; reconnect: boolean; format: string }) => {
            try {
                const client = createClient();
                const format = parseOutputFormat(opts.format);
                // Ctrl-C aborts the AbortSignal, which the SDK iterator treats as
                // a clean teardown: the `for await` ends and the command exits 0.
                const controller = new AbortController();
                const onSigint = (): void => controller.abort();
                process.once('SIGINT', onSigint);
                try {
                    const iterable = client.runtime.events.iterate({
                        signal: controller.signal,
                        bufferSize: parseIntegerOption(opts.bufferSize, '--buffer-size'),
                        ...(opts.reconnect === false ? { reconnect: false } : {}),
                        ...(opts.lastEventId !== undefined ? { lastEventId: opts.lastEventId } : {}),
                        onDropped: (n) => console.error(`Warning: dropped ${n} event(s) — consumer is falling behind`),
                    });
                    for await (const event of iterable) {
                        printOutput(event, format);
                    }
                } finally {
                    process.removeListener('SIGINT', onSigint);
                }
            } catch (err) {
                handleCommandError(err);
            }
        });

    eventsCmd
        .command('delete <subscriptionId>')
        .description('Deactivate a webhook subscription by ID')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (subscriptionId: string, opts: { format: string }) => {
            try {
                const client = createClient();
                const format = parseOutputFormat(opts.format);
                const response = await client.runtime.events.subscriptions.delete(subscriptionId);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
