// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * Minimal subdomain-origin builder, inlined so the publishable `zarel` CLI
 * carries NO dependency on an unpublished package. Faithful to
 * core's env-var contract (`ZAREL_BASE_DOMAIN`, `ZAREL_PUBLIC_PROTOCOL`) so the
 * generated bundle README footer resolves the same docs URL it always has.
 */

const DEFAULT_BASE_DOMAIN = 'zarel.local';
const DEFAULT_PROTOCOL = 'https';

function getBaseDomain(): string {
    const raw = process.env.ZAREL_BASE_DOMAIN ?? DEFAULT_BASE_DOMAIN;
    return raw.replace(/^\./, '').replace(/\/+$/, '');
}

function getPublicProtocol(): string {
    return process.env.ZAREL_PUBLIC_PROTOCOL ?? DEFAULT_PROTOCOL;
}

/** `${protocol}://${subdomain}.${baseDomain}` — no trailing path. */
export function buildSubdomainOrigin(subdomain: string): string {
    return `${getPublicProtocol()}://${subdomain}.${getBaseDomain()}`;
}
