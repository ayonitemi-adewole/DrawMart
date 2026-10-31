import { CopyButton } from './CopyButton'
import { SearchIcon } from './icons'
import { EmptyState, cx, inputCls } from './ui'

/** A product's ID. `copy` adds a button, so leave it off inside a link. */
export function ProductId({ code, copy, className }: { code: string; copy?: boolean; className?: string }) {
  return (
    <span className={cx('flex w-fit items-center font-mono text-xs font-semibold text-subtle', className)}>
      <span className="sr-only">Product ID </span>
      {code}
      {/* Negative margins: a full-size touch target without making the row taller. */}
      {copy ? <CopyButton value={code} label={`product ID ${code}`} className="-my-3 [&>svg]:size-3.5" /> : null}
    </span>
  )
}

/** The search box above a list of products. */
export function ProductSearch({ value, onChange, id = 'product-search', placeholder = 'Search by name or product ID', className }: { value: string; onChange: (value: string) => void; id?: string; placeholder?: string; className?: string }) {
  return (
    <div role="search" className={cx('relative w-full sm:max-w-sm', className)}>
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle" />
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" className={cx(inputCls, 'min-h-11 pl-10')} />
    </div>
  )
}

export function NoProductMatch({ query }: { query: string }) {
  return <EmptyState icon={SearchIcon} title="No matches" body={`Nothing here matches “${query.trim()}”. Check the product ID or try another word.`} />
}
