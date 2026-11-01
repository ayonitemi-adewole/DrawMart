import { useTranslation } from 'react-i18next'
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
export function ProductSearch({ value, onChange, id = 'product-search', placeholder, autoFocus, className }: { value: string; onChange: (value: string) => void; id?: string; placeholder?: string; autoFocus?: boolean; className?: string }) {
  const { t } = useTranslation()
  const prompt = placeholder ?? t('search.placeholder')
  return (
    <div role="search" className={cx('relative w-full sm:max-w-sm', className)}>
      <label htmlFor={id} className="sr-only">
        {prompt}
      </label>
      <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle" />
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={prompt} autoComplete="off" autoFocus={autoFocus} className={cx(inputCls, 'min-h-11 pl-10')} />
    </div>
  )
}

export function NoProductMatch({ query }: { query: string }) {
  const { t } = useTranslation()
  return <EmptyState icon={SearchIcon} title={t('search.noMatches')} body={t('search.noMatchesBody', { query: query.trim() })} />
}
