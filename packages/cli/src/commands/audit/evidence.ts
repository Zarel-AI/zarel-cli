// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import * as fs from 'node:fs';
import { Command } from 'commander';
import { createClient } from '../../client';
import { handleCommandError } from '../../error-handler';
import { printStdout } from '../../printers/stdout';

/**
 * `zarel audit evidence <log>`.
 *
 * Downloads a signed audit tamper-evidence bundle (`.tar.gz`) for the tenant's
 * `<log>` hash-chain (`state_machine` | `flows`). Verify it offline with
 * `zarel verify <file> --keys <trust-keys.json>`. For a large log, bound the
 * export with `--from`/`--to` (inclusive `seq` range) — the server refuses an
 * over-cap request with HTTP 413.
 */
function parseSeqOption(raw: string | undefined, flag: string): number | undefined {
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(raw)) {
        throw new Error(`${flag} must be a non-negative integer (got '${raw}').`);
    }
    return Number(raw);
}

export function registerAuditEvidenceCommand(auditCmd: Command): void {
    auditCmd
        .command('evidence <log>')
        .description('Download a signed audit tamper-evidence bundle (.tar.gz) for offline verification')
        .option('-o, --output <path>', 'Output file path; defaults to audit-<log>.tar.gz')
        .option('--from <seq>', 'Inclusive lower seq bound (bound a large log; non-negative integer)')
        .option('--to <seq>', 'Inclusive upper seq bound (non-negative integer; must be >= --from)')
        .action(async (log: string, opts: { output?: string; from?: string; to?: string }) => {
            try {
                if (log !== 'state_machine' && log !== 'flows') {
                    throw new Error(`Unknown log '${log}' — expected 'state_machine' or 'flows'.`);
                }
                const from = parseSeqOption(opts.from, '--from');
                const to = parseSeqOption(opts.to, '--to');
                if (from !== undefined && to !== undefined && from > to) {
                    throw new Error('--from must be <= --to.');
                }
                // Build with only the defined bounds (exactOptionalPropertyTypes).
                const range: { from?: number; to?: number } = {};
                if (from !== undefined) range.from = from;
                if (to !== undefined) range.to = to;
                const client = createClient();
                const bytes = await client.runtime.audit.evidence(
                    log,
                    from !== undefined || to !== undefined ? range : undefined,
                );
                const outPath = opts.output ?? `audit-${log}.tar.gz`;
                fs.writeFileSync(outPath, Buffer.from(bytes));
                printStdout(`Wrote audit evidence bundle to ${outPath} (${bytes.byteLength} bytes)`);
                printStdout(`Verify offline: zarel verify ${outPath} --keys <trust-keys.json>`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
