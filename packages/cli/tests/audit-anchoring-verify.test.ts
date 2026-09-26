// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * The offline anchoring verifier and its honest-label output.
 *
 * Uses a committed fixture (a REAL mock-TSA token over the checkpoints' Merkle
 * root + the pinned CA). Asserts: a valid bundle verifies with the pinned root;
 * each tamper (token / path / root) fails closed; missing roots → not-verified
 * (never silently anchored); the structured report separates anchored-range from
 * un-anchored-tail; and the rendered output NEVER uses revocation/long-term
 * vocabulary (v1 = offline temporal precedence TODAY).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleEvidenceRecord, encodeEvidenceRecord } from '@zarel-ai/audit-tsa';
import {
    verifyAnchoring,
    renderAnchoring,
    verifyAuditBundle,
    composeLtvBound,
    type AnchorsJson,
    type CheckpointJson,
    type AnchoringOutcome,
} from '../src/lib/audit-bundle-verifier';

const FIX = join(__dirname, 'fixtures', 'anchored');
const anchors = (): AnchorsJson => JSON.parse(readFileSync(join(FIX, 'anchors.json'), 'utf8')) as AnchorsJson;
const checkpoints = (): CheckpointJson[] => JSON.parse(readFileSync(join(FIX, 'checkpoints.json'), 'utf8')) as CheckpointJson[];

function pinnedRoots(): Uint8Array[] {
    const pem = readFileSync(join(FIX, 'tsa-roots.pem'), 'utf8');
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    return blocks.map((b) => new Uint8Array(Buffer.from(b.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''), 'base64')));
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const FORBIDDEN = ['revocation', 'revoked', 'ocsp', 'crl', 'valid for years', 'long-term'];

describe('anchoring verification', () => {
    it('a valid bundle verifies against the pinned root', () => {
        const out = verifyAnchoring(anchors(), checkpoints(), pinnedRoots(), 'lenient');
        expect(out.status).toBe('verified');
        expect(out.report).not.toBeNull();
        expect(out.report?.anchoredRange).toEqual({ from: 1, to: 2 });
        expect(out.report?.attestations).toHaveLength(1);
        expect(out.report?.attestations[0]?.genTime).toBe('2026-06-14T13:00:05.000Z');
        expect(out.report?.unanchoredTail).toBeNull(); // both checkpoints anchored
        expect(out.report?.freshnessBound).toContain('2026-06-14T13:00:05.000Z');
        // Honest decomposition (do not regress to a bare unconditional "anti-rewrite"):
        // anti-backdating is asserted; rewrite is labelled CONDITIONAL on a prior anchor.
        expect(out.report?.freshnessBound).toContain('anti-backdating');
        expect(out.report?.freshnessBound).toContain('prior anchor');
    });

    it('omitted pinned roots → not_verified_no_roots (never silently anchored)', () => {
        const out = verifyAnchoring(anchors(), checkpoints(), [], 'lenient');
        expect(out.status).toBe('not_verified_no_roots');
        expect(out.report).toBeNull();
    });

    it('a later un-anchored checkpoint is reported as the un-anchored tail', () => {
        const cps = checkpoints();
        cps.push({
            tenant_name: 'demo_tenant', log_name: 'state_machine', seq: 3,
            head_hash: 'x', prev_checkpoint_hash: null, checkpoint_hash: 'unanchored_cp_hash',
            window_id: '2026061414', kid: 'k1', signature_b64: 'sig', signed_at: '2026-06-14T14:00:00.000Z',
        });
        const out = verifyAnchoring(anchors(), cps, pinnedRoots(), 'lenient');
        expect(out.status).toBe('verified');
        expect(out.report?.anchoredRange).toEqual({ from: 1, to: 2 });
        expect(out.report?.unanchoredTail).toEqual({ from: 3, to: 3 });
    });

    it('tampered TSA token → failed', () => {
        const a = clone(anchors());
        const wa = a.window_anchors?.[0];
        if (!wa) throw new Error('fixture missing window anchor');
        const tok = wa.tsa_token_b64;
        const at80 = tok[80];
        wa.tsa_token_b64 = `${tok.slice(0, 80)}${at80 === 'A' ? 'B' : 'A'}${tok.slice(81)}`;
        expect(verifyAnchoring(a, checkpoints(), pinnedRoots(), 'lenient').status).toBe('failed');
    });

    it('tampered inclusion path → failed', () => {
        const a = clone(anchors());
        const node = a.inclusions?.[0]?.path[0];
        if (!node) throw new Error('fixture missing inclusion path');
        node.hash_b64 = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url');
        expect(verifyAnchoring(a, checkpoints(), pinnedRoots(), 'lenient').status).toBe('failed');
    });

    it('tampered anchored root → failed (path no longer rebuilds it)', () => {
        const a = clone(anchors());
        const wa = a.window_anchors?.[0];
        if (!wa) throw new Error('fixture missing window anchor');
        wa.merkle_root_b64 = Buffer.from(new Uint8Array(32).fill(9)).toString('base64url');
        expect(verifyAnchoring(a, checkpoints(), pinnedRoots(), 'lenient').status).toBe('failed');
    });

    it('a non-pinned root → failed (chain does not terminate at a trusted anchor)', () => {
        const strangerRoot = [new Uint8Array(Buffer.from('not a real cert'))];
        expect(verifyAnchoring(anchors(), checkpoints(), strangerRoot, 'lenient').status).toBe('failed');
    });

    it('QI: an absent merkle_scheme → failed (no path trusted for an unlabelled tree)', () => {
        const a = clone(anchors());
        delete a.merkle_scheme;
        expect(verifyAnchoring(a, checkpoints(), pinnedRoots(), 'lenient').status).toBe('failed');
    });

    it('QI: an unrecognised merkle_scheme → failed (built under a different construction)', () => {
        const a = clone(anchors());
        a.merkle_scheme = 'legacy-concat-sha256';
        expect(verifyAnchoring(a, checkpoints(), pinnedRoots(), 'lenient').status).toBe('failed');
    });
});

