// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * Audit-evidence bundle verifier.
 *
 * Two independent checks, both offline, trusting only the supplied trust-keys:
 *   1. Bundle integrity — the existing `verifyBundle` (manifest signature +
 *      content-hash check) proves the bundle wasn't repackaged.
 *   2. Chain verification — the L0 `verifyChain` recomputes the hash-chain from
 *      the RAW event content in events.json and validates the checkpoints. This
 *      is the SINGLE source of chain-verification truth — the CLI does
 *      not reimplement it.
 */

import * as zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import * as tar from 'tar-stream';
import {
    verifyChain,
    type Verdict,
    type VerifierEventRow,
    type VerifierCheckpoint,
    type TrustKey,
    type ChainedEventContent,
} from '@zarel-ai/audit-chain';
import {
    verifyInclusion,
    MERKLE_SCHEME,
    verifyTimestampToken,
    verifyEvidenceRecord,
    decodeEvidenceRecord,
    verifyCheckpointNote,
    verifyConsistency,
    encodeCheckpointBody,
    evaluateWitnessQuorum,
    bytesEqual,
    D21_MIN_UNITS,
    type WitnessVerifierPolicy,
    type CheckpointCosignature,
    type QuorumVerdict,
    type RevocationPolicy,
} from '@zarel-ai/audit-tsa';
import { verifyBundle, type VerifyResult } from './bundle-verifier';

export interface AuditVerifyInput {
    readonly bundleBytes: Uint8Array;
    readonly trustKeysManifest: unknown;
    /**
     * EXPLICIT pinned TSA root certs (DER) for anchoring verification.
     * Omitted/empty ⇒ anchoring is reported "not verified", never silently
     * anchored and never the OS trust store.
     */
    readonly pinnedTsaRoots?: ReadonlyArray<Uint8Array>;
    /**
     * The named witness policy for the transparency-log non-equivocation check.
     * Omitted/null ⇒ the section is reported "present but NOT verified", never a
     * positive non-equivocation label — the DI'd analog of `pinnedTsaRoots`.
     */
    readonly witnessPolicy?: WitnessVerifierPolicy | null;
    /**
     * Revocation posture — REQUIRED, no silent default. `strict` treats an
     * uncaptured non-revocation proof as a hard fail (compliance verifier); `lenient`
     * is the honest-degraded relying-party view. The CLI command maps its
     * `--revocation` flag (default `lenient`) onto this.
     */
    readonly revocationPolicy: RevocationPolicy;
}

/** A third-party-attested time over a window's checkpoint Merkle root. */
export interface AnchoringAttestation {
    readonly windowId: string;
    readonly genTime: string;
}

/**
 * Honest-label anchoring report. Structurally separates
 * what an external TSA attests (anchoredRange) from what rests on the operator's
 * self-asserted clock (unanchoredTail). v1 proves temporal precedence offline
 * TODAY — not revocation, not long-term validity.
 */
export interface AnchoringRenewal {
    readonly windowId: string;
    readonly chainDepth: number;
    readonly latestNotAfter: string;
}

export interface AnchoringReport {
    readonly anchoredRange: { from: number; to: number } | null;
    readonly attestations: ReadonlyArray<AnchoringAttestation>;
    readonly unanchoredTail: { from: number; to: number } | null;
    readonly freshnessBound: string;
    /** Per-window RFC 4998 renewal chains that verify as still-valid TODAY. */
    readonly renewals?: ReadonlyArray<AnchoringRenewal>;
    /** Honest, CONDITIONAL long-term-validity label (present when renewals verified). */
    readonly ltvBound?: string;
    /** Honest revocation label (present when any record carried captured CRL/OCSP). */
    readonly revocationBound?: string;
    /** Windows whose TSA signer cert was REVOKED at use-time (per-window, exit non-zero). */
    readonly revokedWindows?: ReadonlyArray<string>;
    /** (strict) Windows lacking a positive non-revocation proof (per-window, exit non-zero). */
    readonly uncapturedWindows?: ReadonlyArray<string>;
}

export type AnchoringStatus =
    | 'none' // no anchors.json / nothing anchored in range (un-anchored tail only)
    | 'not_verified_no_roots' // anchors present but no --tsa-roots supplied
    | 'verified' // at least one checkpoint anchored, all attempted checks passed
    | 'failed'; // a tampered root / path / token (exit non-zero)

export interface AnchoringOutcome {
    readonly status: AnchoringStatus;
    readonly report: AnchoringReport | null;
    readonly failure?: string;
}

export interface AuditVerifyResult {
    readonly integrity: VerifyResult;
    readonly verdict: Verdict | null; // null if events.json absent (not an audit bundle)
    readonly isAuditBundle: boolean;
    readonly anchoring: AnchoringOutcome;
    readonly nonEquivocation: NonEquivocationOutcome;
}

