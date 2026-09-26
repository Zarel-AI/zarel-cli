// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * Contracts diff / apply / snapshot copy keys.
 */

export interface ContractsMessages {
    readonly diff: {
        readonly headerLine: (tenant: string, currentVersion: string, proposedVersion: string) => string;
        readonly currentLine: (version: string, hash: string) => string;
        readonly proposedLine: (version: string, hash: string) => string;
        readonly noChanges: string;
        readonly sectionHeading: (section: string) => string;
        readonly breakingBadge: string;
        readonly behaviouralBadge: string;
        readonly additiveBadge: string;
        readonly impactSummaryHeading: string;
        readonly impactRecommendedReviewers: (roles: ReadonlyArray<string>) => string;
    };
    readonly apply: {
        readonly success: (tenant: string, oldVersion: string, newVersion: string) => string;
        readonly hashMismatch: string;
        readonly breakingBlocked: string;
        readonly invalidSpec: string;
        readonly permissionDenied: string;
    };
    readonly snapshot: {
        readonly headerLine: (version: string, hash: string) => string;
    };
}

export const contractsMessages: ContractsMessages = {
    diff: {
        headerLine: (tenant, current, proposed): string =>
            `Contract diff for ${tenant} — ${current} → ${proposed}`,
        currentLine: (version, hash): string => `Current deployed: ${version} (${hash.slice(0, 12)}...)`,
        proposedLine: (version, hash): string => `Local file: ${version} (${hash.slice(0, 12)}...)`,
        noChanges: 'No structural changes.',
        sectionHeading: (section: string): string => `## ${section.charAt(0).toUpperCase() + section.slice(1)}`,
        breakingBadge: '**BREAKING**',
        behaviouralBadge: '**behavioural**',
        additiveBadge: '_additive_',
        impactSummaryHeading: '## Policy impact',
        impactRecommendedReviewers: (roles): string =>
            roles.length === 0
                ? 'Recommended reviewers: none flagged.'
                : `Recommended reviewers: ${roles.join(', ')}.`,
    },
    apply: {
        success: (tenant, oldV, newV): string => `Contract applied to ${tenant}\n  ${oldV} → ${newV}`,
        hashMismatch: 'Contract hash mismatch — another deploy applied changes since this diff was computed. Re-run `zarel contracts diff <file>` and try again.',
        breakingBlocked: 'Apply blocked: proposed spec contains breaking changes and --require-no-breaking was set.',
        invalidSpec: 'Proposed spec failed validation.',
        permissionDenied: 'Permission denied: actor cannot modify contracts for this tenant.',
    },
    snapshot: {
        headerLine: (version, hash): string => `# Contract snapshot — ${version} (${hash.slice(0, 12)}...)`,
    },
};
