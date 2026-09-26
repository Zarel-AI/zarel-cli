// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * `zarel verify` over an audit-evidence bundle. Each case reads a bundle a
 * real signer PRODUCED, then checks what the verifier says about it:
 *   - a clean bundle with no checkpoint → RED (self-consistent is not authentic);
 *   - a tampered event (content edited, manifest re-signed so integrity passes)
 *     → RED at the exact seq with `event_hash_mismatch`;
 *   - a deleted event → `seq_gap`;
 *   - a chain anchored by a signed checkpoint → GREEN;
 *   - and the key-validity window around that checkpoint's `signed_at`.
 *
 * THE BUNDLES ARE FIXTURES, AND THAT IS THE POINT. Producing an evidence bundle takes the
 * signer that writes the evidence in the first place; verifying one takes nothing but this
 * package. That asymmetry is the whole claim the verifier makes, so the tests are built to
 * respect it: the bundles were produced upstream by the real producer, committed here, and
 * are only ever READ. `fixtures/bundles/index.json` says what each one is.
 *
 * The alternative — a signer written inside the test — would check the verifier against a
 * second implementation of the thing under test, which is worth less than checking it against
 * bytes that were really signed.
 *
 * What is NOT a fixture is the trust-keys manifest's validity window. Editing
 * `valid_from` / `valid_until` / `revoked_at` is a JSON edit that needs no signer, so it stays
 * here, next to the assertion it explains. The fixtures can be reproduced at any time; nothing
 * below asserts on their bytes, only on the verdict about them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAuditBundle } from '../src/lib/audit-bundle-verifier';

const FIXTURES = join(__dirname, 'fixtures', 'bundles');

interface FixtureCase {
    describes: string;
    archive: string;
    trustKeys: { schema_version: string; keys: Array<Record<string, unknown>> };
}
const INDEX = JSON.parse(readFileSync(join(FIXTURES, 'index.json'), 'utf8')) as Record<string, FixtureCase>;

function caseOf(name: string): FixtureCase {
    const c = INDEX[name];
    if (!c) {
        throw new Error(`no bundle fixture named '${name}' in fixtures/bundles/index.json.`);
    }
    return c;
}

/** The archive bytes a real signer produced for `name`. */
const bundleOf = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, caseOf(name).archive)));

/** The case's trust-keys manifest, with an optional validity window laid over its single key. */
function trustKeysOf(
    name: string,
    window: { valid_from?: string; valid_until?: string | null; revoked_at?: string | null } = {},
): unknown {
    const base = caseOf(name).trustKeys;
    return { ...base, keys: [{ ...base.keys[0]!, ...window }] };
}

const verify = async (name: string, window = {}): ReturnType<typeof verifyAuditBundle> => await verifyAuditBundle({
    bundleBytes: bundleOf(name),
    trustKeysManifest: trustKeysOf(name, window),
    revocationPolicy: 'lenient',
});

