// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * The transparency-log sibling verifier and its honest, floor-gated label.
 *
 * Builds a real (keyless-of-OS, reproducible) transparency_log: a log-signed C2SP
 * checkpoint over N window roots, witness cosignatures, a window inclusion path, and
 * a prev→latest consistency proof. Asserts: the non-equivocation label renders IFF
 * the witness floor holds (≥3 matched, ≥1 external, ≥1 EU/EEA); fail-closed on
 * a tampered proof or a forged cosignature; no policy ⇒ degrade to the anchor-only label;
 * and the overclaim guard: the forbidden vocabulary appears only when the floor is met.
 */

import { createPrivateKey, createPublicKey, sign as nodeSign, createHash, type KeyObject } from 'node:crypto';
import {
    buildMerkleTree,
    buildConsistencyProof,
    encodeCheckpointBody,
    assembleSignedNote,
    cosignatureMessage,
    type WitnessVerifierPolicy,
} from '@zarel-ai/audit-tsa';
import {
    verifyTransparencyLog,
    renderNonEquivocation,
    type TransparencyLogJson,
    type NonEquivocationOutcome,
} from '../src/lib/audit-bundle-verifier';

// ── deterministic Ed25519 (raw seed → keypair) ──
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
interface K { raw: Uint8Array; sign(m: Uint8Array): Uint8Array; priv: KeyObject }
function keyFromSeed(seed: number): K {
    const priv = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, seed)]), format: 'der', type: 'pkcs8' });
    const spki = createPublicKey(priv).export({ type: 'spki', format: 'der' });
    return { raw: new Uint8Array(spki.subarray(spki.length - 32)), sign: (m) => new Uint8Array(nodeSign(null, Buffer.from(m), priv)), priv };
}
const b64u = (u: Uint8Array): string => Buffer.from(u).toString('base64url');
const leafOf = (i: number): Uint8Array => new Uint8Array(createHash('sha256').update(`w-${i}`).digest());

const ORIGIN = 'zarel.audit.log';
const LOG = keyFromSeed(0xa0);
const LOG_KID = 'k_log';
const TS = 1_712_000_000n;

// witnesses
const W_EU = { k: keyFromSeed(0x01), name: 'w-eu', external: true, juris: 'DE' };
const W_US = { k: keyFromSeed(0x02), name: 'w-us', external: true, juris: 'US' };
const W_AR = { k: keyFromSeed(0x03), name: 'w-ar', external: false, juris: 'AR' };
const W_NO = { k: keyFromSeed(0x04), name: 'w-no', external: true, juris: 'NO' };
const ALL_W = [W_EU, W_US, W_AR, W_NO];

type W = typeof W_EU;

interface BuildOpts {
    cosigners?: W[];            // which witnesses cosign (default: EU+US+AR ⇒ floor met)
    policyWitnesses?: W[];      // policy membership (default: all four)
    threshold?: number;
    withConsistency?: boolean;  // default true (prev at size n-1)
    tamper?: 'consistency' | 'cosig' | 'origin' | 'bodyorigin' | 'prevsize' | 'note' | 'none';
    n?: number;
}