describe('end to end — a full bundle through verifyAuditBundle', () => {
    // The bundle is a FIXTURE: a real signer packed this directory's committed checkpoints and
    // anchors into an archive, upstream, and it is only ever READ here. Producing an evidence
    // bundle takes the signer that writes the evidence; verifying one takes nothing but this
    // package, which is the claim these cases exist to check. The trust-keys manifest stays
    // empty — anchoring does not consult it.
    const BUNDLES = join(__dirname, 'fixtures', 'bundles');
    const anchoredBundle = (): Uint8Array => {
        const index = JSON.parse(readFileSync(join(BUNDLES, 'index.json'), 'utf8')) as Record<string, { archive: string }>;
        const entry = index['anchored-e2e'];
        if (!entry) {
            throw new Error('no bundle fixture named `anchored-e2e` in fixtures/bundles/index.json.');
        }
        return new Uint8Array(readFileSync(join(BUNDLES, entry.archive)));
    };

    it('extracts anchors.json from the tar and reports anchored + freshness with --tsa-roots', async () => {
        const result = await verifyAuditBundle({ bundleBytes: anchoredBundle(), trustKeysManifest: { keys: [] }, pinnedTsaRoots: pinnedRoots(), revocationPolicy: 'lenient' });
        expect(result.isAuditBundle).toBe(true);
        expect(result.anchoring.status).toBe('verified');
        expect(result.anchoring.report?.anchoredRange).toEqual({ from: 1, to: 2 });
        expect(result.anchoring.report?.freshnessBound).toContain('2026-06-14T13:00:05.000Z');
    });

    it('without --tsa-roots the same bundle reports anchoring not-verified (chain path unchanged)', async () => {
        const result = await verifyAuditBundle({ bundleBytes: anchoredBundle(), trustKeysManifest: { keys: [] }, revocationPolicy: 'lenient' });
        expect(result.anchoring.status).toBe('not_verified_no_roots');
    });
});

describe('honest-label output — the vocabulary the report may not use', () => {
    const verified = verifyAnchoring(anchors(), checkpoints(), pinnedRoots(), 'lenient');
    const outcomes: AnchoringOutcome[] = [
        { status: 'none', report: null },
        { status: 'not_verified_no_roots', report: null },
        verified,
        { status: 'failed', report: null, failure: 'inclusion path failed for checkpoint seq 2' },
    ];

    it('never uses revocation / OCSP / CRL / long-term vocabulary', () => {
        for (const outcome of outcomes) {
            const { stdout, stderr } = renderAnchoring(outcome);
            const text = [...stdout, ...stderr].join('\n').toLowerCase();
            for (const phrase of FORBIDDEN) {
                expect(text).not.toContain(phrase);
            }
        }
    });

    it('the verified report carries anchoredRange, unanchoredTail and a freshnessBound structurally', () => {
        expect(verified.report).toMatchObject({
            anchoredRange: expect.any(Object),
            attestations: expect.any(Array),
            freshnessBound: expect.any(String),
        });
        expect('unanchoredTail' in (verified.report ?? {})).toBe(true);
    });

    it('failed anchoring signals a non-zero exit (ok=false)', () => {
        expect(renderAnchoring({ status: 'failed', report: null, failure: 'x' }).ok).toBe(false);
        expect(renderAnchoring(verified).ok).toBe(true);
    });
});

