# site/app/data/ — `/data` (the call list)

**What lives here.** The sortable, paginated "call these sellers" table + CSV
export. `page.tsx` is a ~170-line client shell; the pieces are split out:
`columns.ts` (column defs + `cell()` + `sortVal()`), `pagination.ts`
(parse/clamp/write page state to the URL), `deals-table.tsx` (the table +
`HScroll` wrapper), `export-header.tsx` (title + CSV button). Renders
`SideCard` for a row's detail panel and `IngestionHealth`.

**The one trap.** Sort/pagination state lives in the **URL** (`page`, `sort`,
`dir` params via `useFilters`) — it must round-trip with the filter params or a
share link loses the view. New columns go in `columns.ts` (one place), not
inline in the table component.

**Detail.** `page.tsx` + `columns.ts` T0 headers.
