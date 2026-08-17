# Print font pack

Static TTF faces shipped for license-card precision printing.

The designer and WeasyPrint path only embed a face when it exists as a
`CardFontAsset`. These files are seeded by `manage.py seed_card_print_fonts`.

| File | Family | License |
|---|---|---|
| SourceSans3-*.ttf | Source Sans 3 | SIL OFL 1.1 (Adobe) |
| SourceSerif4-*.ttf | Source Serif 4 | SIL OFL 1.1 (Adobe) |
| IBMPlexMono-*.ttf | IBM Plex Mono | SIL OFL 1.1 (IBM) |
| BarlowCondensed-*.ttf | Barlow Condensed | SIL OFL 1.1 (Jeremy Tribby) |
| Inter-*.ttf | Inter | SIL OFL 1.1 (Rasmus Andersson), if present |
| NotoSans-*.ttf | Noto Sans | SIL OFL 1.1 (Google), if present |

Do not replace these with variable fonts. The card renderer always hints
`format('truetype')` and WeasyPrint is most reliable with static TTF.
