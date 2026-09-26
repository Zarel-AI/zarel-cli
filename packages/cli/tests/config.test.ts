// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { isValidConfigKey } from '../src/config';
import { registerConfigCommands } from '../src/commands/config';

jest.mock('../src/config', () => {
    const actualConfig: typeof import('../src/config') = jest.requireActual('../src/config');
    return {
        ...actualConfig,
        loadConfig: jest.fn().mockReturnValue({}),
        saveConfig: jest.fn(),
        getConfigValue: jest.fn(),
        setConfigValue: jest.fn(),
        deleteConfigValue: jest.fn(),
        listConfig: jest.fn().mockReturnValue({}),
        getConfigPath: jest.fn().mockReturnValue('/home/user/.zarel/config.json'),
    };
});

describe('config', () => {
    it('validates config keys', () => {
        expect(isValidConfigKey('runtimeToken')).toBe(true);
        expect(isValidConfigKey('contractToken')).toBe(true);
        expect(isValidConfigKey('tenant')).toBe(true);
        expect(isValidConfigKey('baseUrl')).toBe(true);
        expect(isValidConfigKey('token')).toBe(false);
        expect(isValidConfigKey('foo')).toBe(false);
        expect(isValidConfigKey('')).toBe(false);
    });

    describe('token masking', () => {
        let consoleSpy: jest.SpyInstance;
        let output: string[];

        beforeEach(() => {
            output = [];
            consoleSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
                output.push(args.map(String).join(' '));
            });
        });

        afterEach(() => {
            consoleSpy.mockRestore();
        });

        it('masks short tokens fully without appending ellipsis', async () => {

            const configModule = jest.requireMock('../src/config');

            (configModule.setConfigValue as jest.Mock).mockImplementation(() => undefined);

            const program = new Command();
            registerConfigCommands(program);
            await program.parseAsync(['config', 'set', 'runtimeToken', 'abc'], { from: 'user' });

            expect(output[0]).toContain('***');
            expect(output[0]).not.toContain('abc...');
        });

        it('truncates long tokens with ellipsis', async () => {

            const configModule = jest.requireMock('../src/config');

            (configModule.setConfigValue as jest.Mock).mockImplementation(() => undefined);

            const program = new Command();
            registerConfigCommands(program);
            await program.parseAsync(['config', 'set', 'contractToken', 'averylongtokenthatexceedseight'], { from: 'user' });

            expect(output[0]).toContain('...');
            expect(output[0]).not.toContain('averylongtokenthatexceedseight');
        });
    });
});
