export function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/^[=+\-@\t\r]|^\s+[=+\-@]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}

export function* csvChunks(rows) {
  yield '\ufeff'
  if (!rows.length) return
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  yield columns.map(csvCell).join(',')
  for (const row of rows) yield '\r\n' + columns.map((column) => csvCell(row[column])).join(',')
}

export function reportCsv(rows) {
  return [...csvChunks(rows)].join('').replace(/^\ufeff/, '')
}

export function csvStream(rows) {
  const iterator = csvChunks(rows)
  const encoder = new TextEncoder()
  return new ReadableStream({
    pull(controller) {
      const next = iterator.next()
      if (next.done) controller.close()
      else controller.enqueue(encoder.encode(next.value))
    },
    cancel() { iterator.return() },
  })
}