async function extract(bytes: Uint8Array): Promise<{ entries: Map<string, Buffer>; rootDir: string }> {
    const decompressed = zlib.gunzipSync(Buffer.from(bytes));
    const ex = tar.extract();
    const entries = new Map<string, Buffer>();
    // The archive root is the FIRST segment of the first entry that has one — the same rule the
    // manifest-signature verifier applies, and the two must agree: a verdict read from a different
    // root than the one integrity checked would describe bytes nothing signed.
    let rootDir = '';
    return await new Promise((resolve, reject) => {
        ex.on('entry', (header, stream, next) => {
            const chunks: Buffer[] = [];
            stream.on('data', (c: Buffer) => chunks.push(c));
            stream.on('end', () => {
                if (!rootDir && header.name.includes('/')) {
                    rootDir = header.name.slice(0, header.name.indexOf('/'));
                }
                entries.set(header.name, Buffer.concat(chunks));
                next();
            });
            stream.on('error', reject);
            stream.resume();
        });
        ex.on('finish', () => resolve({ entries, rootDir }));
        ex.on('error', reject);
        ex.end(decompressed);
    });
}

/** The paths `manifest.json` puts its name and hash to, or an empty set if it cannot be read. */
function coveredPaths(entries: Map<string, Buffer>, rootDir: string): ReadonlySet<string> {
    const manifestBytes = entries.get(`${rootDir}/manifest.json`);
    if (!manifestBytes) return new Set();
    try {
        const parsed = JSON.parse(manifestBytes.toString('utf8')) as { content_hashes?: Record<string, string> };
        return new Set(Object.keys(parsed.content_hashes ?? {}));
    } catch {
        // A manifest that does not parse fails the integrity check on its own; here it simply
        // covers nothing, so every file below is read as unsigned.
        return new Set();
    }
}

/**
 * The bundle's `<name>`, but ONLY when the signed manifest vouches for it.
 *
 * Two things have to hold, and each one alone was not enough. The file must sit at the archive
 * ROOT: reading it by basename anywhere in the tree let an extra copy placed earlier in the
 * archive — `<root>/anything/events.json` — supply the chain the verdict then described, while
 * integrity reported the root copy it never looked at. And the manifest must LIST it: a file at
 * the root that `content_hashes` does not name was signed by nobody, so a verdict over it is a
 * statement about bytes the signer never saw.
 */
function signedEntry(
    entries: Map<string, Buffer>,
    rootDir: string,
    covered: ReadonlySet<string>,
    name: string,
): Buffer | undefined {
    if (!covered.has(name)) return undefined;
    return entries.get(`${rootDir}/${name}`);
}

function toTrustKeys(manifest: unknown): TrustKey[] {
    type ManifestKey = {
        kid?: string;
        public_key_b64?: string;
        valid_from?: string | null;
        valid_until?: string | null;
        revoked_at?: string | null;
    };
    const tk = manifest as { keys?: ManifestKey[] };
    if (!tk?.keys) return [];
    return tk.keys
        .filter((k): k is ManifestKey & { kid: string; public_key_b64: string } => !!k.kid && !!k.public_key_b64)
        // Carry the manifest's validity window into the verifier so
        // verifyChain enforces valid_from / valid_until / revoked_at against each
        // checkpoint's signed_at. Absent fields ⇒ no bound (backward compatible).
        .map((k) => ({
            kid: k.kid,
            publicKeyB64: k.public_key_b64,
            validFrom: k.valid_from ?? null,
            validUntil: k.valid_until ?? null,
            revokedAt: k.revoked_at ?? null,
        }));
}

interface EventJson {
    seq: number;
    prev_hash: string;
    event_hash: string;
    deleted_at: string | null;
    content: ChainedEventContent;
}

export interface CheckpointJson {
    tenant_name: string;
    log_name: string;
    seq: number;
    head_hash: string;
    prev_checkpoint_hash: string | null;
    checkpoint_hash: string;
    window_id: string;
    kid: string;
    signature_b64: string;
    signed_at: string;
    // The V2 signed fields on a terminal checkpoint. Absent ⇒ V1
    // (verified exactly as before — dual-version dispatch by presence).
    schema_version?: number;
    terminal?: { kind: 'sealed' | 'empty_chain' };
}

export interface AnchorsJson {
    schema_version?: number;
    merkle_scheme?: string;
    window_anchors?: Array<{
        window_id: string;
        merkle_root_b64: string;
        leaf_count: number;
        gen_time: string;
        tsa_token_b64: string;
    }>;
    inclusions?: Array<{
        log_name: string;
        window_id: string;
        checkpoint_hash_b64: string;
        leaf_index: number;
        path: Array<{ hash_b64: string; side: 'L' | 'R' }>;
    }>;
    /** Per-window RFC 4998 EvidenceRecord (renewal chain), DER base64. */
    evidence_records?: Array<{ window_id: string; evidence_record_b64: string }>;
    /** The transparency-log checkpoint + cosignatures + proofs. */
    transparency_log?: TransparencyLogJson;
}

