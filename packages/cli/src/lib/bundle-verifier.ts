// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * Pure verifier logic for signed trace evidence bundles.
 *
 * Shared between the standalone `zarel verify` CLI subcommand and any
 * future programmatic consumer. Fully offline — no HTTP calls.
 *
 * Steps:
 *   1. Extract the .tar.gz archive into an in-memory file map.
 *   2. Parse `manifest.json` and `manifest.sig`.
 *   3. Resolve the signing kid against the supplied trust-keys manifest.
 *   4. Verify the Ed25519 signature over canonical-JSON manifest bytes.
 *   5. Verify each `content_hashes[path]` matches the file's sha256.
 *
 * Returns a structured result; the caller maps to exit codes / output.
 */

import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import * as tar from 'tar-stream';
import sodium from 'libsodium-wrappers';

export interface VerifyInput {
    readonly bundleBytes: Uint8Array;
    readonly trustKeysManifest: unknown;  // Already-parsed JSON of .well-known/zarel-trust-keys.json
}

export type VerifyResult =
    | { readonly ok: true; readonly traceId: string; readonly tenant: string; readonly kid: string }
    | { readonly ok: false; readonly code: VerifyErrorCode; readonly message: string };

export type VerifyErrorCode =
    | 'malformed_archive'
    | 'manifest_missing'
    | 'signature_missing'
    | 'manifest_malformed'
    | 'signature_malformed'
    | 'kid_unknown'
    | 'kid_revoked'
    | 'kid_expired'
    | 'kid_not_yet_valid'
    | 'signature_invalid'
    | 'content_hash_mismatch'
    | 'trust_keys_invalid';

interface ExtractedFiles {
    readonly entries: Map<string, Uint8Array>;
    readonly rootDir: string;
}

