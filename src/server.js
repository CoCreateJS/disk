import { access, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const operations = new Set(['read', 'write', 'delete', 'has', 'list', 'clear'])
let temporaryId = 0

function createPath(root, value) {
    if (typeof value !== 'string' || !value || isAbsolute(value)) throw new Error('Disk path must be a non-empty relative path')
    const path = resolve(root, value)
    const fromRoot = relative(root, path)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('Disk path must stay inside its configured directory')
    return path
}

/** Initialize an isolated server disk and return its operation interface. */
export async function init(options = {}) {
    const root = resolve(options.directory ?? resolve(homedir(), '.cocreate', 'db'))
    await mkdir(root, { recursive: true })

    async function execute(request = {}) {
        const { operation, kind, path, data } = request
        if (!operations.has(operation)) throw new Error(`Unsupported disk operation: ${operation}`)
        if (operation === 'clear') {
            if (kind !== 'directory') throw new Error('Disk clear requires kind "directory"')
            await rm(root, { recursive: true, force: true })
            await mkdir(root, { recursive: true })
            return true
        }

        if (operation === 'list') {
            if (kind !== 'directory') throw new Error('Disk list requires kind "directory"')
            const directory = path ? createPath(root, path) : root
            try { return await readdir(directory) }
            catch (error) { if (error.code === 'ENOENT') return []; throw error }
        }

        if (kind !== 'file') throw new Error(`Disk ${operation} requires kind "file"`)
        const file = createPath(root, path)
        if (operation === 'read') return await readFile(file, 'utf8')
        if (operation === 'write') {
            await mkdir(dirname(file), { recursive: true })
            const temporary = `${file}.${process.pid}.${temporaryId++}.tmp`
            try {
                await writeFile(temporary, data)
                await rename(temporary, file)
            } finally {
                await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
            }
            return true
        }
        if (operation === 'delete') {
            await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
            return true
        }
        try { await access(file); return true }
        catch (error) { if (error.code === 'ENOENT') return false; throw error }
    }

    return { execute, directory: root }
}

export default { init }
