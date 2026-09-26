// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
export function formatJson(data: unknown): string {
    return JSON.stringify(data, null, 2);
}
