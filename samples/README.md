# Sample datasets (test fixtures)

All files here are **synthetic test data created only to exercise the importers**. They are not
measurements from any real well and must never be used as scientific results.

| File | Purpose |
|---|---|
| `SYNTHETIC_comma_ft_nulls.csv` | Comma delimiter, depth in feet, units in headers, `-999.25` null, a non-numeric cell (`abc`) and a negative resistivity (log-scale violation) that must be reported and excluded |
| `SYNTHETIC_semicolon_decimal_comma.csv` | Semicolon delimiter and decimal comma (`30,5`), metres |
