import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Export only catalog DDL. Never reads application rows, Auth rows, or Vault data.
const project = process.env.SUPABASE_SOURCE_PROJECT
const inputIndex = process.argv.indexOf('--sections')
let sections
if (inputIndex !== -1) {
  if (!process.argv[inputIndex + 1]) throw new Error('--sections needs the path of a reviewed catalog section array.')
  sections = JSON.parse(await readFile(process.argv[inputIndex + 1], 'utf8'))
} else {
  if (!project || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Set SUPABASE_SOURCE_PROJECT and SUPABASE_ACCESS_TOKEN for the read-only schema export, or use --sections PATH for an MCP export.')
  const query = await readFile(new URL('../supabase/tests/schema_snapshot.sql', import.meta.url), 'utf8')
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(project)}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  })
  if (!response.ok) throw new Error(`Schema export failed (${response.status}); use an authorized Supabase MCP catalog export with --sections PATH as a fallback.`)
  sections = await response.json()
}
if (!Array.isArray(sections) || !sections.some((section) => section.name === 'tables')) throw new Error('Schema export did not return the expected catalog sections.')
const sql = '-- Catalog snapshot from ' + (project || 'reviewed MCP export') + '; schema only. Review before local restore.\nbegin;\n'
  + sections.map((section) => `\n-- ${section.name}\n${section.sql}\n`).join('') + '\ncommit;\n'
await mkdir('test-artifacts.local', { recursive: true })
await writeFile('test-artifacts.local/current-schema.sql', sql)
await writeFile('test-artifacts.local/current-schema.json', JSON.stringify({ project, exportedAt: new Date().toISOString(), sha256: createHash('sha256').update(sql).digest('hex'), sections: sections.map(({ name }) => name) }, null, 2))
console.log(`Exported ${sections.length} schema sections to test-artifacts.local/current-schema.sql; no clinic records exported.`)
