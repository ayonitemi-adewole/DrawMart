import { useState } from 'react'
import { Link } from 'react-router'
import { useCreateProductsBulk } from '@/api/hooks'
import type { BulkUploadResult, NewProductInput } from '@/api/types'
import { AlertIcon, CheckCircleIcon, DownloadIcon, ShieldIcon, XIcon } from '@/components/icons'
import { useToast } from '@/components/toast'
import { Badge, Button, Card, Notice, PageTitle, buttonClass, cx, errorMessage } from '@/components/ui'
import { BULK_TEMPLATE_CSV, MAX_BULK_ROWS, photoKey, readBulkSheet } from '@/domain/bulkUpload'
import { formatNaira } from '@/domain/money'
import { photoToDataUrl } from '@/lib/image'

const COLUMN_HELP: [string, string][] = [
  ['title', 'The product’s name. Required.'],
  ['category', 'Phones, Electronics, Home, Cars or Fashion. Required.'],
  ['price', 'In naira, e.g. 25000. Required.'],
  ['stock', 'How many you have. Blank means 1.'],
  ['description', 'Optional.'],
  ['package_size', 'small, medium or large. Blank uses the usual size for the category.'],
  ['serial', 'Serial or IMEI. Needed for phones and electronics from ₦50,000.'],
  ['photos', '1 to 4 photo file names, separated by semicolons, e.g. fan-front.jpg;fan-side.jpg. Required.'],
]

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([BULK_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'drawmart-products-template.csv'
  link.click()
  URL.revokeObjectURL(url)
}

/** /store/bulk: many products from a spreadsheet, each into review. */
export function BulkUploadPage() {
  const upload = useCreateProductsBulk()
  const toast = useToast()
  const [sheet, setSheet] = useState<{ name: string; text: string } | null>(null)
  const [photos, setPhotos] = useState<File[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<BulkUploadResult | null>(null)

  const read = sheet ? readBulkSheet(sheet.text, photos.map((f) => f.name)) : null
  const rows = read?.rows ?? []
  const bad = rows.filter((r) => r.errors.length)
  const ready = !!read && !read.error && rows.length > 0 && bad.length === 0

  function addPhotos(list: FileList | null) {
    const images = [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
    // A later file with the same name replaces an earlier one.
    setPhotos((prev) => [...prev.filter((p) => !images.some((f) => photoKey(f.name) === photoKey(p.name))), ...images])
  }

  async function send() {
    if (!ready) return
    const byName = new Map(photos.map((f) => [photoKey(f.name), f]))
    const total = rows.reduce((n, r) => n + r.photoNames.length, 0)
    let done = 0
    setProgress(`Preparing photos: 0 of ${total}`)
    try {
      const items: NewProductInput[] = []
      for (const r of rows) {
        const images: string[] = []
        for (const name of r.photoNames) {
          images.push(await photoToDataUrl(byName.get(photoKey(name))!))
          done += 1
          setProgress(`Preparing photos: ${done} of ${total}`)
        }
        items.push({
          title: r.title,
          description: r.description,
          category: r.category!,
          priceKobo: r.priceKobo,
          stock: r.stock,
          ...(r.packageSize ? { packageSize: r.packageSize } : {}),
          images,
          check: { code: '', serial: r.serial },
        })
      }
      const out = await upload.mutateAsync({ items, onProgress: (n, of) => setProgress(`Uploading photos: ${n} of ${of}`) })
      setResult(out)
      setSheet(null)
      setPhotos([])
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle eyebrow="Upload many" sub={`Add up to ${MAX_BULK_ROWS} products at once from a spreadsheet and their photos. Each one goes into review, as if you’d added it on its own.`}>
        Bulk upload
      </PageTitle>

      {result ? (
        <Card className="flex flex-col gap-3 p-5">
          <strong className="flex items-center gap-2 text-lg">
            <CheckCircleIcon size={20} className="text-brand" /> {result.created} product{result.created === 1 ? '' : 's'} sent for review
          </strong>
          {result.checkTitles.length ? (
            <Notice tone="ticket" icon={ShieldIcon} title={`DrawMart picked ${result.checkTitles.length} for a spot check`}>
              These weren’t added: {result.checkTitles.join(', ')}. Add each one with New listing; it’ll ask for a short video of the item. Your next listings need one until they’re all done.
            </Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link to="/store" className={buttonClass('outline')}>
              See your listings
            </Link>
            {result.checkTitles.length ? (
              <Link to="/store?tab=new&kind=product" className={buttonClass('primary')}>
                Add a picked product
              </Link>
            ) : null}
            <Button variant="ghost" onClick={() => setResult(null)}>
              Upload more
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-3 p-5">
          <strong>1. Get the template</strong>
          <p className="text-sm text-muted">Fill it in with Excel, Google Sheets or Numbers, then save it as CSV.</p>
          <Button variant="outline" className="w-fit" onClick={downloadTemplate}>
            <DownloadIcon size={16} /> Download template
          </Button>
          <details className="text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-bold">What goes in each column</summary>
            <dl className="flex flex-col gap-1.5 text-muted">
              {COLUMN_HELP.map(([k, v]) => (
                <div key={k}>
                  <dt className="inline font-mono font-bold text-ink">{k}</dt> <dd className="inline">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <strong>2. Choose your spreadsheet</strong>
          <label className="flex min-h-11 w-fit cursor-pointer items-center rounded-xl border border-line-strong px-4 text-sm font-bold">
            {sheet ? 'Choose another file' : 'Choose a CSV file'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setSheet({ name: f.name, text: await f.text() })
                e.target.value = ''
              }}
            />
          </label>
          {sheet ? <span className="text-sm text-muted">{sheet.name}</span> : null}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <strong>3. Choose the photos</strong>
          <p className="text-sm text-muted">Their file names have to match the photos column.</p>
          <div className="flex flex-wrap gap-2">
            <label className="flex min-h-11 cursor-pointer items-center rounded-xl border border-line-strong px-4 text-sm font-bold">
              Choose photos
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => (addPhotos(e.target.files), (e.target.value = ''))} />
            </label>
            <label className="flex min-h-11 cursor-pointer items-center rounded-xl border border-line-strong px-4 text-sm font-bold">
              Choose a folder
              <input type="file" multiple className="sr-only" ref={(el) => el?.setAttribute('webkitdirectory', '')} onChange={(e) => (addPhotos(e.target.files), (e.target.value = ''))} />
            </label>
          </div>
          {photos.length ? (
            <span className="flex items-center gap-2 text-sm text-muted">
              {photos.length} photo{photos.length === 1 ? '' : 's'} chosen
              <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setPhotos([])}>
                Clear
              </Button>
            </span>
          ) : null}
        </Card>
      </div>

      {read?.error ? (
        <Notice tone="hot" icon={AlertIcon} title="That spreadsheet can’t be used">
          {read.error}
        </Notice>
      ) : null}

      {rows.length ? (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-lg">4. Check and send</strong>
            <Badge tone="brand">{rows.length - bad.length} ready</Badge>
            {bad.length ? <Badge tone="hot">{bad.length} to fix</Badge> : null}
          </div>
          {bad.length ? <p className="text-sm text-muted">Fix these in your spreadsheet and choose it again, or add the missing photos. Nothing is sent until every row is ready.</p> : null}
          <ol className="flex max-h-128 flex-col divide-y divide-line overflow-y-auto">
            {rows.map((r) => (
              <li key={r.line} className="flex flex-col gap-1 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-12 shrink-0 text-xs text-subtle">Row {r.line}</span>
                  <strong className="min-w-0 flex-1 truncate">{r.title || 'No title'}</strong>
                  <span className="text-xs text-subtle tabular-nums">
                    {r.category ?? '—'} · {r.priceKobo ? formatNaira(r.priceKobo) : '—'} · {r.stock} in stock · {r.photoNames.length} photo{r.photoNames.length === 1 ? '' : 's'}
                  </span>
                  {r.errors.length ? <XIcon size={16} className="text-hot" aria-label="Has problems" /> : <CheckCircleIcon size={16} className="text-brand" aria-label="Ready" />}
                </span>
                {r.errors.length ? (
                  <ul className="list-disc pl-20 text-xs text-hot-ink">
                    {r.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={!ready} loading={upload.isPending || !!progress} onClick={() => void send()}>
              Send {rows.length} product{rows.length === 1 ? '' : 's'} for review
            </Button>
            {progress ? <span className={cx('text-sm text-muted')}>{progress}</span> : null}
          </div>
          <p className="text-xs text-subtle">DrawMart picks some uploads for a spot check, as it does one at a time. Those aren’t added; you’ll add them with the form and a short video.</p>
        </Card>
      ) : null}
    </div>
  )
}