/** The bundle's transparency-log section: signed checkpoint, witness cosignatures, window-root inclusions, optional consistency proof. */
export interface TransparencyLogJson {
    checkpoint: { origin: string; tree_size: number; root_hash_b64: string; note_b64: string; kid: string };
    cosignatures: Array<{ witness_key_name: string; timestamp: number; cosignature_b64: string }>;
    window_inclusions: Array<{ window_id: string; leaf_index: number; path: Array<{ hash_b64: string; side: 'L' | 'R' }> }>;
    consistency?: {
        prev: { tree_size: number; root_hash_b64: string; note_b64: string; kid: string };
        proof: string[];
    };
}

export type NonEquivocationStatus =
    | 'none' // no transparency_log in this bundle
    | 'not_verified_no_policy' // section present, no --witness-policy supplied
    | 'verified' // proofs verified; the label scales with the quorum verdict
    | 'failed'; // tampered proof / forged note / origin mismatch (exit non-zero)

export interface NonEquivocationReport {
    /** The prev→latest consistency proof verified (append-only completeness). */
    readonly appendOnly: boolean;
    readonly quorum: QuorumVerdict | null;
    /** The conditional, floor-gated honest label (pure; mechanically testable). */
    readonly label: string;
}

export interface NonEquivocationOutcome {
    readonly status: NonEquivocationStatus;
    readonly report: NonEquivocationReport | null;
    readonly failure?: string;
}

const fromB64 = (s: string): Buffer => Buffer.from(s, 'base64url');
const fromB64u8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64url'));

/**
 * Compose the CONDITIONAL long-term-validity label. Pure so the honest
 * wording is mechanically gated without fabricating crypto: it is present only when a
 * real renewal chain (depth ≥ 2) was verified or lapsed, always carries the
 * operator-maintained / unrecoverable / out-of-scope caveats, and never an absolute.
 */
export function composeLtvBound(
    renewedCount: number,
    earliestDeadline: string,
    lapsedWindows: number,
    nowIso: string,
): string | undefined {
    const parts: string[] = [];
    if (renewedCount > 0) {
        parts.push(`long-term validity (RFC 4998 ERS): ${renewedCount} window(s) re-timestamped, each verified valid as of ${nowIso} through its renewal chain (latest token valid until ${earliestDeadline})`);
    }
    if (lapsedWindows > 0) {
        parts.push(`${lapsedWindows} window(s) have a LAPSED renewal chain (a renewal was missed before expiry) and revert to their last-good anchor — no longer covered for long-term validity`);
    }
    if (parts.length === 0) {
        return undefined;
    }
    return `${parts.join('. ')}. Renewal is operator-maintained — a renewal missed before a token's expiry is unrecoverable. This label establishes cryptographic longevity only; certificate-status and non-equivocation remain out of its scope.`;
}

/**
 * Compose the CONDITIONAL revocation label. Pure + mechanically gated:
 * NOT_CAPTURED never renders as checked, and the claim is certificate-status at
 * use-time ONLY — never non-equivocation, never an absolute.
 */
export function composeRevocationBound(checked: number, total: number): string {
    const notCaptured = total - checked;
    const head =
        notCaptured === 0
            ? `revocation: all ${total} anchored token(s) confirmed NOT REVOKED at use-time (offline, via captured CRL/OCSP)`
            : `revocation: ${checked}/${total} anchored token(s) confirmed not-revoked at use-time; ${notCaptured} NOT CAPTURED (use-time non-revocation unproven for those — they keep only the longevity label)`;
    return `${head}. This is certificate-status at use-time ONLY; it is NOT non-equivocation.`;
}

/**
 * Verify anchoring offline: each inclusion path must rebuild its window's
 * Merkle root from the bundle's own checkpoint hash, and that root must be the
 * messageImprint of a TSA token chaining to a PINNED root. A single tamper fails
 * the whole anchoring result. The chain verdict is independent.
 */
