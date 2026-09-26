// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { ZarelAPIError, ZarelAuthError, ZarelTimeoutError } from '@zarel-ai/sdk';
import { handleCommandError } from '../src/error-handler';

describe('handleCommandError', () => {
    let errorSpy: jest.SpyInstance;
    let errorOutput: string[];

    beforeEach(() => {
        errorOutput = [];
        errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            errorOutput.push(args.map(String).join(' '));
        });
        process.exitCode = undefined;
    });

    afterEach(() => {
        errorSpy.mockRestore();
        process.exitCode = undefined;
    });

    it('handles ZarelAuthError', () => {
        handleCommandError(new ZarelAuthError('bad token', 'unauthorized'));
        expect(errorOutput[0]).toContain('Authentication failed');
        expect(process.exitCode).toBe(1);
    });

    it('handles ZarelTimeoutError', () => {
        handleCommandError(new ZarelTimeoutError(30000));
        expect(errorOutput[0]).toContain('30000');
        expect(process.exitCode).toBe(1);
    });

    it('handles ZarelAPIError with request ID', () => {
        const err = new ZarelAPIError(404, 'not_found', 'NOT_FOUND', 'Resource not found', 'req-abc');
        handleCommandError(err);
        expect(errorOutput[0]).toContain('NOT_FOUND');
        expect(errorOutput[0]).toContain('404');
        expect(errorOutput.some(l => l.includes('req-abc'))).toBe(true);
        expect(process.exitCode).toBe(1);
    });

    it('handles generic Error', () => {
        handleCommandError(new Error('something broke'));
        expect(errorOutput[0]).toContain('something broke');
        expect(process.exitCode).toBe(1);
    });

    it('handles non-Error', () => {
        handleCommandError('raw string error');
        expect(errorOutput[0]).toContain('raw string error');
        expect(process.exitCode).toBe(1);
    });
});
