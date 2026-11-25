const operations = new Set(['read', 'write', 'delete', 'has', 'list', 'clear'])

/** Validate the shared request contract and return normalized relative path segments. */
export function validateRequest({ operation, kind, path } = {}) {
    if (!operations.has(operation)) throw new Error(`Unsupported disk operation: ${operation}`)

    const directoryOperation = operation === 'list' || operation === 'clear'
    const expectedKind = directoryOperation ? 'directory' : 'file'
    if (kind !== expectedKind) throw new Error(`Disk ${operation} requires kind "${expectedKind}"`)
    if (operation === 'clear') return undefined
    return relativePath(path, operation === 'list')
}

/** Validate the shared relative-path contract without allocating path segments. */
export function relativePath(value, allowEmpty = false) {
    if (allowEmpty && value === undefined) return ''
    if (typeof value !== 'string' || !value || /^[\\/]/.test(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error('Disk path must be a non-empty relative path')
    if (value.includes('\\') || /(^|\/)\.{1,2}(?:\/|$)/.test(value)) throw new Error('Disk path must stay inside its configured directory')
    return value
}

/** Split a validated relative path for APIs that accept path components. */
export function pathSegments(value) { return relativePath(value).split('/').filter(Boolean) }

export const isMissingDiskError = error => error?.code === 'ENOENT' || error?.name === 'NotFoundError'