export async function verifyBundle(input: VerifyInput): Promise<VerifyResult> {
    await sodium.ready;

    let extracted: ExtractedFiles;
    try {
        extracted = await extractTarGz(input.bundleBytes);
    } catch (err) {
        return { ok: false, code: 'malformed_archive', message: err instanceof Error ? err.message : 'tar-gz extraction failed' };
    }

    const manifestBytes = extracted.entries.get(`${extracted.rootDir}/manifest.json`);
    if (!manifestBytes) return { ok: false, code: 'manifest_missing', message: 'manifest.json not found in bundle' };

    const sigBytes = extracted.entries.get(`${extracted.rootDir}/manifest.sig`);
    if (!sigBytes) return { ok: false, code: 'signature_missing', message: 'manifest.sig not found in bundle' };

    let manifest: { tenant?: string; trace_id?: string; content_hashes?: Record<string, string> };
    try {
        // Cast to the DECLARED shape, whose fields are all optional — the checks below are what
        // decide whether this is a manifest. `JSON.parse` alone is `any` and would let a typo
        // through unnoticed.
        manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as typeof manifest;
    } catch (err) {
        return { ok: false, code: 'manifest_malformed', message: err instanceof Error ? err.message : 'manifest.json is not valid JSON' };
    }

    let signature: { kid?: string; algorithm?: string; signature_b64?: string; signed_at?: string };
    try {
        signature = JSON.parse(new TextDecoder().decode(sigBytes)) as typeof signature;
    } catch (err) {
        return { ok: false, code: 'signature_malformed', message: err instanceof Error ? err.message : 'manifest.sig is not valid JSON' };
    }
    if (!signature.kid || !signature.signature_b64) {
        return { ok: false, code: 'signature_malformed', message: 'manifest.sig missing kid or signature_b64' };
    }

    // Resolve kid in the trust-keys manifest.
    const tk = input.trustKeysManifest as { keys?: Array<{ kid?: string; public_key_b64?: string; valid_from?: string | null; valid_until?: string | null; revoked_at?: string | null }> };
    if (!tk?.keys || !Array.isArray(tk.keys)) {
        return { ok: false, code: 'trust_keys_invalid', message: 'trust-keys manifest missing keys[]' };
    }
    const keyEntry = tk.keys.find((k) => k.kid === signature.kid);
    if (!keyEntry || !keyEntry.public_key_b64) {
        return { ok: false, code: 'kid_unknown', message: `Bundle signed with kid=${signature.kid} but no matching public key in the trust-keys file.` };
    }
    // Scheduled validity window (valid_from / valid_until). Same honest-
    // rotation cutoff as revoked_at below — `signed_at` is operator-controlled,
    // so it orders honest retirements but does not defend against a compromised
    // key. A windowed key with no signed_at
    // cannot be placed inside its window, so it is a hard fail (the legitimate
    // BundleSigner always emits signed_at).
    if (keyEntry.valid_from || keyEntry.valid_until) {
        if (!signature.signed_at) {
            // Fail closed, but name the bound that cannot be cleared: an upper
            // bound (valid_until) reads as expired; a lower-bound-only key reads
            // as not-yet-valid. Mislabeling both as kid_expired misleads triage.
            const code = keyEntry.valid_until ? 'kid_expired' : 'kid_not_yet_valid';
            return { ok: false, code, message: `Key ${signature.kid} has a validity window but manifest.sig has no signed_at to place it within.` };
        }
        if (keyEntry.valid_from && signature.signed_at < keyEntry.valid_from) {
            return { ok: false, code: 'kid_not_yet_valid', message: `Key ${signature.kid} became valid at ${keyEntry.valid_from}, after bundle's signed_at ${signature.signed_at}.` };
        }
        if (keyEntry.valid_until && keyEntry.valid_until <= signature.signed_at) {
            return { ok: false, code: 'kid_expired', message: `Key ${signature.kid} validity ended at ${keyEntry.valid_until}, on or before bundle's signed_at ${signature.signed_at}.` };
        }
    }
    if (keyEntry.revoked_at) {
        // Revoked keys are usable ONLY for bundles that can prove
        // pre-revocation signing via `signature.signed_at`. An absent
        // `signed_at` is a hard fail — the verifier cannot establish that
        // the bundle pre-dates the revocation moment, so it must reject.
        // The legitimate `BundleSigner` always emits `signed_at`; bundles
        // arriving without it are malformed or crafted to bypass this
        // check.
        if (!signature.signed_at) {
            return { ok: false, code: 'kid_revoked', message: `Key ${signature.kid} is revoked (revoked_at=${keyEntry.revoked_at}); bundle's manifest.sig has no signed_at to prove it was signed before revocation.` };
        }
        if (keyEntry.revoked_at <= signature.signed_at) {
            return { ok: false, code: 'kid_revoked', message: `Key ${signature.kid} was revoked at ${keyEntry.revoked_at}, on or before bundle's signed_at ${signature.signed_at}.` };
        }
    }

    // Verify Ed25519 signature.
    const publicKey = sodium.from_base64(keyEntry.public_key_b64, sodium.base64_variants.URLSAFE_NO_PADDING);
    const sig = sodium.from_base64(signature.signature_b64, sodium.base64_variants.URLSAFE_NO_PADDING);
    const sigOk = sodium.crypto_sign_verify_detached(sig, manifestBytes, publicKey);
    if (!sigOk) {
        return { ok: false, code: 'signature_invalid', message: 'Manifest signature does NOT verify under the resolved public key.' };
    }

    // Verify content hashes.
    if (!manifest.content_hashes) {
        return { ok: false, code: 'manifest_malformed', message: 'manifest.json missing content_hashes' };
    }
    for (const [relPath, expectedHash] of Object.entries(manifest.content_hashes)) {
        const fileBytes = extracted.entries.get(`${extracted.rootDir}/${relPath}`);
        if (!fileBytes) {
            return { ok: false, code: 'content_hash_mismatch', message: `Manifest references missing file: ${relPath}` };
        }
        const actualHex = crypto.createHash('sha256').update(fileBytes).digest('hex');
        if (`sha256:${actualHex}` !== expectedHash) {
            return { ok: false, code: 'content_hash_mismatch', message: `Content hash mismatch for ${relPath}: expected ${expectedHash}, got sha256:${actualHex}` };
        }
    }

    return {
        ok: true,
        traceId: String(manifest.trace_id ?? ''),
        tenant: String(manifest.tenant ?? ''),
        kid: signature.kid,
    };
}

async function extractTarGz(bytes: Uint8Array): Promise<ExtractedFiles> {
    const decompressed = zlib.gunzipSync(Buffer.from(bytes));
    const extract = tar.extract();
    const entries = new Map<string, Uint8Array>();
    let rootDir = '';

    return await new Promise<ExtractedFiles>((resolve, reject) => {
        extract.on('entry', (header, stream, next) => {
            const chunks: Buffer[] = [];
            // `c` is left to inference on purpose. `tar-stream` 3 is built on `streamx`, whose
            // types declare a `data` payload as `unknown` — annotating it `Buffer` is rejected
            // there, and this tree never saw it because its hoisted node_modules resolves
            // different types than the ones this package DECLARES. A byte stream yields Buffers;
            // the assertion says so once, where inference cannot.
            stream.on('data', (c) => chunks.push(c as Buffer));
            stream.on('end', () => {
                const data = new Uint8Array(Buffer.concat(chunks));
                entries.set(header.name, data);
                if (!rootDir && header.name.includes('/')) {
                    rootDir = header.name.slice(0, header.name.indexOf('/'));
                }
                next();
            });
            stream.on('error', reject);
            stream.resume();
        });
        extract.on('finish', () => resolve({ entries, rootDir }));
        extract.on('error', reject);
        extract.end(decompressed);
    });
}
