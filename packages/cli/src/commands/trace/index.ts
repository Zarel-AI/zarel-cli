// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerTraceGetCommand } from './get';
import { registerTraceQueryCommand } from './query';
import { registerTraceReplayCommand } from './replay';
import { registerTraceBundleCommand } from './bundle';

/**
 * `zarel trace ...` — trace observability + replay + bundle.
 *
 * Subcommands:
 *   - `zarel trace get <trace_id>`           → full chronology of one dispatch
 *   - `zarel trace query [filters]`          → paginated list with filters
 *   - `zarel trace replay <trace_id>`        → re-evaluate against current/proposed spec
 *   - `zarel trace bundle <trace_id>`        → download signed evidence bundle
 */
export function registerTraceCommands(program: Command): void {
    const traceCmd = program
        .command('trace')
        .description('Reconstruct, query, replay, and bundle agent traces');

    registerTraceGetCommand(traceCmd);
    registerTraceQueryCommand(traceCmd);
    registerTraceReplayCommand(traceCmd);
    registerTraceBundleCommand(traceCmd);
}
