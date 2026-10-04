# Self-hosted fonts (all SIL Open Font License 1.1)

Files come from the Fontsource packages (npm), which redistribute the upstream Google Fonts releases. Chinese fonts are subset (fonttools `pyftsubset`) to the characters used by the /stage page copy (`stage.*` keys in `i18n/zh.ts`) plus ASCII digits/punctuation; if copy changes, re-subset with `python3 scripts/subset-stage-fonts.py` (reads the Fontsource slices, subsets with pyftsubset and merges; set FONTSRC to the `@fontsource` folder). Total shipped font weight: ~199 KB.

| File | Family / weight | Source package | License |
|---|---|---|---|
| cormorant-garamond-latin-500.woff2 | Cormorant Garamond 500 (Latin) | @fontsource/cormorant-garamond | OFL-1.1 |
| inter-latin-wght.woff2 | Inter Variable (Latin) | @fontsource-variable/inter | OFL-1.1 |
| geist-mono-latin-wght.woff2 | Geist Mono Variable (Latin) | @fontsource-variable/geist-mono | OFL-1.1 |
| noto-serif-sc-500-subset.woff2 | Noto Serif SC 500 (subset) | @fontsource/noto-serif-sc | OFL-1.1 |
| noto-serif-sc-300-brand.woff2 | Noto Serif SC 300 (the 5 wordmark characters 大白护理站 only) | @fontsource/noto-serif-sc | OFL-1.1 |
| noto-sans-sc-500-subset.woff2, noto-sans-sc-600-subset.woff2 | Noto Sans SC 500 / 600 (subset) | @fontsource/noto-sans-sc | OFL-1.1 |
| ma-shan-zheng-400-subset.woff2 | Ma Shan Zheng 400 (subset, easter-egg line only) | @fontsource/ma-shan-zheng | OFL-1.1 |

OFL-1.1 permits embedding/redistribution and subsetting; the fonts are not sold on their own. Full license text: https://openfontlicense.org (each Fontsource package ships it as LICENSE).
