// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { ZarelAPIError, ZarelAuthError, ZarelTimeoutError } from '@zarel-ai/sdk';
import { printError } from './printers/stderr';

/**
 * Shared error handler for all CLI commands.
 * Sets process.exitCode and prints a user-friendly message.
 */
export function handleCommandError(err: unknown): void {
    if (err instanceof ZarelAuthError) {
        printError(`Authentication failed: ${err.message}`);
        process.exitCode = 1;
        return;
    }
    if (err instanceof ZarelTimeoutError) {
        printError(`Request timed out: ${err.message}`);
        process.exitCode = 1;
        return;
    }
    if (err instanceof ZarelAPIError) {
        printError(`[${err.code}] ${err.message} (status: ${err.status})`);
        if (err.requestId) {
            console.error(`  Request ID: ${err.requestId}`);
        }
        process.exitCode = 1;
        return;
    }
    if (err instanceof Error) {
        printError(err.message);
        process.exitCode = 1;
        return;
    }
    printError(String(err));
    process.exitCode = 1;
}
