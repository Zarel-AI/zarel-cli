// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { resolveTenant, resolveBaseUrl, resolveContractBaseUrl, deriveAdminHost } from '../src/auth';

type ConfigMock = {
    loadConfig: jest.Mock;
};

jest.mock('../src/config', () => ({
    loadConfig: jest.fn().mockReturnValue({}),
}));

const configMock: ConfigMock = jest.requireMock('../src/config');

describe('auth', () => {
    const origEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...origEnv };
        configMock.loadConfig.mockReturnValue({});
    });

    describe('resolveTenant', () => {
        it('returns ZAREL_TENANT env var when set', () => {
            process.env.ZAREL_TENANT = 'env-tenant';
            expect(resolveTenant()).toBe('env-tenant');
        });

        it('returns config tenant when env var not set', () => {
            delete process.env.ZAREL_TENANT;
            configMock.loadConfig.mockReturnValue({ tenant: 'config-tenant' });
            expect(resolveTenant()).toBe('config-tenant');
        });

        it('returns undefined when neither set', () => {
            delete process.env.ZAREL_TENANT;
            configMock.loadConfig.mockReturnValue({});
            expect(resolveTenant()).toBeUndefined();
        });
    });

    describe('resolveBaseUrl', () => {
        it('returns ZAREL_BASE_URL env var when set', () => {
            process.env.ZAREL_BASE_URL = 'https://custom.api.com/v1';
            expect(resolveBaseUrl()).toBe('https://custom.api.com/v1');
        });

        it('returns undefined when not set', () => {
            delete process.env.ZAREL_BASE_URL;
            configMock.loadConfig.mockReturnValue({});
            expect(resolveBaseUrl()).toBeUndefined();
        });
    });

    // Contract-plane base URL resolution.
    describe('resolveContractBaseUrl', () => {
        afterEach(() => {
            delete process.env.ZAREL_CONTRACT_API_URL;
            delete process.env.ZAREL_BASE_URL;
        });

        it('returns ZAREL_CONTRACT_API_URL env var when set', () => {
            process.env.ZAREL_CONTRACT_API_URL = 'https://acme.admin.zarel.ai/v1';
            expect(resolveContractBaseUrl()).toBe('https://acme.admin.zarel.ai/v1');
        });

        it('returns config contractBaseUrl when env var not set', () => {
            configMock.loadConfig.mockReturnValue({
                contractBaseUrl: 'https://config.admin.example.com/v1',
            });
            expect(resolveContractBaseUrl()).toBe('https://config.admin.example.com/v1');
        });

        it('auto-derives from ZAREL_BASE_URL by inserting `.admin.`', () => {
            process.env.ZAREL_BASE_URL = 'https://acme.zarel.ai/v1';
            expect(resolveContractBaseUrl()).toBe('https://acme.admin.zarel.ai/v1');
        });

        it('auto-derives from config baseUrl', () => {
            configMock.loadConfig.mockReturnValue({ baseUrl: 'https://test.zarel.local/v1' });
            expect(resolveContractBaseUrl()).toBe('https://test.admin.zarel.local/v1');
        });

        it('returns undefined when neither contract nor runtime URL is set', () => {
            configMock.loadConfig.mockReturnValue({});
            expect(resolveContractBaseUrl()).toBeUndefined();
        });

        it('returns undefined when hostname has no dots', () => {
            process.env.ZAREL_BASE_URL = 'http://localhost:3001/v1';
            expect(resolveContractBaseUrl()).toBeUndefined();
        });

        it('env var takes priority over config and derivation', () => {
            process.env.ZAREL_CONTRACT_API_URL = 'https://override.admin.zarel.ai/v1';
            process.env.ZAREL_BASE_URL = 'https://other.zarel.ai/v1';
            configMock.loadConfig.mockReturnValue({
                contractBaseUrl: 'https://config.admin.example.com/v1',
            });
            expect(resolveContractBaseUrl()).toBe('https://override.admin.zarel.ai/v1');
        });
    });

    describe('deriveAdminHost', () => {
        it('inserts `.admin.` after the first dot in the hostname', () => {
            expect(deriveAdminHost('https://acme.zarel.ai/v1'))
                .toBe('https://acme.admin.zarel.ai/v1');
        });

        it('preserves the path', () => {
            expect(deriveAdminHost('https://acme.zarel.ai/v1/contracts'))
                .toBe('https://acme.admin.zarel.ai/v1/contracts');
        });

        it('preserves the port', () => {
            expect(deriveAdminHost('https://acme.zarel.local:8443/v1'))
                .toBe('https://acme.admin.zarel.local:8443/v1');
        });

        it('preserves the scheme', () => {
            expect(deriveAdminHost('http://acme.zarel.local/v1'))
                .toBe('http://acme.admin.zarel.local/v1');
        });

        it('returns undefined for hostnames with no dots', () => {
            expect(deriveAdminHost('http://localhost:3001/v1')).toBeUndefined();
        });

        it('returns undefined for unparseable input', () => {
            expect(deriveAdminHost('not-a-url')).toBeUndefined();
        });
    });
});
