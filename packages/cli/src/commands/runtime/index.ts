// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerConversationCommands } from '../conversation';
import { registerToolsCommands } from '../tools';
import { registerRecordsCommands } from '../records';
import { registerStateMachineCommands } from '../state-machine';
import { registerActionsCommands } from '../actions';
import { registerEventsCommands } from '../events';
import { registerRoleAssignmentsCommands } from '../role-assignments';
import { registerLlmServiceCommands } from '../llm-service';
import { registerLlmCredentialCommands } from '../llm-credential';
import { registerEmbeddingCredentialCommands } from '../embedding-credential';
import { registerImportCommands } from '../imports';
import { registerTraceCommands } from '../trace';
import { registerAuthorizationsCommands } from '../authorizations';
import { registerRuntimeEntitiesCommands } from '../runtime-entities';
import { registerMcpCommands } from './mcp';

/**
 * `zarel runtime ...` — runtime-plane commands.
 *
 * All resource families backed by `client.runtime.*` live here:
 * conversation, tools, records, state-machine (incl. replay), actions, events,
 * role-assignments, llm-service, llm-credential, imports, trace,
 * authorizations (effective-authorizations introspection).
 */
export function registerRuntimeCommands(program: Command): void {
    const runtimeGroup = program
        .command('runtime')
        .description('Runtime-plane commands (records, conversation, tools, events, ...)');

    registerConversationCommands(runtimeGroup);
    registerToolsCommands(runtimeGroup);
    registerRecordsCommands(runtimeGroup);
    registerStateMachineCommands(runtimeGroup);
    registerActionsCommands(runtimeGroup);
    registerEventsCommands(runtimeGroup);
    registerRoleAssignmentsCommands(runtimeGroup);
    registerLlmServiceCommands(runtimeGroup);
    registerLlmCredentialCommands(runtimeGroup);
    registerEmbeddingCredentialCommands(runtimeGroup);
    registerImportCommands(runtimeGroup);
    registerTraceCommands(runtimeGroup);
    registerAuthorizationsCommands(runtimeGroup);
    registerRuntimeEntitiesCommands(runtimeGroup);
    registerMcpCommands(runtimeGroup);
}