function build(opts: BuildOpts = {}): { tlog: TransparencyLogJson; windowRoots: Map<string, string>; logKeys: Map<string, Uint8Array>; policy: WitnessVerifierPolicy } {
    const n = opts.n ?? 4;
    const cosigners = opts.cosigners ?? [W_EU, W_US, W_AR];
    const policyW = opts.policyWitnesses ?? ALL_W;
    const leaves = Array.from({ length: n }, (_, i) => leafOf(i));
    const { root, paths } = buildMerkleTree(leaves);
    // 'origin' taints BOTH body origin + sig keyName (note-signature fails);
    // 'bodyorigin' taints ONLY the signed-body origin while the sig keyName stays the
    // policy origin (the note verifies, but the cosigned body's origin != policy).
    const bodyOrigin = opts.tamper === 'origin' || opts.tamper === 'bodyorigin' ? 'evil.log' : ORIGIN;
    const sigKeyName = opts.tamper === 'origin' ? 'evil.log' : ORIGIN;
    const body = encodeCheckpointBody({ origin: bodyOrigin, treeSize: BigInt(n), rootHash: root });
    let note = assembleSignedNote(body, sigKeyName, LOG.raw, LOG.sign(Buffer.from(body, 'utf8')));
    if (opts.tamper === 'note') note = note.replace(String(n), String(n + 7));

    const windowRoots = new Map<string, string>(leaves.map((l, i) => [`W${i}`, b64u(l)]));
    const windowInclusions = [{ window_id: 'W1', leaf_index: 1, path: paths[1]!.map((s) => ({ hash_b64: b64u(s.hash), side: s.side })) }];

    const cosignatures = cosigners.map((w) => {
        let sig = w.k.sign(cosignatureMessage(body, TS));
        if (opts.tamper === 'cosig' && w === cosigners[0]) sig = new Uint8Array(sig).map((x, i) => (i === 0 ? x ^ 0xff : x));
        return { witness_key_name: w.name, timestamp: Number(TS), cosignature_b64: b64u(sig) };
    });

    const tlog: TransparencyLogJson = {
        checkpoint: { origin: ORIGIN, tree_size: n, root_hash_b64: b64u(root), note_b64: Buffer.from(note, 'utf8').toString('base64url'), kid: LOG_KID },
        cosignatures,
        window_inclusions: windowInclusions,
    };

    if (opts.withConsistency !== false && n > 1) {
        const m = n - 1;
        const prevRoot = buildMerkleTree(leaves.slice(0, m)).root;
        const prevBody = encodeCheckpointBody({ origin: ORIGIN, treeSize: BigInt(m), rootHash: prevRoot });
        const prevNote = assembleSignedNote(prevBody, ORIGIN, LOG.raw, LOG.sign(Buffer.from(prevBody, 'utf8')));
        const proof = buildConsistencyProof(leaves, m);
        let nodes = proof.nodes.map(b64u);
        if (opts.tamper === 'consistency') nodes = nodes.map((x, i) => (i === 0 ? b64u(new Uint8Array(Buffer.from(x, 'base64url')).map((y) => y ^ 0xff)) : x));
        tlog.consistency = { prev: { tree_size: opts.tamper === 'prevsize' ? n : m, root_hash_b64: b64u(prevRoot), note_b64: Buffer.from(prevNote, 'utf8').toString('base64url'), kid: LOG_KID }, proof: nodes };
    }

    const policy: WitnessVerifierPolicy = {
        name: 'test', origin: ORIGIN, threshold: opts.threshold ?? 3,
        witnesses: policyW.map((w) => ({ keyName: w.name, publicKey: w.k.raw, isExternal: w.external, jurisdiction: w.juris })),
    };
    return { tlog, windowRoots, logKeys: new Map([[LOG_KID, LOG.raw]]), policy };
}

const run = (o: BuildOpts, withPolicy = true): NonEquivocationOutcome => {
    const { tlog, windowRoots, logKeys, policy } = build(o);
    return verifyTransparencyLog(tlog, windowRoots, logKeys, withPolicy ? policy : null);
};

describe('verifyTransparencyLog: status + quorum', () => {
    it('valid bundle + floor-satisfying quorum ⇒ verified, floorMet', () => {
        const out = run({});
        expect(out.status).toBe('verified');
        expect(out.report?.appendOnly).toBe(true);
        expect(out.report?.quorum?.floorMet).toBe(true);
        expect(out.report?.quorum?.matchedKeyNames).toHaveLength(3);
    });

    it('no policy ⇒ not_verified_no_policy (never the strong label)', () => {
        const out = run({}, false);
        expect(out.status).toBe('not_verified_no_policy');
        expect(out.report).toBeNull();
    });

    it('no transparency_log section ⇒ none', () => {
        const out = verifyTransparencyLog(undefined, new Map(), new Map(), null);
        expect(out.status).toBe('none');
    });
});

describe('verifyTransparencyLog: the witness floor is load-bearing', () => {
    it('only 2 cosigners ⇒ verified but floor NOT met', () => {
        const out = run({ cosigners: [W_EU, W_US] });
        expect(out.status).toBe('verified');
        expect(out.report?.quorum?.floorMet).toBe(false);
    });
    it('3 cosigners but none external ⇒ floor NOT met', () => {
        const internal = ALL_W.map((w) => ({ ...w, external: false }));
        const out = run({ cosigners: internal.slice(0, 3), policyWitnesses: internal });
        expect(out.report?.quorum?.quorumMet).toBe(true);
        expect(out.report?.quorum?.floorMet).toBe(false);
    });
    it('3 cosigners but none EU/EEA ⇒ floor NOT met', () => {
        const noneEu = [{ ...W_US }, { ...W_AR, external: true }, { ...W_NO, juris: 'US' }];
        const out = run({ cosigners: noneEu, policyWitnesses: noneEu });
        expect(out.report?.quorum?.quorumMet).toBe(true);
        expect(out.report?.quorum?.floorMet).toBe(false);
    });
    it('3 cosigners incl. external + EU/EEA ⇒ floor met', () => {
        expect(run({ cosigners: [W_EU, W_US, W_NO] }).report?.quorum?.floorMet).toBe(true);
    });
});

