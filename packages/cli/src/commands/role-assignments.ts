// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const LOCALE_HELP = 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.';

/**
 * `zarel role-assignments ...` — canonical runtime-scope role assignments.
 * Replaces the older action-style `zarel roles assign/revoke` with
 * resource-shaped create/delete mirroring `/runtime/roles/assignments`.
 */
export function registerRoleAssignmentsCommands(program: Command): void {
    const ra = program
        .command('role-assignments')
        .description('Manage role assignments for users');

    ra
        .command('list')
        .description('List all role assignments for the tenant')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const response = locale
                    ? await client.runtime.roles.assignments.list({ locale })
                    : await client.runtime.roles.assignments.list();
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    ra
        .command('create')
        .description('Assign a role to a user')
        .requiredOption('-u, --user <name>', 'Target user name')
        .requiredOption('-r, --role <name>', 'Role name to assign')
        .option('-e, --expires-at <iso>', 'Expiration timestamp (ISO-8601)')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (opts: { user: string; role: string; expiresAt?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const response = await client.runtime.roles.assignments.create({
                    target_user_name: opts.user,
                    role_name: opts.role,
                    ...(opts.expiresAt ? { expires_at: opts.expiresAt } : {}),
                });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    ra
        .command('delete <user> <role>')
        .description('Revoke a role assignment (by composite natural key)')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (user: string, role: string, opts: { format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const response = await client.runtime.roles.assignments.delete(user, role);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
