import { spawn } from 'node:child_process'
import { writeFile, unlink, mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Document ingestion via Microsoft MarkItDown (installed in the image, see the
// Dockerfile). Converts an uploaded file — PDF, Word, PowerPoint, Excel, HTML,
// etc. — into Markdown text that Kelion (and its agents) can read. The Python
// package does the heavy lifting; we just hand it a temp file and read stdout.

export async function documentToMarkdown(bytes: Buffer, filename: string): Promise<string> {
  const safe = (filename || 'file').replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'file'
  const dir = await mkdtemp(join(tmpdir(), 'kelion-doc-'))
  const path = join(dir, safe)
  await writeFile(path, bytes)
  try {
    const md = await new Promise<string>((resolve, reject) => {
      const py = spawn('python3', [
        '-c',
        'import sys;from markitdown import MarkItDown;sys.stdout.write(MarkItDown().convert(sys.argv[1]).text_content or "")',
        path,
      ])
      // setEncoding tamponează byte-ii UTF-8 parțiali peste granițele de chunk —
      // altfel diacriticele (ă ș ț) care cad pe graniță se corup în „�".
      py.stdout.setEncoding('utf8')
      py.stderr.setEncoding('utf8')
      let out = ''
      let err = ''
      py.stdout.on('data', (d) => {
        out += d
      })
      py.stderr.on('data', (d) => {
        err += d
      })
      py.on('error', (e) => reject(e))
      py.on('close', (code) =>
        code === 0 ? resolve(out) : reject(new Error(err.trim().slice(0, 200) || `exit ${code}`)),
      )
    })
    return md.trim()
  } finally {
    await unlink(path).catch(() => {})
    await rmdir(dir).catch(() => {})
  }
}
