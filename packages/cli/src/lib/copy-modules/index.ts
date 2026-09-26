// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * Copy-module skeleton.
 *
 * English-default user-facing strings emitted by the CLI for the new
 * trace / contracts / dry-run / bundle surfaces. Mirrors the
 * `@zarel-ai/components` convention: each module is a flat object whose keys
 * are the message identifiers; consumers can override per-key without forking
 * the module. v1 ships English only — Spanish / other-locale translations are
 * a purely additive future capability and MUST NOT be bundled into the public
 * `zarel` CLI without an explicit cross-package spec.
 *
 * No string literal in `src/commands/**` should bypass these
 * modules. The fitness test at
 * `tests/fitness/no-hardcoded-user-text.test.ts` locks
 * the invariant.
 */

export { traceMessages } from './trace-messages';
export type { TraceMessages } from './trace-messages';

export { contractsMessages } from './contracts-messages';
export type { ContractsMessages } from './contracts-messages';

export { dryRunMessages } from './dry-run-messages';
export type { DryRunMessages } from './dry-run-messages';

export { bundleMessages } from './bundle-messages';
export type { BundleMessages } from './bundle-messages';
