const fileKinds = new Set(['file', 'leaf', 'branch', 'config', 'roots'])
const operations = new Set(['read', 'write', 'delete', 'has', 'list', 'clear', 'cancel'])

/** Validate the shared request contract and return its validated relative path. */
export function validateRequest({ operation, kind, path } = {}) {
    if (!operations.has(operation)) throw new Error(`Unsupported disk operation: ${operation}`)

    const directoryOperation = operation === 'list' || operation === 'clear'
    const expectedKind = directoryOperation ? 'directory' : 'file'
    if (directoryOperation ? kind !== expectedKind : !fileKinds.has(kind)) throw new Error(`Disk ${operation} requires kind "${expectedKind}"`)
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

/** Per-adapter write ownership. Callers observe queue; only execute mutates it. */
export function createStorage(access, { concurrency = 16 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('Disk concurrency must be a positive integer')
    const queue = Object.create(null), pending = new Map(), running = new Map()
    let active = 0, scheduled = false, clearing
    const defer = globalThis.setImmediate ?? (callback => setTimeout(callback, 0))
    const bucket = kind => kind === 'leaf' ? 'leaves' : kind === 'branch' ? 'branches' : 'files'

    function publish(job) {
        const request = job.request
        const group = queue[job.group] ??= { leaves: Object.create(null), branches: Object.create(null), files: Object.create(null) }
        if (!Object.hasOwn(group, 'size')) Object.defineProperty(group, 'size', { value: 0, writable: true })
        if (!Object.hasOwn(group[job.bucket], job.id)) group.size++
        group[job.bucket][job.id] = request
    }
    function release(job) {
        const next = pending.get(job.path) ?? running.get(job.path)
        if (next) { publish(next); return }
        const group = queue[job.group]
        delete group[job.bucket][job.id]
        if (!--group.size) delete queue[job.group]
    }
    function schedule() {
        if (scheduled) return
        scheduled = true
        defer(() => { scheduled = false; pump() })
    }
    function pump() {
        for (const [path, job] of pending) {
            if (active === concurrency) break
            if (running.has(path)) continue
            pending.delete(path)
            running.set(path, job)
            active++
            Promise.resolve().then(() => access(job.request, path)).then(result => {
                running.delete(path)
                release(job)
                job.resolve(result)
            }, error => {
                // Keep failed work visible; recovery/retry belongs to the caller.
                job.reject(error)
            }).finally(() => { active--; schedule() })
        }
    }
    async function execute(request = {}) {
        const path = validateRequest(request)
        if (request.operation === 'clear') {
            const previous = clearing
            const task = (async () => {
                await previous
                await Promise.all([...pending.values(), ...running.values()].map(job => job.promise))
                return await access(request, path)
            })()
            clearing = task
            try { return await task } finally { if (clearing === task) clearing = undefined }
        }
        if (clearing) await clearing
        if (request.operation === 'cancel') {
            const job = pending.get(path)
            if (job) {
                pending.delete(path)
                release(job)
                job.resolve({ cancelled: true })
            }
            return { cancelled: !!job, inFlight: running.has(path) }
        }
        if (request.operation !== 'write' && request.operation !== 'delete') return await access(request, path)
        const previous = pending.get(path)
        previous?.resolve({ superseded: true })
        const job = { request, path, group: request.primary ?? path, bucket: bucket(request.kind), id: request.uuid ?? path }
        job.promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }))
        pending.set(path, job)
        publish(job)
        schedule()
        return await job.promise
    }
    return { execute, queue }
}