export function verifyAnchoring(
    anchors: AnchorsJson,
    checkpoints: CheckpointJson[],
    pinnedRoots: ReadonlyArray<Uint8Array>,
    revocationPolicy: RevocationPolicy,
    now: Date = new Date(),
): AnchoringOutcome {
    const windowAnchors = anchors.window_anchors ?? [];
    const inclusions = anchors.inclusions ?? [];
    if (windowAnchors.length === 0 && inclusions.length === 0) {
        return { status: 'none', report: null };
    }
    // Self-describing artifact: refuse to trust any inclusion path unless the bundle
    // declares the Merkle scheme this verifier implements. Fail closed on an
    // absent/unknown scheme so a root built under a different tree construction can
    // never be verified against the wrong algorithm.
    if (anchors.merkle_scheme !== MERKLE_SCHEME) {
        return { status: 'failed', report: null, failure: `unsupported or missing merkle_scheme: ${anchors.merkle_scheme ?? '(absent)'}` };
    }
    if (pinnedRoots.length === 0) {
        return { status: 'not_verified_no_roots', report: null };
    }

    const anchorByWindow = new Map(windowAnchors.map((a) => [a.window_id, a]));
    const checkpointByHash = new Map(checkpoints.map((c) => [c.checkpoint_hash, c]));
    const verifiedWindows = new Map<string, string>(); // windowId → genTime
    const anchoredSeqs: number[] = [];
    const anchoredHashes = new Set<string>(); // checkpoint_hash_b64 of verified inclusions

    for (const inc of inclusions) {
        const anchor = anchorByWindow.get(inc.window_id);
        const checkpoint = checkpointByHash.get(inc.checkpoint_hash_b64);
        if (!anchor || !checkpoint) {
            continue; // an inclusion whose anchor/checkpoint isn't in this (ranged) bundle → not counted
        }
        const root = fromB64u8(anchor.merkle_root_b64);
        const leaf = fromB64u8(checkpoint.checkpoint_hash);
        const path = inc.path.map((node) => ({ hash: fromB64u8(node.hash_b64), side: node.side }));
        if (!verifyInclusion(leaf, path, root)) {
            return { status: 'failed', report: null, failure: `inclusion path failed for checkpoint seq ${checkpoint.seq}` };
        }
        if (!verifiedWindows.has(anchor.window_id)) {
            const verdict = verifyTimestampToken({
                token: new Uint8Array(Buffer.from(anchor.tsa_token_b64, 'base64')),
                expectedRoot: root,
                pinnedRoots,
            });
            if (!verdict.ok || verdict.genTime === null) {
                return { status: 'failed', report: null, failure: `TSA token failed for window ${anchor.window_id}: ${verdict.failure ?? 'no_gen_time'}` };
            }
            verifiedWindows.set(anchor.window_id, verdict.genTime);
        }
        anchoredSeqs.push(checkpoint.seq);
        anchoredHashes.add(inc.checkpoint_hash_b64);
    }

    if (anchoredSeqs.length === 0) {
        return { status: 'none', report: null };
    }

    const anchoredFrom = Math.min(...anchoredSeqs);
    const anchoredTo = Math.max(...anchoredSeqs);
    // Tail = bundled checkpoints with NO verified anchor, keyed by checkpoint_hash
    // (NOT by `seq > anchoredTo`): heartbeat checkpoints reuse the head seq across
    // windows, so a seq test would silently drop an un-anchored later window that
    // shares a seq with an anchored one — falsely reporting it anchored.
    const tailSeqs = checkpoints.filter((c) => !anchoredHashes.has(c.checkpoint_hash)).map((c) => c.seq);
    const attestations = [...verifiedWindows.entries()].map(([windowId, genTime]) => ({ windowId, genTime }));
    const latestGenTime = attestations.map((a) => a.genTime).sort().at(-1) ?? '';

    // Verify any per-window RFC 4998 renewal chain. Distinguish two outcomes,
    // because they mean very different things:
    //   - TAMPER (malformed DER / inclusion_mismatch / link_broken / token_invalid):
    //     a present EvidenceRecord that is structurally broken → hard FAIL the bundle.
    //   - LAPSE (renewal_gap / tsa_cert_expired): the chain was honestly built but a
    //     renewal was missed before expiry. This is NOT tampering — the window simply
    //     reverts to its last-good TSA anchor (still in `attestations`). It must NOT
    //     fail the whole bundle (which would poison healthy checkpoints and mislabel
    //     a benign operational lapse as a cryptographic tamper).
    const LAPSE_REASONS: ReadonlySet<string> = new Set(['renewal_gap', 'tsa_cert_expired']);
    const renewals: AnchoringRenewal[] = [];
    let lapsedWindows = 0;
    // Aggregate use-time revocation across records that carried cryptoInfos.
    let revocCheckedTokens = 0;
    let revocTotalTokens = 0;
    let recordsWithRevocation = 0;
    const revokedWindows: string[] = [];
    const uncapturedWindows: string[] = [];
    for (const er of anchors.evidence_records ?? []) {
        const anchor = anchorByWindow.get(er.window_id);
        if (!anchor || !verifiedWindows.has(er.window_id)) {
            continue; // only windows actually anchored + included in this bundle
        }
        let record;
        try {
            record = decodeEvidenceRecord(new Uint8Array(Buffer.from(er.evidence_record_b64, 'base64')));
        } catch {
            return { status: 'failed', report: null, failure: `evidence record for window ${er.window_id} is malformed` };
        }
        const verdict = verifyEvidenceRecord({ record, dataObjectHash: fromB64u8(anchor.merkle_root_b64), pinnedRoots, now, revocationPolicy });
        // A record carries renewals only when its chain is deeper than the initial
        // anchor ATS. A depth-1 record is an anchor-only revocation record (a
        // never-renewed window) — it must NOT be reported as "re-timestamped through a
        // renewal chain" (false LTV), nor its expiry as a "lapsed renewal".
        const hasRenewals = verdict.chainDepth > 1;
        if (!verdict.ok || verdict.latestNotAfter === null) {
            if (verdict.failure === 'token_revoked') {
                // A revoked signer cert invalidates THIS window's anchor. Per-window
                // (like LAPSE): record it, keep verifying the rest — a single
                // revoked window must not poison every other healthy window's attestation.
                // It DOES drive a non-zero exit (renderAnchoring), unlike a benign lapse.
                revokedWindows.push(er.window_id);
                continue;
            }
            if (verdict.failure === 'revocation_not_captured') {
                // (strict) THIS window's anchor lacks a positive non-revocation
                // proof. Per-window like a revoke: record it, keep verifying the rest,
                // and drive a non-zero exit. Only reachable under `strict`.
                uncapturedWindows.push(er.window_id);
                continue;
            }
            if (verdict.failure && LAPSE_REASONS.has(verdict.failure)) {
                if (hasRenewals) {
                    lapsedWindows += 1; // a real renewal chain lapsed; reverts to its TSA anchor
                }
                continue; // depth-1 expiry = plain expired TSA anchor, already attested
            }
            return { status: 'failed', report: null, failure: `renewal chain for window ${er.window_id} is malformed/tampered: ${verdict.failure ?? 'unknown'}` };
        }
        if (hasRenewals) {
            renewals.push({ windowId: er.window_id, chainDepth: verdict.chainDepth, latestNotAfter: verdict.latestNotAfter });
        }
        if (verdict.revocation) {
            recordsWithRevocation += 1;
            revocCheckedTokens += verdict.revocation.checkedCount;
            revocTotalTokens += verdict.revocation.total;
        }
    }
    const earliestDeadline = renewals.map((r) => r.latestNotAfter).sort()[0] ?? '';
    const ltvBound = composeLtvBound(renewals.length, earliestDeadline, lapsedWindows, now.toISOString());
    const revocationBound = recordsWithRevocation > 0 ? composeRevocationBound(revocCheckedTokens, revocTotalTokens) : undefined;

    const renewalReport = {
        ...(renewals.length > 0 ? { renewals } : {}),
        ...(ltvBound ? { ltvBound } : {}),
        ...(revocationBound ? { revocationBound } : {}),
        ...(revokedWindows.length > 0 ? { revokedWindows } : {}),
        ...(uncapturedWindows.length > 0 ? { uncapturedWindows } : {}),
    };

    return {
        status: 'verified',
        report: {
            anchoredRange: { from: anchoredFrom, to: anchoredTo },
            attestations,
            unanchoredTail: tailSeqs.length > 0 ? { from: Math.min(...tailSeqs), to: Math.max(...tailSeqs) } : null,
            ...renewalReport,
            // Honest label. Decomposed precisely: anti-backdating is
            // UNCONDITIONAL (the TSA stamps its own clock — you cannot forge proof
            // of earlier existence); anti-rewrite is CONDITIONAL — an operator who
            // also distributes the bundle can rewrite a window and re-anchor the new
            // root, and only a verifier holding the PRIOR anchor sees the
            // contradiction (full anti-rewrite needs the transparency log). The tail is self-asserted.
            freshnessBound: `anti-backdating: checkpoints provably existed before ${latestGenTime}; rewrite is detectable only by a verifier holding the prior anchor; tail = window + async lag`,
        },
    };
}

