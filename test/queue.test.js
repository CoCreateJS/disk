import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Disk from '../src/server.js'
import { init as initBrowser } from '../src/client.js'
import { createStorage } from '../src/core.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const gate = () => {
    let release, start
    return { started: new Promise(resolve => { start = resolve }), wait: new Promise(resolve => { release = resolve }),
        start: () => start(), release: () => release() }
}
const write = (data, uuid = 'leaf', primary = 'table') => ({ operation: 'write', kind: 'leaf', primary, uuid, path: `${primary}/${uuid}.json`, data })

test('pending versions coalesce in the adapter queue and drain automatically', async () => {
    const calls = []
    const disk = createStorage(async request => { calls.push(request); return true })
    const old = disk.execute(write('old')), latest = disk.execute(write('latest'))
    assert.equal(disk.queue.table.leaves.leaf.data, 'latest')
    assert.equal(disk.queue.table.size, 1)
    assert.equal(JSON.parse(JSON.stringify(disk.queue)).table.leaves.leaf.operation, 'write')
    assert.deepEqual(await old, { superseded: true })
    assert.equal(await latest, true)
    assert.deepEqual(calls.map(call => call.data), ['latest'])
    assert.deepEqual(Object.keys(disk.queue), [])
})

test('cancel removes pending work without touching the existing file or an in-flight write', async () => {
    const hold = gate(), calls = []
    const disk = createStorage(async request => { calls.push(request); hold.start(); await hold.wait; return true })
    const first = disk.execute(write('first'))
    await hold.started
    const second = disk.execute(write('second'))
    const cancel = await disk.execute({ ...write(), operation: 'cancel' })
    assert.deepEqual(cancel, { cancelled: true, inFlight: true })
    assert.deepEqual(await second, { cancelled: true })
    assert.equal(disk.queue.table.leaves.leaf.data, 'first', 'in-flight work still protects the group')
    assert.deepEqual(await disk.execute({ ...write(), operation: 'cancel' }), { cancelled: false, inFlight: true })
    hold.release()
    await first
    assert.equal(calls.length, 1)
    assert.equal(calls[0].operation, 'write')
    assert.deepEqual(Object.keys(disk.queue), [])
})

test('later writes and deletes serialize behind an active write to the same file', async () => {
    const hold = gate(), calls = []
    const disk = createStorage(async request => {
        calls.push(request.operation === 'write' ? request.data : 'delete')
        if (calls.length === 1) { hold.start(); await hold.wait }
        return true
    })
    const first = disk.execute(write('first'))
    await hold.started
    const second = disk.execute(write('second'))
    const removed = disk.execute({ ...write(), operation: 'delete' })
    assert.deepEqual(await second, { superseded: true })
    assert.equal(disk.queue.table.leaves.leaf.operation, 'delete')
    hold.release()
    await Promise.all([first, removed])
    assert.deepEqual(calls, ['first', 'delete'])
    assert.deepEqual(Object.keys(disk.queue), [])
})

test('one adapter bounds concurrency across primary groups', async () => {
    const hold = gate()
    let active = 0, peak = 0
    const disk = createStorage(async () => {
        active++; peak = Math.max(active, peak)
        if (active === 16) hold.start()
        await hold.wait
        active--
        return true
    })
    const tasks = Array.from({ length: 50 }, (_, i) => disk.execute(write('data', `leaf-${i}`, `table-${i}`)))
    await hold.started
    assert.equal(peak, 16)
    assert.equal(Object.keys(disk.queue).length, 50)
    hold.release()
    await Promise.all(tasks)
    assert.equal(peak, 16)
    assert.deepEqual(Object.keys(disk.queue), [])
})

test('failed requests reject and remain visible without automatic retries', async () => {
    let calls = 0
    const disk = createStorage(async () => { calls++; throw Error('write failure') })
    await assert.rejects(disk.execute(write('data')), /write failure/)
    await tick()
    assert.equal(calls, 1)
    assert.equal(disk.queue.table.leaves.leaf.data, 'data')
})

test('filesystem adapter exposes queue/cancel, saves final bytes and orders clear before new writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cocreate-disk-queue-'))
    try {
        const disk = await Disk.init({ directory })
        await disk.execute(write('stored'))
        const replacement = disk.execute(write('cancelled'))
        assert.deepEqual(await disk.execute({ ...write(), operation: 'cancel' }), { cancelled: true, inFlight: false })
        assert.deepEqual(await replacement, { cancelled: true })
        assert.equal(await disk.execute({ ...write(), operation: 'read' }), 'stored')
        const first = disk.execute(write('before clear'))
        const clear = disk.execute({ operation: 'clear', kind: 'directory' })
        const after = disk.execute(write('after clear'))
        await Promise.all([first, clear, after])
        assert.equal(await disk.execute({ ...write(), operation: 'read' }), 'after clear')
        await disk.execute({ ...write(), operation: 'delete' })
        assert.equal(await disk.execute({ ...write(), operation: 'has' }), false)
        assert.deepEqual(Object.keys(disk.queue), [])
        for (const path of ['../escape', '/absolute', 'dir/../../escape', 'C:\\escape'])
            await assert.rejects(disk.execute({ ...write(), path }), /relative|inside/)
    } finally { await rm(directory, { recursive: true, force: true }) }
})

function directory() {
    const files = new Map(), folders = new Map()
    const missing = () => Object.assign(Error('Missing entry'), { name: 'NotFoundError' })
    return {
        async getDirectoryHandle(name, { create } = {}) {
            if (!folders.has(name)) { if (!create) throw missing(); folders.set(name, directory()) }
            return folders.get(name)
        },
        async getFileHandle(name, { create } = {}) {
            if (!files.has(name)) { if (!create) throw missing(); files.set(name, '') }
            return {
                async getFile() { return { text: async () => files.get(name) } },
                async createWritable() {
                    let pending
                    return { async write(data) { pending = data }, async close() { files.set(name, pending) }, async abort() {} }
                }
            }
        },
        async removeEntry(name) { if (!files.delete(name) && !folders.delete(name)) throw missing() },
        async *entries() { yield* files; yield* folders }
    }
}

test('OPFS adapter uses the same execute/queue/cancel contract', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => directory() } } })
    try {
        const disk = await initBrowser({ directory: 'db' })
        const pending = disk.execute(write('cancelled'))
        assert.equal(disk.queue.table.leaves.leaf.data, 'cancelled')
        await disk.execute({ ...write(), operation: 'cancel' })
        assert.deepEqual(await pending, { cancelled: true })
        assert.equal(await disk.execute({ ...write(), operation: 'has' }), false)
        await disk.execute(write('saved'))
        assert.equal(await disk.execute({ ...write(), operation: 'read' }), 'saved')
        assert.deepEqual(Object.keys(disk.queue), [])
    } finally {
        if (previous) Object.defineProperty(globalThis, 'navigator', previous)
        else delete globalThis.navigator
    }
})
