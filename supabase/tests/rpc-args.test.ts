import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// TypeScript can't see the database, so a client call that doesn't match its function
// only fails when someone taps the button. This compares them: the migrations, read
// in order, say what each function takes now.
function currentSignatures() {
  const signatures = new Map<string, { args: string[]; required: string[] }>()
  const dir = 'supabase/migrations'
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(`${dir}/${file}`, 'utf8')
    const changes = sql.matchAll(/(drop function(?: if exists)?|create (?:or replace )?function) public\.(\w+)\s*\(([^)]*)\)/g)
    for (const [, verb, name, params] of changes) {
      if (verb.startsWith('drop')) {
        signatures.delete(name)
        continue
      }
      const list = params.split(',').map((p) => p.trim()).filter(Boolean)
      signatures.set(name, {
        args: list.map((p) => p.split(/\s+/)[0]),
        required: list.filter((p) => !/\sdefault\s/i.test(p)).map((p) => p.split(/\s+/)[0]),
      })
    }
  }
  return signatures
}

function clientCalls() {
  const source = readFileSync('src/api/supabase.ts', 'utf8')
  return [...source.matchAll(/rpc(?:<[^(]*>)?\('(\w+)'(?:,\s*\{(.*?)\}\s*\))?/gs)].map(([, name, body = '']) => ({
    name,
    keys: [...new Set([...body.matchAll(/\b(p_\w+|p)\b\s*:/g)].map((m) => m[1]))],
    // `{ p_id }` passes a variable of the same name.
    shorthand: [...body.matchAll(/(?:^|,)\s*(p_\w+|p)\s*(?=,|$)/g)].map((m) => m[1]),
  }))
}

describe('client calls to database functions', () => {
  const signatures = currentSignatures()
  const calls = clientCalls()

  it('finds the calls', () => {
    expect(calls.length).toBeGreaterThan(50)
    expect(calls.map((c) => c.name)).toContain('reject_listing')
  })

  it.each(calls.map((c) => [c.name, c] as const))('%s matches its function', (name, call) => {
    const fn = signatures.get(name)
    expect(fn, `no function public.${name}`).toBeDefined()
    const sent = [...call.keys, ...call.shorthand]
    expect(fn!.required.filter((a) => !sent.includes(a)), 'arguments not sent').toEqual([])
    expect(sent.filter((a) => !fn!.args.includes(a)), 'arguments it doesn’t take').toEqual([])
  })
})