/**
 * Pure rendering of the anchoring outcome. Kept separate
 * from I/O so the honest-label boundary is mechanically testable: `ok=false`
 * means a tamper (caller exits non-zero). The output mentions long-term
 * validity and revocation ONLY when the bundle carries that evidence
 * and it verified — and only with the conditional, never-absolute label.
 */
export function renderAnchoring(anchoring: AnchoringOutcome): { stdout: string[]; stderr: string[]; ok: boolean } {
    switch (anchoring.status) {
    case 'none':
        return { stdout: ['  Anchoring: no external timestamp anchor in range (self-asserted time only).'], stderr: [], ok: true };
    case 'not_verified_no_roots':
        return { stdout: ['  Anchoring: present but NOT verified — pass --tsa-roots <pem> to verify it.'], stderr: [], ok: true };
    case 'verified': {
        const report = anchoring.report;
        if (!report) {
            return { stdout: [], stderr: [], ok: true };
        }
        // Window + time MUST come from the SAME attestation — pick the one with
        // the latest genTime (don't pair a sorted-max time with an insertion-order
        // window, which can attribute the time to a different window).
        const latestAttestation = [...report.attestations].sort((a, b) => a.genTime.localeCompare(b.genTime)).at(-1);
        const latest = latestAttestation?.genTime ?? '';
        const window = latestAttestation?.windowId ?? '';
        const stdout = [`  ✓ Anchored by an independent TSA through ${latest} (window ${window}).`];
        if (report.unanchoredTail) {
            // Range, not a count: heartbeat checkpoints make seq non-contiguous, so
            // `to - from + 1` would over/under-count. The seq range bounds the tail.
            stdout.push(`    later checkpoints (seq ${report.unanchoredTail.from}–${report.unanchoredTail.to}) carry self-asserted time only.`);
        }
        stdout.push(`    ${report.freshnessBound}`);
        if (report.ltvBound) {
            stdout.push(`    ${report.ltvBound}`);
        }
        if (report.revocationBound) {
            stdout.push(`    ${report.revocationBound}`);
        }
        // A revoked signer cert for a window is a real integrity alarm: report it
        // per-window (the rest of the bundle still verified, above) and exit non-zero.
        const alarms: string[] = [];
        if (report.revokedWindows && report.revokedWindows.length > 0) {
            alarms.push(`  ✗ TSA signer certificate REVOKED at use-time for window(s): ${report.revokedWindows.join(', ')} — those anchors are not trustworthy.`);
        }
        // (strict) a window without a positive non-revocation proof fails the compliance policy.
        if (report.uncapturedWindows && report.uncapturedWindows.length > 0) {
            alarms.push(`  ✗ Revocation NOT CAPTURED under the strict policy for window(s): ${report.uncapturedWindows.join(', ')} — required proof of non-revocation is absent.`);
        }
        if (alarms.length > 0) {
            return { stdout, stderr: alarms, ok: false };
        }
        return { stdout, stderr: [], ok: true };
    }
    case 'failed':
        return { stdout: [], stderr: [`  ✗ Anchoring verification FAILED: ${anchoring.failure ?? 'tampered anchor'}`], ok: false };
    }
}

