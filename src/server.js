import { access, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createStorage } from './core.js'

let temporaryId = 0

function createPath(root, path) { return join(root, path) }

/** Initialize an isolated server disk and return its operation interface. */
export async function init(options = {}) {
    const root = resolve(options.directory ?? resolve(homedir(), '.cocreate', 'db'))
    await mkdir(root, { recursive: true })
    const directories = new Map([[root, Promise.resolve()]])

    function ensureDirectory(path) {
        let pending = directories.get(path)
        if (!pending) {
            pending = mkdir(path, { recursive: true })
            directories.set(path, pending)
            pending.catch(() => { if (directories.get(path) === pending) directories.delete(path) })
        }
        return pending
    }

    async function accessDisk(request, path) {
        const { operation, data } = request
        if (operation === 'clear') {
            await rm(root, { recursive: true, force: true })
            await mkdir(root, { recursive: true })
            directories.clear()
            directories.set(root, Promise.resolve())
            return true
        }

        if (operation === 'list') {
            const directory = path ? createPath(root, path) : root
            try { return await readdir(directory) }
            catch (error) { if (error.code === 'ENOENT') return []; throw error }
        }

        const file = createPath(root, path)
        if (operation === 'read') return await readFile(file, 'utf8')
        if (operation === 'write') {
            await ensureDirectory(dirname(file))
            const temporary = `${file}.${process.pid}.${temporaryId++}.tmp`
            let renamed = false
            try {
                await writeFile(temporary, data)
                await rename(temporary, file)
                renamed = true
            } finally {
                if (!renamed) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
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

    return createStorage(accessDisk, options)
}

export default { init }
