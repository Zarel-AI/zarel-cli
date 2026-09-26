// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerContractSpecCommands } from '../contracts';
import { registerEntitiesCommands } from '../entities';
import { registerAuthLlmServiceCommands } from '../auth-llm-service';
import { registerAssistantCommands } from './assistant';

/**
 * `zarel contract ...` — contract-plane commands.
 *
 * All resource families backed by `client.contract.*` live here:
 * spec (apply/diff/publish/snapshot/dry-run), entities, auth-llm-service.
 */
export function registerContractCommands(program: Command): void {
    const contractGroup = program
        .command('contract')
        .description('Contract-plane commands (spec, entities, authorization, ...)');

    registerContractSpecCommands(contractGroup);
    registerEntitiesCommands(contractGroup);
    registerAuthLlmServiceCommands(contractGroup);
    registerAssistantCommands(contractGroup);
}