/**
 * Verify the transparency-log section offline. In order,
 * fail-closed on any step: the checkpoint note signature (log key resolved by `kid`),
 * the origin against the named policy, each window-root inclusion path against the
 * checkpoint root, the consistency proof prev→latest (incl. the prev note signature),
 * and the witness quorum. The label SCALES with the quorum and is gated on the witness
 * independence floor — below it, only append-only completeness is stated. No `tlog` ⇒ none; no
 * `policy` ⇒ not_verified_no_policy (never a positive label without the named policy).
 */
export function verifyTransparencyLog(
    tlog: TransparencyLogJson | undefined,
    windowRootsByIdB64: ReadonlyMap<string, string>,
    logKeysByKid: ReadonlyMap<string, Uint8Array>,
    policy: WitnessVerifierPolicy | null,
): NonEquivocationOutcome {
    if (!tlog) {
        return { status: 'none', report: null };
    }
    if (!policy) {
        return { status: 'not_verified_no_policy', report: null };
    }
    const fail = (failure: string): NonEquivocationOutcome => ({ status: 'failed', report: null, failure });

    const cp = tlog.checkpoint;
    // A cosignature over a DIFFERENT log's checkpoint is not evidence for this one.
    if (cp.origin !== policy.origin) {
        return fail(`checkpoint origin "${cp.origin}" does not match the named policy origin "${policy.origin}"`);
    }
    if (!isPosInt(cp.tree_size) || cp.tree_size < 1) {
        return fail('checkpoint tree size is not a positive integer');
    }
    const logKey = logKeysByKid.get(cp.kid);
    if (!logKey) {
        return fail(`log signing key "${cp.kid}" is not in the trust-keys manifest`);
    }
    const note = Buffer.from(cp.note_b64, 'base64url').toString('utf8');
    const checkpoint = verifyCheckpointNote(note, cp.origin, logKey);
    if (!checkpoint) {
        return fail('checkpoint note signature is invalid');
    }
    const claimedRoot = fromB64u8(cp.root_hash_b64);
    // The SIGNED note must commit to the JSON-claimed size + root AND its body origin
    // (what the witnesses actually cosign via encodeCheckpointBody) must be the policy
    // origin — verifyCheckpointNote does not bind the body origin to the signature name.
    if (checkpoint.treeSize !== BigInt(cp.tree_size) || !bytesEqual(checkpoint.rootHash, claimedRoot)) {
        return fail('checkpoint note does not commit to the claimed tree size / root');
    }
    if (checkpoint.origin !== policy.origin) {
        return fail(`signed checkpoint body origin "${checkpoint.origin}" does not match the named policy origin "${policy.origin}"`);
    }

    // Inclusion: each shipped window-root path must rebuild to the checkpoint root.
    for (const inc of tlog.window_inclusions) {
        const rootB64 = windowRootsByIdB64.get(inc.window_id);
        if (!rootB64) {
            return fail(`no window anchor present for the inclusion of window ${inc.window_id}`);
        }
        const path = inc.path.map((s) => ({ hash: fromB64u8(s.hash_b64), side: s.side }));
        if (!verifyInclusion(fromB64u8(rootB64), path, claimedRoot)) {
            return fail(`window-root inclusion path failed for window ${inc.window_id}`);
        }
    }

    // Consistency (append-only completeness). Present ⇒ MUST verify; absent ⇒ genesis
    // (the most recent step is simply not demonstrated in this bundle — not a failure).
    let appendOnly = false;
    if (tlog.consistency) {
        const c = tlog.consistency;
        // A consistency block must demonstrate a REAL extension: 1 <= prev < latest.
        // verifyConsistency accepts the vacuous m==0 / m==n cases (an empty/equal tree
        // is trivially consistent), so the verifier — the trust boundary — rejects them
        // here, lest a malicious bundle earn "append-only proven" by pinning prev==latest.
        if (!isPosInt(c.prev.tree_size) || c.prev.tree_size < 1 || c.prev.tree_size >= cp.tree_size) {
            return fail('consistency prev tree size must satisfy 1 <= prev < latest');
        }
        const prevKey = logKeysByKid.get(c.prev.kid);
        if (!prevKey) {
            return fail(`prev checkpoint signing key "${c.prev.kid}" is not in the trust-keys manifest`);
        }
        const prevNote = Buffer.from(c.prev.note_b64, 'base64url').toString('utf8');
        const prevCp = verifyCheckpointNote(prevNote, cp.origin, prevKey);
        if (!prevCp) {
            return fail('prev checkpoint note signature is invalid');
        }
        const prevRoot = fromB64u8(c.prev.root_hash_b64);
        if (prevCp.treeSize !== BigInt(c.prev.tree_size) || !bytesEqual(prevCp.rootHash, prevRoot) || prevCp.origin !== policy.origin) {
            return fail('prev checkpoint note does not commit to its claimed size / root / origin');
        }
        if (!verifyConsistency(c.prev.tree_size, prevRoot, cp.tree_size, claimedRoot, { nodes: c.proof.map(fromB64u8) })) {
            return fail('consistency proof (prev → latest) failed — append-only violation');
        }
        appendOnly = true;
    }

    // Quorum (non-equivocation half). Witnesses cosign the canonical checkpoint BODY.
    // A cosignature with a non-integer timestamp is dropped (fail-closed), never crashed on.
    const body = encodeCheckpointBody(checkpoint);
    const cosigs: CheckpointCosignature[] = tlog.cosignatures
        .filter((co) => isPosInt(co.timestamp))
        .map((co) => ({
            keyName: co.witness_key_name,
            timestamp: BigInt(co.timestamp),
            signature: fromB64u8(co.cosignature_b64),
        }));
    const quorum = evaluateWitnessQuorum(body, cosigs, policy);

    return { status: 'verified', report: { appendOnly, quorum, label: composeNonEquivocationLabel(appendOnly, quorum) } };
}

