// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import type { OutputFormat } from '../output-format';

const OUTPUT_FORMATS: readonly OutputFormat[] = ['table', 'json', 'yaml'];

export function parseOutputFormat(format: string): OutputFormat {
    if (isOutputFormat(format)) {
        return format;
    }
    throw new Error(`Invalid output format: ${format}. Valid formats: ${OUTPUT_FORMATS.join(', ')}`);
}

export function isOutputFormat(format: string): format is OutputFormat {
    return OUTPUT_FORMATS.includes(format as OutputFormat);
}
