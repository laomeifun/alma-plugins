/**
 * JSON Schema Sanitizer for Antigravity API
 *
 * Claude/Gemini in VALIDATED mode rejects certain JSON Schema features.
 * This sanitizer removes or converts unsupported constraints to description hints.
 *
 * Based on opencode-antigravity-auth's cleanJSONSchemaForAntigravity.
 */

import type { GeminiTool, GeminiFunctionDeclaration } from './types';

// Unsupported constraint keywords that should be moved to description hints
const UNSUPPORTED_CONSTRAINTS = [
    'minLength', 'maxLength', 'exclusiveMinimum', 'exclusiveMaximum',
    'pattern', 'minItems', 'maxItems', 'format',
    'default', 'examples',
] as const;

// Keywords that should be removed entirely
const UNSUPPORTED_KEYWORDS = [
    ...UNSUPPORTED_CONSTRAINTS,
    '$schema', '$defs', 'definitions', 'const', '$ref', 'additionalProperties',
    'propertyNames', 'title', '$id', '$comment',
] as const;

type SchemaObject = Record<string, unknown>;

/**
 * Check if value is a plain object
 */
function isPlainObject(value: unknown): value is SchemaObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Appends a hint to a schema's description field.
 */
function appendDescriptionHint(schema: SchemaObject, hint: string): SchemaObject {
    const existing = typeof schema.description === 'string' ? schema.description : '';
    const newDescription = existing ? `${existing} (${hint})` : hint;
    return { ...schema, description: newDescription };
}

/**
 * Moves unsupported constraints to description hints.
 * { minLength: 1, maxLength: 100 } → adds "(minLength: 1) (maxLength: 100)" to description
 */
function moveConstraintsToDescription(schema: unknown): unknown {
    if (!isPlainObject(schema)) {
        return schema;
    }

    if (Array.isArray(schema)) {
        return schema.map(item => moveConstraintsToDescription(item));
    }

    let result: SchemaObject = { ...schema };

    // Move constraint values to description
    for (const constraint of UNSUPPORTED_CONSTRAINTS) {
        if (result[constraint] !== undefined && typeof result[constraint] !== 'object') {
            result = appendDescriptionHint(result, `${constraint}: ${result[constraint]}`);
        }
    }

    // Recursively process nested objects
    for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'object' && value !== null) {
            result[key] = moveConstraintsToDescription(value);
        }
    }

    return result;
}

/**
 * Removes unsupported keywords from schema.
 */
function removeUnsupportedKeywords(schema: unknown, insideProperties: boolean = false): unknown {
    if (!isPlainObject(schema)) {
        return schema;
    }

    if (Array.isArray(schema)) {
        return schema.map(item => removeUnsupportedKeywords(item, false));
    }

    const result: SchemaObject = {};
    for (const [key, value] of Object.entries(schema)) {
        // Skip unsupported keywords (unless we're inside properties where keys are property names)
        if (!insideProperties && (UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) {
            continue;
        }

        if (typeof value === 'object' && value !== null) {
            if (key === 'properties') {
                const propertiesResult: SchemaObject = {};
                for (const [propName, propSchema] of Object.entries(value as object)) {
                    propertiesResult[propName] = removeUnsupportedKeywords(propSchema, false);
                }
                result[key] = propertiesResult;
            } else {
                result[key] = removeUnsupportedKeywords(value, false);
            }
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Cleans a JSON schema for Antigravity API compatibility.
 * Transforms unsupported features into description hints.
 */
export function cleanJSONSchemaForAntigravity(schema: unknown): unknown {
    if (!isPlainObject(schema)) {
        return schema;
    }

    let result = schema;

    // Phase 1: Move constraints to description hints
    result = moveConstraintsToDescription(result) as SchemaObject;

    // Phase 2: Remove unsupported keywords
    result = removeUnsupportedKeywords(result) as SchemaObject;

    return result;
}

/**
 * Sanitize tools array for Antigravity API.
 * Cleans function declaration parameters schemas.
 */
export function sanitizeToolsForAntigravity(tools: GeminiTool[] | undefined): GeminiTool[] | undefined {
    if (!tools || tools.length === 0) {
        return tools;
    }

    return tools.map(tool => {
        if (!tool.functionDeclarations) {
            return tool;
        }

        const sanitizedDeclarations: GeminiFunctionDeclaration[] = tool.functionDeclarations.map(func => {
            if (!func.parameters) {
                return func;
            }

            return {
                ...func,
                parameters: cleanJSONSchemaForAntigravity(func.parameters) as Record<string, unknown>,
            };
        });

        return {
            ...tool,
            functionDeclarations: sanitizedDeclarations,
        };
    });
}
