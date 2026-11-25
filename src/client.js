import { isMissingDiskError, pathSegments, validateRequest } from './core.js'

/** Initialize an isolated browser disk backed by the Origin Private File System. */
export async function init(options = {}) {
    const storage = globalThis.navigator?.storage
    if (typeof storage?.getDirectory !== 'function') throw new Error('OPFS is unavailable; Disk requires a secure browser context with Origin Private File System support')
    const root = await storage.getDirectory()
    let base = root
    for (const part of pathSegments(options.directory ?? 'CoCreateDB')) base = await base.getDirectoryHandle(part, { create: true })
    const directories = new Map([['', Promise.resolve(base)]])

    function directoryFor(parts, create = false) {
        let parent = directories.get('')
        let key = ''
        for (const part of parts) {
            key = key ? `${key}/${part}` : part
            let current = directories.get(key)
            if (!current) {
                current = parent.then(directory => directory.getDirectoryHandle(part, { create }))
                directories.set(key, current)
                current.catch(() => { if (directories.get(key) === current) directories.delete(key) })
            }
            parent = current
        }
        return parent
    }

    async function execute(request = {}) {
        const { operation, data } = request
        const path = validateRequest(request)
        const parts = path ? path.split('/') : []
        if (operation === 'clear') {
            for await (const [name] of base.entries()) await base.removeEntry(name, { recursive: true })
            directories.clear()
            directories.set('', Promise.resolve(base))
            return true
        }

        if (operation === 'list') {
            let directory
            try { directory = await directoryFor(parts) }
            catch (error) { if (isMissingDiskError(error)) return []; throw error }
            const names = []
            for await (const [name] of directory.entries()) names.push(name)
            return names
        }

        if (!parts.length) throw new Error(`Disk ${operation} requires a file path`)
        const filename = parts.pop()
        let directory
        try { directory = await directoryFor(parts, operation === 'write') }
        catch (error) {
            if (isMissingDiskError(error) && (operation === 'has' || operation === 'delete')) return operation === 'has' ? false : true
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
            await directory.removeEntry(filename).catch(error => { if (!isMissingDiskError(error)) throw error })
            return true
        }
        try { await directory.getFileHandle(filename); return true }
        catch (error) { if (isMissingDiskError(error)) return false; throw error }
    }

    return { execute }
}

export default { init }
