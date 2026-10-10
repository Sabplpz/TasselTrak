# TasselTrak demo seed (synthetic)

Run order on Neon (SQL Editor, one file at a time):
1. `data/migrations/002_program_requisites_and_grades.sql`
2. `data/seed/seed.sql` (safe to re-run; it deletes and rebuilds the `ucf` university)

Everything student-, section-, grade- and instructor-related is synthetic. Student IDs are SYN-xxxx.

## Verify before demo (assumptions)
- Titles/credits not on the charts: MAC 1140C, EGS 1006C, EGN 1007C, COM 1000, SPC 1603C, SPC 1608.
- PHY 2048C/2049C/2053C/2054C are lecture+lab combined from the "+L" labels.
- "Any COP-prefix course" is modeled as an OR group (COP 2500, 3223C, 3330, 3502C).
- Test credit is modeled as grade 'TC'. CpE general education is not modeled.
- CS, IT and CpE charts disagree on some requisites (e.g. COP 4331C); edges are per program, not merged.
- Edges not drawn on the charts are not modeled. Spring 2027 sections are made up.
