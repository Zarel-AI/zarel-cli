// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
// G4/G5 CLI payoff — debug request logging via interceptors + ZAREL_API_VERSION.
import { buildClientOptions, debugInterceptors } from '../src/client';

jest.mock('../src/config', () => ({
    ...jest.requireActual('../src/config'),
    loadConfig: jest.fn().mockReturnValue({}),
}));

const ENV_KEYS = ['ZAREL_DEBUG', 'ZAREL_API_VERSION', 'ZAREL_TENANT', 'ZAREL_RUNTIME_TOKEN', 'ZAREL_CONTRACT_TOKEN', 'ZAREL_BASE_URL', 'ZAREL_CONTRACT_API_URL'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
});

describe('debugInterceptors', () => {
    it('returns undefined when ZAREL_DEBUG is unset', () => {
        expect(debugInterceptors()).toBeUndefined();
    });

    it('returns request/response/error hooks when ZAREL_DEBUG is set', () => {
        process.env.ZAREL_DEBUG = '1';
        const i = debugInterceptors();
        expect(i?.onRequest).toBeInstanceOf(Function);
        expect(i?.onResponse).toBeInstanceOf(Function);
        expect(i?.onError).toBeInstanceOf(Function);
    });

    it('logs to stderr (not stdout)', () => {
        process.env.ZAREL_DEBUG = '1';
        const err = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
        const i = debugInterceptors();
        // The hooks are synchronous here; `void` satisfies no-floating-promises
        // (the declared hook return type is `void | Promise<void>`).
        void i?.onRequest?.({ method: 'GET', url: 'https://x/v1/runtime/records/plans', headers: {}, attempt: 0 });
        void i?.onResponse?.({ method: 'GET', url: 'https://x/v1/runtime/records/plans', status: 200, attempt: 0 });
        void i?.onError?.({ method: 'GET', url: 'https://x/v1/runtime/records/plans', error: new Error('ECONNRESET'), attempt: 1 });
        const lines = err.mock.calls.map((c) => String(c[0]));
        expect(lines[0]).toContain('→ GET https://x/v1/runtime/records/plans (attempt 0)');
        expect(lines[1]).toContain('← 200 https://x/v1/runtime/records/plans (attempt 0)');
        expect(lines[2]).toContain('✗ GET https://x/v1/runtime/records/plans (attempt 1): ECONNRESET');
    });
});

describe('buildClientOptions', () => {
    it('omits interceptors and apiVersion by default', () => {
        const opts = buildClientOptions();
        expect(opts.interceptors).toBeUndefined();
        expect(opts.apiVersion).toBeUndefined();
    });

    it('includes apiVersion when ZAREL_API_VERSION is set', () => {
        process.env.ZAREL_API_VERSION = '2026-06-01';
        expect(buildClientOptions().apiVersion).toBe('2026-06-01');
    });

    it('includes interceptors when ZAREL_DEBUG is set', () => {
        process.env.ZAREL_DEBUG = '1';
        expect(buildClientOptions().interceptors).toBeDefined();
    });
});
