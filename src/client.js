const operations = new Set(['read', 'write', 'delete', 'has', 'list', 'clear'])
const isMissing = error => error?.name === 'NotFoundError'

function segments(value) {
    if (typeof value !== 'string' || !value || /^[\\/]/.test(value)) throw new Error('Disk path must be a non-empty relative path')
    const parts = value.split(/[\\/]+/).filter(Boolean)
    if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error('Invalid disk path')
    return parts
}

async function directoryFor(root, parts, create = false) {
    let directory = root
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create })
    return directory
}

/** Initialize an isolated browser disk backed by the Origin Private File System. */
export async function init(options = {}) {
    const storage = globalThis.navigator?.storage
    if (typeof storage?.getDirectory !== 'function') throw new Error('OPFS is unavailable; Disk requires a secure browser context with Origin Private File System support')
    const root = await storage.getDirectory()
    const base = await directoryFor(root, segments(options.directory ?? 'CoCreateDB'), true)

    async function execute(request = {}) {
        const { operation, kind, path, data } = request
        if (!operations.has(operation)) throw new Error(`Unsupported disk operation: ${operation}`)
        if (operation === 'clear') {
            if (kind !== 'directory') throw new Error('Disk clear requires kind "directory"')
            for await (const [name] of base.entries()) await base.removeEntry(name, { recursive: true })
            return true
        }

        const parts = path ? segments(path) : []
        if (operation === 'list') {
            if (kind !== 'directory') throw new Error('Disk list requires kind "directory"')
            let directory
            try { directory = await directoryFor(base, parts) }
            catch (error) { if (isMissing(error)) return []; throw error }
            const names = []
            for await (const [name] of directory.entries()) names.push(name)
            return names
        }

        if (kind !== 'file' || !parts.length) throw new Error(`Disk ${operation} requires kind "file" and a path`)
        const filename = parts.pop()
        let directory
        try { directory = await directoryFor(base, parts, operation === 'write') }
        catch (error) {
            if (isMissing(error) && (operation === 'has' || operation === 'delete')) return operation === 'has' ? false : true
            throw error
        }
        if (operation === 'read') return await (await (await directory.getFileHandle(filename)).getFile()).text()
        if (operation === 'write') {
            const handle = await directory.getFileHandle(filename, { create: true })
            const writable = await handle.createWritable()
            try { await writable.write(data); await writable.close() }
            catch (error) { try { await writable.abort?.() } catch {}; throw error }
            return true
        }
        if (operation === 'delete') {
            await directory.removeEntry(filename).catch(error => { if (!isMissing(error)) throw error })
            return true
        }
        try { await directory.getFileHandle(filename); return true }
        catch (error) { if (isMissing(error)) return false; throw error }
    }

    return { execute, directory: options.directory ?? 'CoCreateDB' }
}

export default { init }