describe('verifyTransparencyLog: BOTH halves required for the strong label', () => {
    it('floor met but below the named threshold ⇒ quorumMet false (strong label withheld)', () => {
        // 4-witness policy, threshold 4, but only 3 cosign: floor met (3, ext, EU/EEA) yet quorum short.
        const out = run({ cosigners: [W_EU, W_US, W_NO], threshold: 4 });
        expect(out.report?.quorum?.floorMet).toBe(true);
        expect(out.report?.quorum?.quorumMet).toBe(false);
    });
    it('floor + threshold met but NO consistency proof ⇒ appendOnly false (strong label withheld)', () => {
        const out = run({ cosigners: [W_EU, W_US, W_NO], withConsistency: false });
        expect(out.report?.quorum?.floorMet).toBe(true);
        expect(out.report?.appendOnly).toBe(false);
    });
});

describe('verifyTransparencyLog: fail-closed', () => {
    it('tampered consistency proof ⇒ failed', () => {
        expect(run({ tamper: 'consistency' }).status).toBe('failed');
    });
    it('signed-body origin != policy origin ⇒ failed (cosigned body bound to the wrong log)', () => {
        expect(run({ tamper: 'bodyorigin' }).status).toBe('failed');
    });
    it('vacuous consistency (prev tree_size == latest) ⇒ failed', () => {
        expect(run({ tamper: 'prevsize' }).status).toBe('failed');
    });
    it('forged cosignature is excluded (drops the floor), never trusted', () => {
        const out = run({ tamper: 'cosig' });
        expect(out.status).toBe('verified');
        expect(out.report?.quorum?.matchedKeyNames).toHaveLength(2); // forged one dropped
        expect(out.report?.quorum?.floorMet).toBe(false);
    });
    it('origin mismatch vs policy ⇒ failed', () => {
        expect(run({ tamper: 'origin' }).status).toBe('failed');
    });
    it('tampered checkpoint note ⇒ failed', () => {
        expect(run({ tamper: 'note' }).status).toBe('failed');
    });
    it('genesis (no consistency block) ⇒ verified, appendOnly false but not a failure', () => {
        const out = run({ withConsistency: false });
        expect(out.status).toBe('verified');
        expect(out.report?.appendOnly).toBe(false);
    });
});

describe('renderNonEquivocation: honest, floor-gated label + overclaim guard', () => {
    const FORBIDDEN = [/non.?equivocation/i, /split.?view/i, /trustless/i];

    it('floor met ⇒ the conditional non-equivocation label, exit ok', () => {
        const { stdout, ok } = renderNonEquivocation(run({ cosigners: [W_EU, W_US, W_NO] }));
        expect(ok).toBe(true);
        const text = stdout.join('\n');
        expect(text).toMatch(/non.?equivocation/i);
        expect(text).toMatch(/external/i);
        expect(text).toMatch(/EU\/EEA/i);
    });

    it('sub-floor ⇒ G2-degrade label with reason, NONE of the forbidden vocabulary, exit ok', () => {
        const { stdout, stderr, ok } = renderNonEquivocation(run({ cosigners: [W_EU, W_US] }));
        expect(ok).toBe(true);
        const text = [...stdout, ...stderr].join('\n');
        for (const re of FORBIDDEN) expect(text).not.toMatch(re);
        expect(text).toMatch(/floor/i);
    });

    it('quorum + floor met but NO consistency proof ⇒ NO forbidden vocabulary, no check mark', () => {
        const { stdout, ok } = renderNonEquivocation(run({ cosigners: [W_EU, W_US, W_NO], withConsistency: false }));
        expect(ok).toBe(true);
        const text = stdout.join('\n');
        for (const re of FORBIDDEN) expect(text).not.toMatch(re);
        expect(text).not.toMatch(/✓/);
        expect(text).toMatch(/append-only/i);
    });

    it('no policy ⇒ "present but NOT verified", no forbidden vocabulary, exit ok', () => {
        const { stdout, ok } = renderNonEquivocation(run({}, false));
        expect(ok).toBe(true);
        const text = stdout.join('\n');
        for (const re of FORBIDDEN) expect(text).not.toMatch(re);
        expect(text).toMatch(/--witness-policy/);
    });

    it('failed ⇒ exit non-zero', () => {
        expect(renderNonEquivocation(run({ tamper: 'consistency' })).ok).toBe(false);
    });
});
