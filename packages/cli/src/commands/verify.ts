// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import * as fs from 'node:fs';
import { Command } from 'commander';
import { handleCommandError } from '../error-handler';
import { printStdout, printStderr } from '../printers/stdout';
import { verifyBundle } from '../lib/bundle-verifier';
import { verifyAuditBundle, renderAnchoring, renderNonEquivocation, parseWitnessPolicy, type AnchoringOutcome, type NonEquivocationOutcome } from '../lib/audit-bundle-verifier';

/** Parse one-or-more PEM CERTIFICATE blocks into DER bytes (pinned TSA roots). */
function parsePemCerts(pem: string): Uint8Array[] {
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    return blocks.map((block) => {
        const body = block.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
        return new Uint8Array(Buffer.from(body, 'base64'));
    });
}

/** Print the anchoring outcome; returns false on a tamper (caller exits non-zero). */
function printAnchoring(anchoring: AnchoringOutcome): boolean {
    const { stdout, stderr, ok } = renderAnchoring(anchoring);
    stdout.forEach(printStdout);
    stderr.forEach(printStderr);
    return ok;
}

/** Print the transparency-log outcome; returns false on a tamper (caller exits non-zero). */
function printNonEquivocation(outcome: NonEquivocationOutcome): boolean {
    const { stdout, stderr, ok } = renderNonEquivocation(outcome);
    stdout.forEach(printStdout);
    stderr.forEach(printStderr);
    return ok;
}

/**
 * `zarel verify <bundle-path>` — verify a trace evidence bundle or an audit
 * tamper-evidence bundle.
 *
 * Standalone (offline) verifier. Reads the .tar.gz; if it is an AUDIT evidence
 * bundle (contains events.json) it recomputes the hash-chain + validates the
 * checkpoints via the L0 `verifyChain`, reporting any tampering at the exact
 * sequence position. Otherwise it falls back to the trace-bundle integrity
 * check. Exits 0 on success; 1 on any failure.
 *
 * Defensive design: NO HTTP calls. The trust-keys path is supplied via
 * `--keys <path>` (typically the file written by `zarel trust-keys fetch`).
 */
export function registerVerifyCommand(program: Command): void {
    program
        .command('verify <bundle>')
        .description('Verify an evidence bundle offline (trace bundles and audit bundles)')
        .requiredOption('--keys <path>', 'Path to a trust-keys manifest JSON file')
        .option('--tsa-roots <path>', 'Path to pinned RFC 3161 TSA root certificate(s) (PEM) to verify external timestamp anchoring')
        .option('--witness-policy <path>', 'Path to a named witness-policy JSON to verify transparency-log non-equivocation')
        .option('--revocation <mode>', 'Revocation policy: "lenient" (honest-degraded, default) or "strict" (compliance: every anchored/renewal token must carry a positive non-revocation proof)', 'lenient')
        .action(async (bundlePath: string, opts: { keys: string; tsaRoots?: string; witnessPolicy?: string; revocation: string }) => {
            try {
                if (opts.revocation !== 'lenient' && opts.revocation !== 'strict') {
                    throw new Error('--revocation must be "lenient" or "strict"');
                }
                const revocationPolicy = opts.revocation;
                const bundleBytes = new Uint8Array(fs.readFileSync(bundlePath));
                const trustKeysJson: unknown = JSON.parse(fs.readFileSync(opts.keys, 'utf8'));
                const pinnedTsaRoots = opts.tsaRoots ? parsePemCerts(fs.readFileSync(opts.tsaRoots, 'utf8')) : [];
                const witnessPolicy = opts.witnessPolicy ? parseWitnessPolicy(JSON.parse(fs.readFileSync(opts.witnessPolicy, 'utf8'))) : null;

                const audit = await verifyAuditBundle({ bundleBytes, trustKeysManifest: trustKeysJson, pinnedTsaRoots, witnessPolicy, revocationPolicy });

                if (audit.isAuditBundle && audit.verdict) {
                    const { verdict, integrity } = audit;
                    if (!integrity.ok) {
                        printStderr(`✗ Bundle integrity failed: ${integrity.code}`);
                        printStderr(`  ${integrity.message}`);
                        process.exitCode = 1;
                        return;
                    }
                    if (verdict.ok) {
                        const range = verdict.coveredRange;
                        if (verdict.checkpointsVerified === 0) {
                            // Internally consistent but NOT attested — no signed
                            // checkpoint vouches for this chain yet. Honest framing:
                            // do not let an auditor read this as cryptographically signed.
                            printStdout(`⚠ Audit chain ${bundlePath} is internally consistent but UNATTESTED.`);
                            printStdout(`  Covered seq: ${range ? `${range.from}..${range.to}` : '(empty)'}`);
                            printStdout('  Checkpoints verified: 0 — no signature covers this chain yet (pending checkpoint).');
                        } else {
                            printStdout(`✓ Audit chain ${bundlePath} verified and attested.`);
                            printStdout(`  Covered seq: ${range ? `${range.from}..${range.to}` : '(empty)'}`);
                            printStdout(`  Checkpoints verified: ${verdict.checkpointsVerified}`);
                            if (verdict.keyKid) printStdout(`  Signed by: ${verdict.keyKid}`);
                            // Terminality is proven from the SIGNATURE, offline.
                            if (verdict.terminal) {
                                printStdout(
                                    verdict.terminal.kind === 'empty_chain'
                                        ? '  ⛔ Terminally sealed (EMPTY chain — signed "no events ever existed").'
                                        : '  ⛔ Terminally sealed — this chain is closed; no further events can be appended.',
                                );
                            }
                        }
                    } else {
                        printStderr(`✗ Audit chain verification FAILED (${verdict.failures.length} anomalies):`);
                        for (const f of verdict.failures) {
                            printStderr(`  seq ${f.seq}: ${f.reason}`);
                        }
                        process.exitCode = 1;
                    }

                    // Anchoring is a separable assurance — reported even
                    // when chain verification failed; a tampered anchor exits non-zero.
                    if (!printAnchoring(audit.anchoring)) {
                        process.exitCode = 1;
                    }
                    // Transparency-log non-equivocation — also separable;
                    // a tampered proof / forged cosignature exits non-zero, a sub-floor or
                    // absent policy degrades to the TSA anchor label (exit 0).
                    if (!printNonEquivocation(audit.nonEquivocation)) {
                        process.exitCode = 1;
                    }
                    return;
                }

                // Trace bundle fallback.
                const result = await verifyBundle({ bundleBytes, trustKeysManifest: trustKeysJson });
                if (result.ok) {
                    printStdout(`✓ Bundle ${bundlePath} verified.`);
                    printStdout(`  Trace:  ${result.traceId}`);
                    printStdout(`  Tenant: ${result.tenant}`);
                    printStdout(`  Signed by: ${result.kid}`);
                } else {
                    printStderr(`✗ Verification failed: ${result.code}`);
                    printStderr(`  ${result.message}`);
                    process.exitCode = 1;
                }
            } catch (err) {
                handleCommandError(err);
            }
        });
}
