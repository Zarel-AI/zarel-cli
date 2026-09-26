// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { stringify as yamlStringify } from 'yaml';
// `contracts` is a contract-plane command.
// See client.ts for the rationale.
import type {
    SpecApplyMode,
    SpecApplyRequest,
    SpecDiff,
    SpecDryRunJob,
    SpecDryRunReplayWindow,
    SpecDryRunSubmitRequest,
} from '@zarel-ai/sdk';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';

/**
 * Read a structural contract YAML plus any sibling
 * `<base>.i18n.<locale>.yaml` files from the same directory. Returns the
 * two-plane `{structural, semanticByLocale?}` payload for
 * `client.contract.spec.publish` / `.apply`.
 */
function readContractFiles(filePath: string): { structural: string; semanticByLocale?: Record<string, string> } {
    const structural = fs.readFileSync(filePath, 'utf-8');
    const dir = path.dirname(filePath);
    const base = path.basename(filePath).replace(/\.yaml$/, '');
    const semanticByLocale: Record<string, string> = {};
    let entries: string[] = [];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        // dir not readable — fall back to structural-only.
        return { structural };
    }
    for (const f of entries) {
        if (!f.startsWith(`${base}.i18n.`) || !f.endsWith('.yaml')) continue;
        const m = f.match(/\.i18n\.([^.]+)\.yaml$/);
        if (!m || m[1] === undefined) continue;
        const locale = m[1];
        semanticByLocale[locale] = fs.readFileSync(path.resolve(dir, f), 'utf-8');
    }
    return Object.keys(semanticByLocale).length > 0
        ? { structural, semanticByLocale }
        : { structural };
}

const LOCALE_HELP = 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.';
import { parseOutputFormat } from '../parsers/output-format';
import { parseIntegerOption } from '../parsers/numeric-options';
import { printOutput } from '../printers/output';
import { printStdout, printStderr } from '../printers/stdout';
import { dryRunMessages } from '../lib/copy-modules/dry-run-messages';

/**
 * `zarel contract spec ...` — contract spec management (renamed from `zarel contracts`).
 *
 * Subcommands:
 *   - apply <file>     — POST /contract/spec/apply (with gating) or /contract/spec/publish
 *   - diff <file>      — POST /contract/spec/diff (markdown default; exit 1 on differences)
 *   - snapshot         — GET  /contract/spec/snapshot
 *   - dry-run <file>   — POST /contract/spec/dry-run
 */