describe('zarel verify — audit bundle', () => {
    it('rejects a clean but UNATTESTED chain (no checkpoint) → RED', async () => {
        // A well-formed, internally-consistent chain with NO signed checkpoint has
        // no cryptographic anchor. The manifest signature (integrity) still passes,
        // but the chain verdict must NOT be ok — self-consistency ≠ authenticity.
        const res = await verify('clean-5');
        expect(res.isAuditBundle).toBe(true);
        expect(res.integrity.ok).toBe(true);
        expect(res.verdict?.ok).toBe(false);
        expect(res.verdict?.coveredRange).toEqual({ from: 1, to: 5 });
        expect(res.verdict?.failures.some((f) => f.reason === 'no_verified_checkpoint')).toBe(true);
    });

    // The archive root is the FIRST segment of the first entry that has one, not everything before
    // that entry's last `/`. Here the first entry sits one directory below the root, so a root read
    // any other way finds no manifest.
    it('finds the bundle root when the first entry is nested one directory below it', async () => {
        const res = await verify('nested-root');
        expect(res.isAuditBundle).toBe(true);
        expect(res.integrity.ok).toBe(true);
        expect(res.verdict?.coveredRange).toEqual({ from: 1, to: 5 });
    });

    it('detects a tampered event at the exact seq (integrity still passes)', async () => {
        // seq 3's content was edited and its stored event_hash left alone, and the manifest was
        // re-signed over the tampered events.json — so the integrity (content-hash) check passes
        // and the chain check is the only thing that can catch it.
        const res = await verify('tampered-event');
        expect(res.integrity.ok).toBe(true);
        expect(res.verdict?.ok).toBe(false);
        expect(res.verdict?.failures.some((f) => f.seq === 3 && f.reason === 'event_hash_mismatch')).toBe(true);
    });

    it('detects a deleted event as a seq gap', async () => {
        const res = await verify('seq-gap');
        expect(res.verdict?.ok).toBe(false);
        expect(res.verdict?.failures.some((f) => f.seq === 4 && f.reason === 'seq_gap')).toBe(true);
    });

    // An archive may carry entries the manifest does not cover; nothing rejects them, and nothing
    // needs to. What must not happen is a VERDICT about them. Reading the chain by basename found
    // whichever `events.json` came first in the archive, so an unsigned `x/events.json` placed
    // ahead of the signed one supplied the chain the report then described — with
    // `integrity.ok === true`, because integrity had checked the root copy it never read.
    // The two now read the same file: the one at the archive root that the manifest names.
    it('ignores an unsigned events.json shadowing the signed one, and reports the signed chain', async () => {
        const res = await verify('shadowed-events');
        expect(res.integrity.ok).toBe(true);
        expect(res.isAuditBundle).toBe(true);
        // The shadow holds two events; the signed chain holds five.
        expect(res.verdict?.coveredRange).toEqual({ from: 1, to: 5 });
    });

    it('verifies a chain anchored by a signed checkpoint → GREEN', async () => {
        const res = await verify('checkpointed-4');
        expect(res.verdict?.ok).toBe(true);
        expect(res.verdict?.checkpointsVerified).toBe(1);
    });
});

// The manifest's validity window must flow through toTrustKeys()
// into verifyChain. `checkpointed-4`'s checkpoint is signed at 2026-06-14T01:00:00Z;
// each case varies the trust-key window around that instant.
describe('zarel verify — kid validity window passthrough', () => {
    it('revoked archived kid (revoked_at before signed_at) fails the bundle with kid_revoked', async () => {
        const res = await verify('checkpointed-4', { revoked_at: '2026-06-14T00:00:00.000Z' });
        expect(res.verdict?.ok).toBe(false);
        expect(res.verdict?.failures.some((f) => f.seq === 4 && f.reason === 'kid_revoked')).toBe(true);
    });

    it('expired kid (valid_until before signed_at) fails the bundle with kid_expired', async () => {
        const res = await verify('checkpointed-4', { valid_until: '2026-06-14T00:30:00.000Z' });
        expect(res.verdict?.ok).toBe(false);
        expect(res.verdict?.failures.some((f) => f.seq === 4 && f.reason === 'kid_expired')).toBe(true);
    });

    it('archived kid within window (valid_until after signed_at) still verifies → GREEN', async () => {
        const res = await verify('checkpointed-4', {
            valid_from: '2026-06-01T00:00:00.000Z',
            valid_until: '2026-06-20T00:00:00.000Z',
            revoked_at: null,
        });
        expect(res.verdict?.ok).toBe(true);
        expect(res.verdict?.checkpointsVerified).toBe(1);
    });

    // The manifest-signature verifier also enforces
    // valid_from / valid_until (it already enforced revoked_at). manifest.sig's
    // signed_at is stamped when the fixture was produced, so a far-past valid_until is
    // unambiguously expired and a far-future valid_from is not-yet-valid, whenever that was.
    it('manifest.sig integrity fails kid_expired when the key validity ended before signing', async () => {
        const res = await verify('clean-3', { valid_until: '2020-01-01T00:00:00.000Z' });
        expect(res.integrity.ok).toBe(false);
        if (!res.integrity.ok) {
            expect(res.integrity.code).toBe('kid_expired');
        }
    });

    it('manifest.sig integrity fails kid_not_yet_valid when the key was not valid at signing', async () => {
        const res = await verify('clean-3', { valid_from: '2099-01-01T00:00:00.000Z' });
        expect(res.integrity.ok).toBe(false);
        if (!res.integrity.ok) {
            expect(res.integrity.code).toBe('kid_not_yet_valid');
        }
    });
});