// ─────────────────────── renewal (LTV) verification + honest label ───────────────────────
describe('renewal chain verification + conditional LTV label', () => {
    const anchorToken = (): Buffer => Buffer.from(anchors().window_anchors![0]!.tsa_token_b64, 'base64');
    const windowId = (): string => anchors().window_anchors![0]!.window_id;
    // `now` within the fixture TSA cert validity (default mock-TSA notAfter 2030-01-01).
    const NOW = new Date('2026-06-14T14:00:00.000Z');
    // G2.5 over-claim guard — 'long-term' is LEGITIMATE here (RFC 4998 IS long-term),
    // so it is NOT forbidden; the absolute/coverage over-claims are.
    const OVERCLAIM = ['forever', 'tamper-proof', 'permanent', 'valid for years', 'revocation', 'revoked', 'ocsp', 'crl', 'non-repudiation'];

    function withEvidenceRecord(): AnchorsJson {
        const record = assembleEvidenceRecord({ anchorTokenDer: new Uint8Array(anchorToken()), renewals: [] });
        const erB64 = Buffer.from(encodeEvidenceRecord(record)).toString('base64');
        return { ...anchors(), evidence_records: [{ window_id: windowId(), evidence_record_b64: erB64 }] };
    }

    it('composeLtvBound emits the CONDITIONAL label for a real renewal (depth ≥ 2)', () => {
        // The verdict→label generation, gated directly (a depth-2 record needs a TSA to
        // mint the renewal token — covered end-to-end in audit-tsa renew-verify.test.ts;
        // here we gate the honest wording the CLI emits from it).
        const ltv = composeLtvBound(2, '2030-01-01T00:00:00.000Z', 0, NOW.toISOString()) ?? '';
        expect(ltv).toContain('long-term validity');
        expect(ltv).toContain('operator-maintained');
        expect(ltv).toContain('unrecoverable');
        expect(ltv).toContain('certificate-status and non-equivocation remain out of its scope');
        for (const phrase of OVERCLAIM) {
            expect(ltv.toLowerCase()).not.toContain(phrase);
        }
    });

    it('composeLtvBound flags a LAPSED chain and is absent when nothing was renewed', () => {
        expect(composeLtvBound(0, '', 1, NOW.toISOString()) ?? '').toContain('LAPSED');
        expect(composeLtvBound(0, '', 0, NOW.toISOString())).toBeUndefined(); // no renewals ⇒ no LTV claim
    });

    it('CR-3: an anchor-only record (never renewed) makes NO false LTV claim', () => {
        // A depth-1 EvidenceRecord (e.g. emitted by G2.6 for revocation on a never-renewed
        // window) must NOT be reported as "re-timestamped through a renewal chain".
        const out = verifyAnchoring(withEvidenceRecord(), checkpoints(), pinnedRoots(), 'lenient', NOW);
        expect(out.status).toBe('verified');
        expect(out.report?.renewals ?? []).toHaveLength(0);
        expect(out.report?.ltvBound).toBeUndefined();
    });

    it('fail-closed: a malformed (tampered) EvidenceRecord fails the whole anchoring', () => {
        const bad: AnchorsJson = { ...anchors(), evidence_records: [{ window_id: windowId(), evidence_record_b64: Buffer.from([0x05, 0x00]).toString('base64') }] };
        const out = verifyAnchoring(bad, checkpoints(), pinnedRoots(), 'lenient', NOW);
        expect(out.status).toBe('failed');
    });

    it('an expired anchor record (cert lapsed, NOT tampered) does NOT fail the bundle — reverts to the G2 anchor', () => {
        // now past the fixture TSA cert notAfter (mock-TSA default 2030-01-01): the record
        // verifies with tsa_cert_expired (operational lapse, not a tamper). The bundle stays
        // verified and the window remains G2-anchored (per-window isolation).
        const NOW_LAPSED = new Date('2031-06-01T00:00:00.000Z');
        const out = verifyAnchoring(withEvidenceRecord(), checkpoints(), pinnedRoots(), 'lenient', NOW_LAPSED);
        expect(out.status).toBe('verified'); // NOT 'failed' — an expiry is not tampering
        expect((out.report?.attestations.length ?? 0)).toBeGreaterThan(0); // still G2-anchored
    });
});