export function registerContractSpecCommands(parent: Command): void {
    const contractsCmd = parent
        .command('spec')
        .description('Manage the YAML spec');

    // ──────────────────────────────────────────────────────────────────
    // apply
    // ──────────────────────────────────────────────────────────────────
    contractsCmd
        .command('apply <file>')
        .description('Apply a YAML spec (POST /contract/spec/publish or /contract/spec/apply with gating)')
        .option('-m, --mode <mode>', 'Apply mode: upsert | replace', 'upsert')
        .option('-e, --expected-hash <hash>', 'Optimistic concurrency: reject if deployed hash differs')
        .option('--require-no-breaking', 'Reject the apply if the diff contains BREAKING changes (uses /contract/spec/apply)')
        .option('--max-changes <n>', 'Reject the apply if the diff exceeds this many changes')
        .option('--force', 'Proceed even when plan-as-ceiling enforcement would strip more than the server threshold of over-budget grants')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (file: string, opts: {
            mode: string;
            expectedHash?: string;
            requireNoBreaking?: boolean;
            maxChanges?: string;
            force?: boolean;
            format: string;
        }) => {
            try {
                const mode = parseApplyMode(opts.mode);
                const format = parseOutputFormat(opts.format);
                const files = readContractFiles(file);
                const client = createClient();

                const useApplyEndpoint = Boolean(opts.requireNoBreaking) || opts.maxChanges !== undefined;
                if (useApplyEndpoint) {
                    const request: SpecApplyRequest = {
                        files,
                        mode,
                        ...(opts.expectedHash !== undefined ? { expected_hash: opts.expectedHash } : {}),
                        ...(opts.force ? { force: true } : {}),
                        gating: {
                            ...(opts.requireNoBreaking ? { reject_breaking_changes: true } : {}),
                            ...(opts.maxChanges !== undefined
                                ? { max_changes: parseIntegerOption(opts.maxChanges, '--max-changes') }
                                : {}),
                        },
                    };
                    const response = await client.contract.spec.apply(request);
                    printOutput(response, format);
                } else {
                    const response = await client.contract.spec.publish({
                        files,
                        mode,
                        ...(opts.expectedHash !== undefined ? { expected_hash: opts.expectedHash } : {}),
                        ...(opts.force ? { force: true } : {}),
                    });
                    printOutput(response, format);
                }
            } catch (err) {
                handleCommandError(err);
            }
        });

    // ──────────────────────────────────────────────────────────────────
    // diff
    // ──────────────────────────────────────────────────────────────────
    contractsCmd
        .command('diff <file>')
        .description('Diff a local YAML spec against the deployed one (POST /contract/spec/diff)')
        .option('-f, --format <format>', 'Output format: markdown | json', 'markdown')
        .option('--hash-only', 'Print only the proposed canonical hash and exit')
        .action(async (file: string, opts: { format: string; hashOnly?: boolean }) => {
            try {
                const yaml = fs.readFileSync(file, 'utf-8');
                const client = createClient();

                if (opts.hashOnly) {
                    const diff = await client.contract.spec.diff({ proposed_spec: yaml });
                    printStdout(diff.proposed.hash);
                    return;
                }

                const diff = await client.contract.spec.diff({ proposed_spec: yaml });

                if (opts.format === 'json') {
                    printOutput(diff, 'json');
                } else {
                    printStdout(renderDiffMarkdown(diff));
                }

                // Git-diff convention: exit 1 on differences, 0 on no changes.
                if (diff.changes.length > 0) {
                    process.exitCode = 1;
                }
            } catch (err) {
                handleCommandError(err);
            }
        });

    // ──────────────────────────────────────────────────────────────────
    // snapshot
    // ──────────────────────────────────────────────────────────────────
    contractsCmd
        .command('snapshot')
        .description('Print the deployed spec snapshot (GET /contract/spec/snapshot)')
        .option('-f, --format <format>', 'Output format', 'json')
        .option('-o, --output <file>', 'Write to file instead of stdout')
        .option('--locale <code>', LOCALE_HELP)
        .action(async (opts: { format: string; output?: string; locale?: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const snapshot = locale
                    ? await client.contract.spec.snapshot.get({ locale })
                    : await client.contract.spec.snapshot.get();
                if (opts.output) {
                    const text = format === 'yaml'
                        ? yamlStringify(snapshot)
                        : JSON.stringify(snapshot, null, 2);
                    fs.writeFileSync(opts.output, text, 'utf-8');
                    printStdout(`Wrote snapshot to ${opts.output}`);
                } else {
                    printOutput(snapshot, format);
                }
            } catch (err) {
                handleCommandError(err);
            }
        });

    // ──────────────────────────────────────────────────────────────────
    // dry-run
    // ──────────────────────────────────────────────────────────────────
    contractsCmd
        .command('dry-run <file>')
        .description('Quantify operational impact of a proposed spec against historical traces')
        .option('--replay-window <window>', 'Window to replay (e.g. "30d", "7d"). Max 90 days.', '30d')
        .option('--from <iso>', 'Replay window start (ISO-8601). Overrides --replay-window when given with --to.')
        .option('--to <iso>', 'Replay window end (ISO-8601). Overrides --replay-window when given with --from.')
        .option('--filter-flow <flow>', 'Restrict replay to traces in a specific flow')
        .option('--filter-user <user>', 'Restrict replay to traces owned by a specific user')
        .option('-f, --format <format>', 'Output format (when not watching): json | markdown', 'markdown')
        .option('--watch', 'Poll the report status until completion (default: print report id and exit)', false)
        .option('--poll-interval <seconds>', 'Polling interval when --watch is set', '5')
        .action(async (file: string, opts: {
            replayWindow: string;
            from?: string;
            to?: string;
            filterFlow?: string;
            filterUser?: string;
            format: string;
            watch?: boolean;
            pollInterval: string;
        }) => {
            try {
                const yaml = fs.readFileSync(file, 'utf-8');
                const window = resolveReplayWindow(opts.replayWindow, opts.from, opts.to);

                const request: SpecDryRunSubmitRequest = {
                    proposed_spec: yaml,
                    replay_window: window,
                    ...(opts.filterFlow !== undefined || opts.filterUser !== undefined
                        ? {
                            filter: {
                                ...(opts.filterFlow !== undefined ? { flow: opts.filterFlow } : {}),
                                ...(opts.filterUser !== undefined ? { user: opts.filterUser } : {}),
                            },
                        }
                        : {}),
                };

                const client = createClient();
                const submitResp = await client.contract.spec.dryRun.submit(request);

                if (!opts.watch) {
                    printStdout(JSON.stringify({ report_id: submitResp.report_id, status: submitResp.status }, null, 2));
                    return;
                }

                const intervalMs = parseIntegerOption(opts.pollInterval, '--poll-interval') * 1000;
                const final = await pollUntilTerminal(client, submitResp.report_id, intervalMs);
                renderDryRunResult(final, opts.format === 'json' ? 'json' : 'markdown');
                if (final.status === 'failed') process.exitCode = 1;
            } catch (err) {
                handleCommandError(err);
            }
        });

    contractsCmd
        .command('dry-run-report <report_id>')
        .description('One-shot poll of a dry-run report')
        .option('-f, --format <format>', 'Output format: json | markdown', 'markdown')
        .action(async (reportId: string, opts: { format: string }) => {
            try {
                const client = createClient();
                const report = await client.contract.spec.dryRun.get(reportId);
                renderDryRunResult(report, opts.format === 'json' ? 'json' : 'markdown');
            } catch (err) {
                handleCommandError(err);
            }
        });

    contractsCmd
        .command('dry-run-cancel <report_id>')
        .description('Cancel a queued or running dry-run job')
        .action(async (reportId: string) => {
            try {
                const client = createClient();
                await client.contract.spec.dryRun.cancel(reportId);
                printStdout(`[zarel] Cancelled dry-run ${reportId}.`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}

function parseApplyMode(raw: string): SpecApplyMode {
    if (raw !== 'upsert' && raw !== 'replace') {
        throw new Error(`Unknown --mode value: ${raw}. Expected 'upsert' or 'replace'.`);
    }
    return raw;
}

/**
 * Minimal markdown rendering for `zarel contract spec diff`. Mirrors the
 * default output format produced by the runtime contract package's
 * `renderMarkdown` so operators get a consistent CLI / API rendering.
 */
function renderDiffMarkdown(diff: SpecDiff): string {
    const lines: string[] = [];
    lines.push(`# Spec diff — ${diff.tenant} (${diff.current.version} → ${diff.proposed.version})`);
    lines.push('');
    lines.push(`Current deployed: ${diff.current.version} (${diff.current.hash.slice(0, 12)}...)`);
    lines.push(`Local file: ${diff.proposed.version} (${diff.proposed.hash.slice(0, 12)}...)`);
    lines.push('');

    if (diff.changes.length === 0) {
        lines.push('No structural changes.');
        return lines.join('\n');
    }

    const bySection = new Map<string, typeof diff.changes>();
    for (const c of diff.changes) {
        const arr = (bySection.get(c.section) ?? []) as typeof diff.changes;
        bySection.set(c.section, [...arr, c]);
    }

    for (const [section, changes] of bySection) {
        lines.push(`## ${section.charAt(0).toUpperCase() + section.slice(1)}`);
        for (const c of changes) {
            const kindMark = c.kind === 'added' ? '+' : c.kind === 'removed' ? '-' : '~';
            const impactBadge = c.impact_class === 'breaking' ? '**BREAKING**'
                : c.impact_class === 'behavioural' ? '**behavioural**' : '_additive_';
            lines.push(`- ${kindMark} \`${c.path}\` ${impactBadge} — ${c.human_summary}`);
        }
        lines.push('');
    }

    lines.push('## Policy impact');
    lines.push('');
    if (diff.impact_summary.flows_affected.length > 0) {
        lines.push(`- Flows affected: ${diff.impact_summary.flows_affected.join(', ')}`);
    }
    if (diff.impact_summary.roles_affected.length > 0) {
        lines.push(`- Roles affected: ${diff.impact_summary.roles_affected.join(', ')}`);
    }
    if (diff.impact_summary.has_breaking_changes) {
        lines.push('- Contains **BREAKING** changes.');
    }
    if (diff.impact_summary.may_reject_previously_allowed) {
        lines.push('- May reject inputs previously allowed.');
    }
    if (diff.impact_summary.may_require_hitl_previously_not) {
        lines.push('- May require HITL approval where previously none was needed.');
    }
    if (diff.impact_summary.recommended_reviewers.length > 0) {
        lines.push(`- Recommended reviewers: ${diff.impact_summary.recommended_reviewers.join(', ')}.`);
    }

    return lines.join('\n');
}

// ============================================================================
// Dry-run helpers
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_DRY_RUN_DAYS = 90;

function resolveReplayWindow(window: string, from?: string, to?: string): SpecDryRunReplayWindow {
    if (from && to) {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
            throw new Error('--from / --to must be valid ISO-8601 timestamps.');
        }
        if (toDate <= fromDate) {
            throw new Error('--to must be strictly greater than --from.');
        }
        return { from: fromDate.toISOString(), to: toDate.toISOString() };
    }
    const days = parseDurationDays(window);
    if (days > MAX_DRY_RUN_DAYS) {
        throw new Error(dryRunMessages.errors.windowTooLarge);
    }
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - days * MS_PER_DAY);
    return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

function parseDurationDays(input: string): number {
    const match = /^(\d+)d$/.exec(input.trim());
    if (!match) {
        throw new Error(`--replay-window must be of the form "<n>d" (e.g. "30d"). Got: ${input}.`);
    }
    return parseInt(match[1] as string, 10);
}

async function pollUntilTerminal(
    client: ReturnType<typeof createClient>,
    reportId: string,
    intervalMs: number,
): Promise<SpecDryRunJob> {
    const terminal = new Set(['completed', 'failed', 'cancelled']);
    let last: SpecDryRunJob | null = null;
    while (true) {
        const job = await client.contract.spec.dryRun.get(reportId);
        if (job.status !== last?.status || job.progress?.traces_processed !== last?.progress?.traces_processed) {
            const summary = renderProgressLine(job);
            printStderr(summary);
        }
        if (terminal.has(job.status)) return job;
        last = job;
        await sleep(intervalMs);
    }
}

function renderProgressLine(job: SpecDryRunJob): string {
    if (job.status === 'queued') return `[${job.report_id}] ${dryRunMessages.progress.queued}`;
    if (job.status === 'running') {
        return `[${job.report_id}] ${dryRunMessages.progress.running(
            job.progress?.traces_processed ?? 0,
            job.progress?.traces_total ?? null,
        )}`;
    }
    if (job.status === 'completed') return `[${job.report_id}] ${dryRunMessages.progress.completed}`;
    if (job.status === 'failed') {
        return `[${job.report_id}] ${dryRunMessages.progress.failed(job.failure?.message ?? job.failure?.code ?? 'unknown')}`;
    }
    return `[${job.report_id}] ${dryRunMessages.progress.cancelled}`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderDryRunResult(job: SpecDryRunJob, format: 'json' | 'markdown'): void {
    if (format === 'json') {
        printStdout(JSON.stringify(job, null, 2));
        return;
    }
    if (job.status !== 'completed' || !job.result) {
        // No report yet — print the job envelope.
        printStdout(JSON.stringify(job, null, 2));
        return;
    }

    const r = job.result;
    const lines: string[] = [];
    const fromDate = new Date(r.replay_window.from);
    const toDate = new Date(r.replay_window.to);
    const windowDays = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY));

    lines.push(`# ${dryRunMessages.headerLine(r.tenant, windowDays)}`);
    lines.push('');
    lines.push(dryRunMessages.summaryHeading);
    lines.push('');
    const total = r.sessions_evaluated;
    const pct = (n: number): number => total === 0 ? 0 : (n / total) * 100;
    lines.push(`- Sessions evaluated: ${r.sessions_evaluated}`);
    lines.push(`- ${dryRunMessages.outcomesUnchanged(r.outcomes_unchanged, pct(r.outcomes_unchanged))}`);
    lines.push(`- ${dryRunMessages.outcomesChanged(r.outcomes_changed, pct(r.outcomes_changed))}`);
    lines.push('');

    lines.push(dryRunMessages.breakdownHeading);
    if (r.change_breakdown.length === 0) {
        lines.push('_(none)_');
    } else {
        lines.push('| from | to | count | cause | example trace ids |');
        lines.push('|---|---|---|---|---|');
        for (const c of r.change_breakdown) {
            lines.push(`| ${c.from_outcome} | ${c.to_outcome} | ${c.count} | ${c.cause.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${c.example_trace_ids.join(', ')} |`);
        }
    }
    lines.push('');

    lines.push(dryRunMessages.affectedUsersHeading);
    if (r.affected_users.length === 0) {
        lines.push('_(none)_');
    } else {
        lines.push('| user | sessions affected |');
        lines.push('|---|---|');
        for (const u of r.affected_users) {
            lines.push(`| ${u.user_name} | ${u.sessions_affected} |`);
        }
    }
    lines.push('');

    if (r.unknowns.length > 0) {
        const unknownsTotal = r.unknowns.reduce((s, u) => s + u.count, 0);
        lines.push(dryRunMessages.unknownsHeading);
        lines.push(dryRunMessages.unknownsExplain(unknownsTotal));
        lines.push('');
        lines.push('| cause | count | example trace ids |');
        lines.push('|---|---|---|');
        for (const u of r.unknowns) {
            lines.push(`| ${u.cause} | ${u.count} | ${u.example_trace_ids.join(', ')} |`);
        }
        lines.push('');
    }

    lines.push(dryRunMessages.operationalImplicationsHeading);
    lines.push(dryRunMessages.hitlPerMonth(r.operational_implications.estimated_additional_hitl_per_month));
    lines.push(dryRunMessages.requiredRoles(r.operational_implications.required_roles));

    printStdout(lines.join('\n'));
}
