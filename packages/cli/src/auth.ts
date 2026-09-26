// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { loadConfig } from './config';

/**
 * Resolve the runtime-plane JWT (`token_class: tenant`) used by
 * `client.runtime.*`.
 *
 * Priority:
 *   1. ZAREL_RUNTIME_TOKEN env var
 *   2. config file `runtimeToken` key
 *   3. undefined — SDK throws `ZarelAuthError` at call time
 */
export function resolveRuntimeToken(): string | undefined {
    return process.env.ZAREL_RUNTIME_TOKEN || loadConfig().runtimeToken || undefined;
}

/**
 * Resolve the contract-plane JWT (`token_class: contract`) used by
 * `client.contract.*`.
 *
 * Priority:
 *   1. ZAREL_CONTRACT_TOKEN env var
 *   2. config file `contractToken` key
 *   3. undefined — SDK throws `ZarelAuthError` at call time
 */
export function resolveContractToken(): string | undefined {
    return process.env.ZAREL_CONTRACT_TOKEN || loadConfig().contractToken || undefined;
}

/**
 * Resolve the tenant slug.
 * Priority: ZAREL_TENANT env var → config file → undefined.
 */
export function resolveTenant(): string | undefined {
    return process.env.ZAREL_TENANT ?? loadConfig().tenant;
}

/**
 * Resolve the base URL.
 * Priority: ZAREL_BASE_URL env var → config file → undefined (SDK default).
 */
export function resolveBaseUrl(): string | undefined {
    return process.env.ZAREL_BASE_URL ?? loadConfig().baseUrl;
}

/**
 * Resolve the contract-plane API base URL.
 *
 * Priority:
 *   1. ZAREL_CONTRACT_API_URL env var
 *   2. config file `contractBaseUrl` key
 *   3. auto-derive from the runtime base URL by inserting `.admin.`
 *   4. undefined — SDK throws `ZarelAuthError` at call time
 */
export function resolveContractBaseUrl(): string | undefined {
    const envValue = process.env.ZAREL_CONTRACT_API_URL;
    if (envValue) return envValue;
    const config = loadConfig();
    if (config.contractBaseUrl) return config.contractBaseUrl;

    const runtimeBaseUrl = resolveBaseUrl();
    if (!runtimeBaseUrl) return undefined;
    return deriveAdminHost(runtimeBaseUrl);
}

/**
 * Inject `.admin.` into the hostname portion of a URL after the first
 * dot. Returns undefined when the URL is unparseable or the hostname has
 * no dots (no parent zone to admin-prefix).
 *
 * Preserves scheme, port, and path exactly as given — string-based
 * insertion avoids the trailing-slash quirks of `URL.toString()`.
 *
 * Exported for unit-test access; not part of the public CLI surface.
 */
export function deriveAdminHost(baseUrl: string): string | undefined {
    // Match scheme://hostname(:port)?(rest)?  — capture each piece.
    const m = baseUrl.match(/^([a-z][a-z0-9+\-.]*:\/\/)([^/:]+)(.*)$/i);
    if (!m) return undefined;
    const [, scheme, host, rest] = m;
    if (host === undefined || scheme === undefined) return undefined;
    const firstDot = host.indexOf('.');
    if (firstDot === -1) return undefined;
    const sub = host.slice(0, firstDot);
    const zone = host.slice(firstDot + 1);
    return `${scheme}${sub}.admin.${zone}${rest ?? ''}`;
}

/**
 * Resolve the locale.
 *
 * Priority:
 *   1. per-command --locale flag
 *   2. ZAREL_LOCALE env var
 *   3. config file `locale` key
 *   4. undefined — server applies its own resolution
 */
export function resolveLocale(flagValue?: string): string | undefined {
    if (flagValue) return flagValue;
    const env = process.env.ZAREL_LOCALE;
    if (env) return env;
    const config = loadConfig();
    return config.locale;
}