// ─────────────────────── revocation verification + honest label ───────────────────────
describe('revocation verification + conditional revocation label', () => {
    function firstAnchor(): NonNullable<AnchorsJson['window_anchors']>[number] {
        const a = anchors().window_anchors?.[0];
        if (!a) {
            throw new Error('fixture has no window_anchors');
        }
        return a;
    }
    const anchorToken = (): Buffer => Buffer.from(firstAnchor().tsa_token_b64, 'base64');
    const windowId = (): string => firstAnchor().window_id;
    const NOW = new Date('2026-06-14T14:00:00.000Z');
    // G2.6 over-claims: revocation/ocsp/crl vocab is now LEGITIMATE; the ABSOLUTE
    // framings are forbidden.
    const REVOCATION_OVERCLAIM = ['can never be revoked', 'permanently valid', 'revocation-proof', 'forever', 'tamper-proof', 'non-repudiation'];

    // A structurally-valid DER blob that is NOT a BasicOCSPResponse → the offline
    // verifier rejects it (signature unparseable) → NOT_CAPTURED (honest degraded),
    // exercising the verifyAnchoring → revocationBound mapping without a CA key.
    const GARBAGE_OCSP = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]);

    function withRevocation(): AnchorsJson {
        const record = assembleEvidenceRecord({
            anchorTokenDer: new Uint8Array(anchorToken()),
            renewals: [],
            cryptoInfos: { crls: [], ocsps: [GARBAGE_OCSP] },
        });
        const erB64 = Buffer.from(encodeEvidenceRecord(record)).toString('base64');
        return { ...anchors(), evidence_records: [{ window_id: windowId(), evidence_record_b64: erB64 }] };
    }

    it('reports a conditional revocationBound; NOT_CAPTURED never renders as checked', () => {
        const out = verifyAnchoring(withRevocation(), checkpoints(), pinnedRoots(), 'lenient', NOW);
        expect(out.status).toBe('verified'); // an unverifiable proof is NOT a tamper
        const bound = out.report?.revocationBound ?? '';
        expect(bound).toContain('NOT CAPTURED'); // honest degraded, never "checked"
        expect(bound).toContain('0/1');
        expect(bound).toContain('NOT non-equivocation');
        expect(bound.toLowerCase()).toContain('certificate-status');
        // CR-3: an anchor-only revocation record must NOT also claim long-term validity.
        expect(out.report?.ltvBound).toBeUndefined();
    });

    it('the rendered revocation label carries no absolute over-claim', () => {
        const out = verifyAnchoring(withRevocation(), checkpoints(), pinnedRoots(), 'lenient', NOW);
        const text = renderAnchoring(out).stdout.join('\n').toLowerCase();
        expect(text).toContain('revocation'); // the legitimate G2.6 vocabulary IS present now
        for (const phrase of REVOCATION_OVERCLAIM) {
            expect(text).not.toContain(phrase);
        }
    });

    it('QI (strict): an uncaptured non-revocation proof fails the compliance policy; lenient tolerates the SAME bundle', () => {
        const strict = verifyAnchoring(withRevocation(), checkpoints(), pinnedRoots(), 'strict', NOW);
        // The anchor itself verified (per-window isolation) — the policy failure is per-window.
        expect(strict.status).toBe('verified');
        expect(strict.report?.uncapturedWindows).toEqual([windowId()]);
        const r = renderAnchoring(strict);
        expect(r.ok).toBe(false);
        expect(r.stderr.join('\n')).toContain('NOT CAPTURED under the strict policy');
        // The identical bundle under lenient is the honest-degraded (ok) view.
        const lenient = renderAnchoring(verifyAnchoring(withRevocation(), checkpoints(), pinnedRoots(), 'lenient', NOW));
        expect(lenient.ok).toBe(true);
    });

    it('a token revoked at use-time is a HARD failure (ok=false), not a lapse', () => {
        // The verdict→failure mapping is exercised in audit-tsa; here we gate the
        // render: a token_revoked outcome exits non-zero and names the cause.
        const out: AnchoringOutcome = { status: 'failed', report: null, failure: 'TSA signer certificate for window W was REVOKED at use-time (per captured OCSP/CRL)' };
        const r = renderAnchoring(out);
        expect(r.ok).toBe(false);
        expect(r.stderr.join('\n')).toContain('REVOKED at use-time');
    });
});
