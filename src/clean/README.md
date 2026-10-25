# src/clean/ — Stage 2: pandas clean + scoring (`python -m src.clean`)

**What lives here.** `cli.py` drives the run (resolve input/run-id, write
Parquet + CSV + manifest + process log — including on failure);
`frame.py` owns the contract constants (`RAW_COLUMNS`, the 20 raw keys, dtype
groups), `read_jsonl`, `build_frame` and the majority-`snapshot_date` picker;
`derive.py` owns the **7 derived columns** (`DERIVED_COLUMNS`, `transform`,
`clean_file`, `CleanStats`); `score.py` owns the **business rule** (`score_one`,
`HIGH_DOM = 90`, `HIGH_DROP_PCT = 5.0`); `processlog.py` holds the log/failed-run
evidence writers split out of `cli.py`.

**The one trap.** The motivation rule is strict-`>` and null-safe (missing DOM
counts as ≤ 90, missing drop as ≤ 5 %): a drop of *exactly* 5.0 % or DOM of
*exactly* 90 is **not** High. The constants exist once, in `score.py` — if you
change them you must change [docs/data_contract.md](../../docs/data_contract.md)
§Stage 2 and the boundary tests in the same commit (invariants I1/I2,
[docs/decisions.md](../../docs/decisions.md) §1).

**Market-analysis guard (`--sanitize`, off by default).** `derive.sanitize()`
drops rows with `price_current` missing/≤ 0 and rows whose `state` is set and
isn't `NY` (Zillow pads ZIP pages with nearby homes), and nulls
`price_previous` when it exceeds 5× the current price (observed digit-duplication
artefacts that manufacture fake High scores). The row survives in the second
case — DOM, price and location are still real. `scripts/run_daily.py` always
passes the flag; the raw JSONL is never touched, so the guard is reversible.

**Detail.** Each file's T0 header. Tests: `tests/test_clean.py` (CLI
end-to-end), plus `tests/test_clean_score.py`, `tests/test_clean_derive.py`,
`tests/test_clean_frame.py` (the topic split of the old monolith) and
`tests/test_contract_parity.py`.
