"""Build cleaned-modified/: same fixture with ONE price_current changed.

Proves the snapshot upsert is a real ON CONFLICT ... DO UPDATE: same
(source, listing_id, snapshot_date) key -> price overwritten, counts unchanged.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pandas as pd

JOB = Path(__file__).resolve().parent
SRC = JOB / "cleaned"
DST = JOB / "cleaned-modified"
DELTA = 25000

DST.mkdir(exist_ok=True)
parquet_files = sorted(SRC.glob("listings_*.parquet"))
if not parquet_files:
    raise SystemExit(f"no listings_*.parquet in {SRC}")
parquet = parquet_files[0]

df = pd.read_parquet(parquet)
candidates = df.index[df["price_current"].notna()]
if len(candidates) == 0:
    raise SystemExit("no non-null price_current to modify")
i = candidates[0]
old = int(df.at[i, "price_current"])
new = old - DELTA
df.at[i, "price_current"] = new

df.to_parquet(DST / parquet.name, index=False)
shutil.copy2(SRC / "manifest.json", DST / "manifest.json")

meta = {
    "source": str(df.at[i, "source"]),
    "listing_id": str(df.at[i, "listing_id"]),
    "snapshot_date": str(df.at[i, "snapshot_date"]),
    "price_current_before": old,
    "price_current_after": new,
    "delta": DELTA,
}
(DST / "modification.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print(json.dumps(meta, indent=2))
