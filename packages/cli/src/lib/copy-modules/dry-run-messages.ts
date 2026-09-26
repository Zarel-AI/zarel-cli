// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * Dry-run copy keys.
 */

export interface DryRunMessages {
    readonly headerLine: (tenant: string, windowDays: number) => string;
    readonly summaryHeading: string;
    readonly outcomesUnchanged: (count: number, pct: number) => string;
    readonly outcomesChanged: (count: number, pct: number) => string;
    readonly breakdownHeading: string;
    readonly affectedUsersHeading: string;
    readonly unknownsHeading: string;
    readonly unknownsExplain: (count: number) => string;
    readonly operationalImplicationsHeading: string;
    readonly hitlPerMonth: (count: number) => string;
    readonly requiredRoles: (roles: ReadonlyArray<string>) => string;
    readonly errors: {
        readonly windowTooLarge: string;
        readonly concurrencyLimitReached: string;
        readonly proposedSpecUnsupported: string;
    };
    readonly progress: {
        readonly queued: string;
        readonly running: (processed: number, total: number | null) => string;
        readonly completed: string;
        readonly failed: (reason: string) => string;
        readonly cancelled: string;
    };
}

export const dryRunMessages: DryRunMessages = {
    headerLine: (tenant, windowDays): string => `Replay summary — ${tenant} (${windowDays}-day window)`,
    summaryHeading: '## Outcomes',
    outcomesUnchanged: (count, pct): string => `Outcomes unchanged: ${count} (${pct.toFixed(1)}%)`,
    outcomesChanged: (count, pct): string => `Outcomes changed: ${count} (${pct.toFixed(1)}%)`,
    breakdownHeading: '## Breakdown of changes',
    affectedUsersHeading: '## Top affected users',
    unknownsHeading: '## Unknowns',
    unknownsExplain: (count): string =>
        `${count} trace${count === 1 ? '' : 's'} could not be re-evaluated against the proposed spec — see causes below. These are NOT silently dropped.`,
    operationalImplicationsHeading: '## Operational implications',
    hitlPerMonth: (count): string => `Estimated additional HITL approvals/month: **~${count}**`,
    requiredRoles: (roles): string =>
        roles.length === 0
            ? 'Approver pool affected: none.'
            : `Approver pool affected: ${roles.join(', ')}.`,
    errors: {
        windowTooLarge: 'Replay window exceeds the v1 limit of 90 days.',
        concurrencyLimitReached: 'Tenant has reached the concurrent-dry-run cap. Wait for the running job to finish or cancel it.',
        proposedSpecUnsupported: 'Proposed spec uses expression-engine builtins or contract features not available at the time of the historical traces.',
    },
    progress: {
        queued: 'Job queued.',
        running: (processed, total): string =>
            total === null ? `Running — ${processed} traces processed.` : `Running — ${processed}/${total} traces processed.`,
        completed: 'Completed.',
        failed: (reason): string => `Failed: ${reason}.`,
        cancelled: 'Cancelled.',
    },
};
