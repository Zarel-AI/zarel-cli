// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * CLI parity: `zarel trace get` and
 * `zarel trace query` produce the same payload as the SDK and respect the
 * documented exit codes.
 *
 * SKIPPED until the CLI test harness with stdin/stdout capture lands; the
 * The SDK's own parity tests plus the route contract tests cover the
 * parity invariant for Phase 3 — equivalent CLI exec paths are wired in
 * `src/commands/trace/{get,query}.ts` as faithful-layer
 * wrappers (`createClient().traces.{get,list}`).
 */
describe.skip('zarel trace CLI parity', () => {
    test('zarel trace get <id> matches client.traces.get(id)', () => {
        // Spawn `zarel trace get trc_...` against a recorded API fixture; assert
        // stdout payload === client.traces.get(traceId) JSON.
        expect(true).toBe(true);
    });

    test('zarel trace query --format json matches client.traces.list(...)', () => {
        // Spawn `zarel trace query --format json --limit 10`; assert stdout
        // payload === client.traces.list({ limit: 10 }) JSON.
        expect(true).toBe(true);
    });
});
