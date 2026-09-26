// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * The CLI's locale resolution precedence chain.
 *
 * Verifies the chain: --locale flag → ZAREL_LOCALE env → config → undefined.
 * Also verifies the entities + tools commands forward the resolved locale
 * into the SDK call.
 */

import { Command } from 'commander';

// Mock loadConfig BEFORE importing the modules that consume it.
const mockLoadConfig = jest.fn();
jest.mock('../src/config', () => ({
    loadConfig: (): unknown => mockLoadConfig(),
    isValidConfigKey: jest.fn(() => true),
    getConfigPath: jest.fn(() => '/tmp/zarel-test/config.json'),
    saveConfig: jest.fn(),
    getConfigValue: jest.fn(),
    setConfigValue: jest.fn(),
    deleteConfigValue: jest.fn(),
    listConfigValues: jest.fn(),
}));

const mockEntities = {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
    get: jest.fn().mockResolvedValue({ success: true, data: { name: 'tickets' } }),
    create: jest.fn().mockResolvedValue({ success: true, data: {} }),
    recompute: jest.fn().mockResolvedValue({ success: true, data: {} }),
};
const mockTools = {
    list: jest.fn().mockResolvedValue({ success: true }),
    mcp: jest.fn().mockResolvedValue({ success: true }),
    call: jest.fn().mockResolvedValue({ success: true }),
};
jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { tools: mockTools },
        contract: { entities: mockEntities },
    })),
}));
jest.mock('../src/printers/output', () => ({ printOutput: jest.fn() }));

import { resolveLocale } from '../src/auth';
import { registerEntitiesCommands } from '../src/commands/entities';
import { registerToolsCommands } from '../src/commands/tools';

describe('CLI locale resolution', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.ZAREL_LOCALE;
        mockLoadConfig.mockReturnValue({});
        process.exitCode = undefined;
    });

    describe('resolveLocale precedence chain', () => {
        it('returns undefined when nothing is set', () => {
            expect(resolveLocale()).toBeUndefined();
        });

        it('returns the per-command flag when supplied', () => {
            expect(resolveLocale('es')).toBe('es');
        });

        it('returns ZAREL_LOCALE when no flag', () => {
            process.env.ZAREL_LOCALE = 'es';
            expect(resolveLocale()).toBe('es');
        });

        it('returns config.locale when no flag and no env', () => {
            mockLoadConfig.mockReturnValue({ locale: 'es' });
            expect(resolveLocale()).toBe('es');
        });

        it('flag overrides env', () => {
            process.env.ZAREL_LOCALE = 'es';
            expect(resolveLocale('en')).toBe('en');
        });

        it('flag overrides config', () => {
            mockLoadConfig.mockReturnValue({ locale: 'es' });
            expect(resolveLocale('en')).toBe('en');
        });

        it('env overrides config', () => {
            process.env.ZAREL_LOCALE = 'en';
            mockLoadConfig.mockReturnValue({ locale: 'es' });
            expect(resolveLocale()).toBe('en');
        });
    });

    describe('entities list command forwards resolved locale', () => {
        it('omits locale arg to SDK when nothing set', async () => {
            const program = new Command();
            registerEntitiesCommands(program);
            await program.parseAsync(['node', 'zarel', 'entities', 'list']);
            expect(mockEntities.list).toHaveBeenCalledWith();
        });

        it('forwards --locale flag value to SDK', async () => {
            const program = new Command();
            registerEntitiesCommands(program);
            await program.parseAsync(['node', 'zarel', 'entities', 'list', '--locale', 'es']);
            expect(mockEntities.list).toHaveBeenCalledWith({ locale: 'es' });
        });

        it('forwards ZAREL_LOCALE to SDK when no flag', async () => {
            process.env.ZAREL_LOCALE = 'es';
            const program = new Command();
            registerEntitiesCommands(program);
            await program.parseAsync(['node', 'zarel', 'entities', 'list']);
            expect(mockEntities.list).toHaveBeenCalledWith({ locale: 'es' });
        });
    });

    describe('tools list command forwards resolved locale', () => {
        it('forwards --locale flag value to SDK', async () => {
            const program = new Command();
            registerToolsCommands(program);
            await program.parseAsync(['node', 'zarel', 'tools', 'list', '--locale', 'es']);
            expect(mockTools.list).toHaveBeenCalledWith({ locale: 'es' });
        });

        it('forwards --locale flag to tools mcp too', async () => {
            const program = new Command();
            registerToolsCommands(program);
            await program.parseAsync(['node', 'zarel', 'tools', 'mcp', '--locale', 'es']);
            expect(mockTools.mcp).toHaveBeenCalledWith({ locale: 'es' });
        });
    });
});
