// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Zarel } from '@zarel-ai/sdk';
import type { Interceptors } from '@zarel-ai/sdk';
import {
    resolveRuntimeToken,
    resolveContractToken,
    resolveTenant,
    resolveBaseUrl,
    resolveContractBaseUrl,
} from './auth';

/**
 * When `ZAREL_DEBUG` is set, log each HTTP attempt to stderr via the SDK's request
 * interceptors (stdout stays clean for command output). Returns undefined when
 * unset so the client carries no interceptors.
 */
export function debugInterceptors(): Interceptors | undefined {
    if (!process.env.ZAREL_DEBUG) return undefined;
    const write = (line: string): void => { process.stderr.write(`${line}\n`); };
    return {
        onRequest: (ctx): void => write(`→ ${ctx.method} ${ctx.url} (attempt ${ctx.attempt})`),
        onResponse: (ctx): void => write(`← ${ctx.status} ${ctx.url} (attempt ${ctx.attempt})`),
        onError: (ctx): void => write(
            `✗ ${ctx.method} ${ctx.url} (attempt ${ctx.attempt}): ${ctx.error instanceof Error ? ctx.error.message : String(ctx.error)}`,
        ),
    };
}

/**
 * The CLI's resolved client options. Token fields are plain strings (the CLI
 * resolves a static token from env/config, never a provider), and the shape is
 * assignable to the SDK's `ZarelOptions`.
 */
interface CliClientOptions {
    tenant?: string;
    runtimeToken?: string;
    contractToken?: string;
    runtimeBaseUrl?: string;
    contractBaseUrl?: string;
    interceptors?: Interceptors;
    apiVersion?: string;
}

/** Compose the SDK client options from the resolved CLI config + env. */
export function buildClientOptions(): CliClientOptions {
    const tenant = resolveTenant();
    const runtimeToken = resolveRuntimeToken();
    const contractToken = resolveContractToken();
    const runtimeBaseUrl = resolveBaseUrl();
    const contractBaseUrl = resolveContractBaseUrl();
    const interceptors = debugInterceptors();
    const apiVersion = process.env.ZAREL_API_VERSION;

    return {
        ...(tenant !== undefined ? { tenant } : {}),
        ...(runtimeToken !== undefined ? { runtimeToken } : {}),
        ...(contractToken !== undefined ? { contractToken } : {}),
        ...(runtimeBaseUrl !== undefined ? { runtimeBaseUrl } : {}),
        ...(contractBaseUrl !== undefined ? { contractBaseUrl } : {}),
        ...(interceptors !== undefined ? { interceptors } : {}),
        ...(apiVersion !== undefined && apiVersion !== '' ? { apiVersion } : {}),
    };
}

export function createClient(): Zarel {
    return new Zarel(buildClientOptions());
}
