# Parser resource fixture

`oversized-dimension.xlsx` is a synthetic 3,921-byte workbook from the
13 November 2026 readiness audit. It contains the ten synthetic downtime events
used by the open-alpha oracle and one numeric cell at `XFD1048576`. Its worksheet
range spans that distant cell.

The fixture demonstrates that a compressed upload-size cap does not bound dense
worksheet expansion. Parse it only through the bounded worker in regression
tests. Do not recreate it by calling SheetJS's writer on that giant range: the
writer itself iterates the rectangle. A future regeneration must patch the
worksheet ZIP member of a small workbook with bounded ZIP tooling.

It contains no user project data or credentials.
