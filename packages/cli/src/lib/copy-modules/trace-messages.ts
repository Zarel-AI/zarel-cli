// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * Trace-related copy keys.
 */

export interface TraceMessages {
    readonly tableHeader: {
        readonly traceId: string;
        readonly tenant: string;
        readonly session: string;
        readonly specVersion: string;
        readonly specHash: string;
        readonly user: string;
        readonly flow: string;
        readonly startedAt: string;
        readonly durationMs: string;
        readonly outcome: string;
    };
    readonly outcomeLabels: {
        readonly executed: string;
        readonly refused: string;
        readonly awaitingHumanDecision: string;
        readonly failed: string;
    };
    readonly stageLabels: {
        readonly topicGate: string;
        readonly intentScoring: string;
        readonly envelope: string;
        readonly gatekeeper: string;
        readonly preconditions: string;
        readonly hitl: string;
        readonly execution: string;
        readonly audit: string;
    };
    readonly errors: {
        readonly notFound: string;
        readonly legacyNotAvailable: string;
        readonly permissionDenied: string;
    };
    readonly query: {
        readonly resultsHeader: (count: number) => string;
        readonly emptyResults: string;
    };
}

export const traceMessages: TraceMessages = {
    tableHeader: {
        traceId: 'trace_id:',
        tenant: 'tenant:',
        session: 'session:',
        specVersion: 'spec_version:',
        specHash: 'spec_hash:',
        user: 'user:',
        flow: 'flow:',
        startedAt: 'started_at:',
        durationMs: 'duration_ms:',
        outcome: 'outcome:',
    },
    outcomeLabels: {
        executed: 'executed',
        refused: 'refused',
        awaitingHumanDecision: 'awaiting human decision',
        failed: 'failed',
    },
    stageLabels: {
        topicGate: 'topic_gate',
        intentScoring: 'intent_scoring',
        envelope: 'envelope',
        gatekeeper: 'gatekeeper',
        preconditions: 'preconditions',
        hitl: 'hitl',
        execution: 'execution',
        audit: 'audit',
    },
    errors: {
        notFound: 'Trace not found.',
        legacyNotAvailable: 'Trace not available — pre-feature session has no trace_id.',
        permissionDenied: 'Trace not found.',
    },
    query: {
        resultsHeader: (count: number): string => `Found ${count} trace${count === 1 ? '' : 's'}.`,
        emptyResults: 'No traces match the supplied filter.',
    },
};