/** A safe non-negative integer (untrusted JSON numbers must not reach BigInt() and throw). */
function isPosInt(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * Whether the FULL non-equivocation property holds — BOTH halves: append-only
 * completeness (the consistency proof verified) AND split-view resistance (the
 * witnessed quorum meets the named N-of-M threshold AND the witness independence
 * floor). The strong label + the ✓ render iff this is true.
 */
function nonEquivocationHolds(appendOnly: boolean, q: QuorumVerdict): boolean {
    return appendOnly && q.quorumMet && q.floorMet;
}

/**
 * The conditional, floor-gated honest label (overclaim guard). The
 * non-equivocation / split-view vocabulary appears ONLY when BOTH halves hold;
 * otherwise only the demonstrated half is stated and the stronger label is withheld
 * with the precise reason. Absence of the consistency proof is reported as
 * "not demonstrated" — NEVER as a benign "genesis" the verifier cannot confirm.
 */
function composeNonEquivocationLabel(appendOnly: boolean, q: QuorumVerdict): string {
    const appendNote = appendOnly
        ? 'append-only completeness proven (consistency proof prev → latest verified)'
        : 'append-only completeness NOT demonstrated in this bundle (no consistency proof supplied)';
    if (nonEquivocationHolds(appendOnly, q)) {
        return `Non-equivocation: ${appendNote} + split-view resistance, conditional on the witnessed quorum (${q.matchedKeyNames.length} witnesses cosigned; ${q.externalCount} external; ${q.euEeaCount} EU/EEA).`;
    }
    const reasons: string[] = [];
    if (!appendOnly) {
        reasons.push('the append-only consistency proof is absent');
    }
    if (!q.quorumMet) {
        reasons.push(`the witnessed quorum (matched ${q.matchedKeyNames.length}) is below the named policy threshold`);
    }
    if (!q.floorMet) {
        reasons.push(`the matched witnesses do not meet the witness independence floor (need >=${D21_MIN_UNITS} incl. >=1 external + >=1 EU/EEA; have ${q.matchedKeyNames.length}/${q.externalCount} external/${q.euEeaCount} EU/EEA)`);
    }
    return `${appendNote}; the stronger label is withheld because ${reasons.join('; ')} — the TSA anchor label stands.`;
}

/**
 * Render the transparency-log outcome. Pure + I/O-free so the honest-
 * label boundary is mechanically testable. A tampered proof / forged note is the only
 * `ok=false` (caller exits non-zero); absence / sub-floor degrade gracefully (the TSA anchor label stands).
 */
export function renderNonEquivocation(outcome: NonEquivocationOutcome): { stdout: string[]; stderr: string[]; ok: boolean } {
    switch (outcome.status) {
    case 'none':
        return { stdout: ['  Transparency log: none in this bundle.'], stderr: [], ok: true };
    case 'not_verified_no_policy':
        return { stdout: ['  Transparency log: present but NOT verified — pass --witness-policy <json> to verify the witness quorum.'], stderr: [], ok: true };
    case 'failed':
        return { stdout: [], stderr: [`  ✗ Transparency-log verification FAILED: ${outcome.failure ?? 'tampered proof'}`], ok: false };
    case 'verified': {
        const report = outcome.report;
        if (!report) {
            return { stdout: [], stderr: [], ok: true };
        }
        const strong = report.quorum ? nonEquivocationHolds(report.appendOnly, report.quorum) : false;
        return { stdout: [`${strong ? '  ✓ ' : '  '}${report.label}`], stderr: [], ok: true };
    }
    }
}

/**
 * Parse a `--witness-policy` JSON file into the in-memory named policy (DI'd verifier
 * trust input). `public_key_b64` is base64url of the raw 32-byte Ed25519
 * key (same encoding as the trust-keys manifest). Throws on a malformed policy.
 */
export function parseWitnessPolicy(manifest: unknown): WitnessVerifierPolicy {
    const p = manifest as {
        name?: string;
        origin?: string;
        threshold?: number;
        witnesses?: Array<{ key_name?: string; public_key_b64?: string; is_external?: boolean; jurisdiction?: string | null }>;
    };
    if (!p || typeof p.origin !== 'string' || typeof p.threshold !== 'number' || !Array.isArray(p.witnesses)) {
        throw new Error('witness policy: expected { name, origin, threshold, witnesses[] }');
    }
    const witnesses = p.witnesses.map((w) => {
        if (typeof w.key_name !== 'string' || typeof w.public_key_b64 !== 'string') {
            throw new Error('witness policy: each witness needs key_name + public_key_b64');
        }
        return {
            keyName: w.key_name,
            publicKey: fromB64u8(w.public_key_b64),
            isExternal: w.is_external === true,
            jurisdiction: typeof w.jurisdiction === 'string' ? w.jurisdiction : null,
        };
    });
    return { name: p.name ?? 'unnamed', origin: p.origin, threshold: p.threshold, witnesses };
}

export async function verifyAuditBundle(input: AuditVerifyInput): Promise<AuditVerifyResult> {
    const integrity = await verifyBundle({ bundleBytes: input.bundleBytes, trustKeysManifest: input.trustKeysManifest });

    const { entries, rootDir } = await extract(input.bundleBytes);
    const covered = coveredPaths(entries, rootDir);
    const eventsBytes = signedEntry(entries, rootDir, covered, 'events.json');
    if (!eventsBytes) {
        return { integrity, verdict: null, isAuditBundle: false, anchoring: { status: 'none', report: null }, nonEquivocation: { status: 'none', report: null } };
    }

    const eventsJson = JSON.parse(eventsBytes.toString('utf8')) as EventJson[];
    const checkpointsBytes = signedEntry(entries, rootDir, covered, 'checkpoints.json');
    const checkpointsJson = checkpointsBytes
        ? (JSON.parse(checkpointsBytes.toString('utf8')) as CheckpointJson[])
        : [];
    const anchorsBytes = signedEntry(entries, rootDir, covered, 'anchors.json');
    const anchorsJson = anchorsBytes ? (JSON.parse(anchorsBytes.toString('utf8')) as AnchorsJson) : {};
    const anchoring = verifyAnchoring(anchorsJson, checkpointsJson, input.pinnedTsaRoots ?? [], input.revocationPolicy);

    const events: VerifierEventRow[] = eventsJson.map((e) => ({
        seq: e.seq,
        prevHash: fromB64(e.prev_hash),
        eventHash: fromB64(e.event_hash),
        deletedAt: e.deleted_at ?? null,
        content: e.content,
    }));

    const checkpoints: VerifierCheckpoint[] = checkpointsJson.map((c) => ({
        tenantName: c.tenant_name,
        logName: c.log_name,
        seq: c.seq,
        headHash: fromB64(c.head_hash),
        prevCheckpointHash: c.prev_checkpoint_hash ? fromB64(c.prev_checkpoint_hash) : null,
        checkpointHash: fromB64(c.checkpoint_hash),
        windowId: c.window_id,
        kid: c.kid,
        signatureB64: c.signature_b64,
        signedAt: c.signed_at,
        // Dual-version dispatch: the SIGNAL is `schema_version`. Only a
        // V2 checkpoint signed `terminal` into its message, so carry BOTH fields
        // only when schema_version is present — a stray `terminal` (e.g. a raw
        // `terminal:false`) on a V1 checkpoint must NOT be folded into the
        // reconstructed V1 message, or its signature would spuriously fail.
        ...(c.schema_version !== undefined ? { schemaVersion: c.schema_version, terminal: c.terminal } : {}),
    }));

    const trustKeys = toTrustKeys(input.trustKeysManifest);
    const verdict = verifyChain({ events, checkpoints, keys: trustKeys });

    // Transparency-log non-equivocation. Window roots come from the
    // TSA window anchors; the log signing key is resolved from the trust-keys manifest by kid
    // (same custody as the chain checkpoints). The witness policy is the DI'd input.
    const windowRootsByIdB64 = new Map((anchorsJson.window_anchors ?? []).map((a) => [a.window_id, a.merkle_root_b64]));
    const logKeysByKid = new Map(trustKeys.map((k) => [k.kid, fromB64u8(k.publicKeyB64)]));
    const nonEquivocation = verifyTransparencyLog(anchorsJson.transparency_log, windowRootsByIdB64, logKeysByKid, input.witnessPolicy ?? null);

    return { integrity, verdict, isAuditBundle: true, anchoring, nonEquivocation };
}
