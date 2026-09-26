// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerAuditEvidenceCommand } from './evidence';
import { registerAuditListCommand } from './list';

/**
 * `zarel audit ...` — audit surfaces.
 *
 *   - `zarel audit list <log>`      → list rows of an audit table
 *                                     (binding_violations | topic_refusals)
 *   - `zarel audit evidence <log>`  → download a signed evidence bundle (.tar.gz)
 *                                     for an event hash-chain (state_machine | flows)
 *
 * Verify a downloaded bundle offline with `zarel verify <file> --keys <trust-keys.json>`.
 */
export function registerAuditCommands(program: Command): void {
    const auditCmd = program
        .command('audit')
        .description('Audit surfaces: list privacy-preserving audit rows or download a signed evidence bundle');

    registerAuditListCommand(auditCmd);
    registerAuditEvidenceCommand(auditCmd);
}
