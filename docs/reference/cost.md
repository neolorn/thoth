# Cost

What each entry point adds to an application, what the generated contracts and the compiler produce, and what the packages weigh. Every figure is in bytes.

This page is generated from the packages and is not edited by hand.

## How it is measured

Two applications install the built packages and are built for production with the Angular CLI (`@angular/build` 22.1.9), which links the partially compiled runtime and removes what nothing reaches. Compressed sizes are gzip at level 9 and Brotli at quality 11, per file, on Node 24.18.0.

- Minimal consumer: selects the setup, one locale switcher and the recovery message, and nothing else.
- Full consumer: selects routing, forms, server rendering, hydration and the request handler.

The initial files are the browser entry and every file it imports statically. Lazy files are the other browser files, and server files are the server build.

## Entry points

The bytes of each entry point's own module in each build, before compression, as the build's metafile attributes them. An entry point that reaches another counts only its own bytes.

| Entry point                | Minimal consumer, initial | Minimal consumer, lazy | Minimal consumer, server | Full consumer, initial | Full consumer, lazy | Full consumer, server |
| -------------------------- | ------------------------: | ---------------------: | -----------------------: | ---------------------: | ------------------: | --------------------: |
| `@neolorn/equator`         |                   204,465 |                      0 |                        0 |                263,881 |                   0 |               219,730 |
| `@neolorn/equator/core`    |                    28,847 |                      0 |                        0 |                 64,983 |                   0 |               112,348 |
| `@neolorn/equator/forms`   |                         0 |                      0 |                        0 |                  4,425 |                   0 |                 3,582 |
| `@neolorn/equator/http`    |                         0 |                      0 |                        0 |                      0 |                   0 |                 6,191 |
| `@neolorn/equator/router`  |                         0 |                      0 |                        0 |                 38,562 |                   0 |                31,978 |
| `@neolorn/equator/ssr`     |                         0 |                      0 |                        0 |                      0 |                   0 |                   157 |
| `@neolorn/equator/testing` |                         0 |                      0 |                        0 |                      0 |                   0 |                     0 |

## Applications

Everything each build emits, including Angular and the application itself.

| Application      | Part    | Files |     Bytes |    gzip |  Brotli |
| ---------------- | ------- | ----: | --------: | ------: | ------: |
| Minimal consumer | initial |     1 |   327,953 |  98,988 |  85,135 |
| Minimal consumer | lazy    |     4 |     8,758 |   4,299 |   3,521 |
| Minimal consumer | server  |     0 |         0 |       0 |       0 |
| Full consumer    | initial |     1 |   705,676 | 202,273 | 169,376 |
| Full consumer    | lazy    |     6 |    63,193 |  17,539 |  15,371 |
| Full consumer    | server  |    20 | 1,664,089 | 496,821 | 428,515 |

## Generated contracts

The generated code in the initial files, and each lazily loaded catalog: one scope in one locale.

### Minimal consumer

Generated code in the initial files: 13,871 bytes.

| Scope | Locale | Bytes |  gzip | Brotli |
| ----- | ------ | ----: | ----: | -----: |
| shell | ar     | 2,333 | 1,138 |    916 |
| shell | ar-EG  | 2,042 | 1,040 |    851 |
| shell | en-US  | 2,259 | 1,037 |    862 |
| shell | th     | 2,124 | 1,084 |    892 |

### Full consumer

Generated code in the initial files: 50,845 bytes.

| Scope | Locale |  Bytes |  gzip | Brotli |
| ----- | ------ | -----: | ----: | -----: |
| lazy  | ar-EG  |    944 |   603 |    493 |
| lazy  | en-US  |    926 |   568 |    464 |
| shell | ar-EG  | 25,962 | 6,353 |  5,514 |
| shell | en-US  | 24,040 | 5,807 |  5,170 |

## Compiler output

What `equator generate` writes for each application. A second run over unchanged inputs writes nothing, which the consumer stages assert.

| Application      | Files |   Bytes |
| ---------------- | ----: | ------: |
| Minimal consumer |    15 |  42,310 |
| Full consumer    |    16 | 179,312 |

## Packages

Each entry point as published, unminified, and each package as installed, source maps and declarations included.

| Entry point                |   Bytes |    gzip |  Brotli |
| -------------------------- | ------: | ------: | ------: |
| `@neolorn/equator`         | 683,351 | 160,034 | 127,422 |
| `@neolorn/equator/core`    | 229,804 |  65,722 |  53,832 |
| `@neolorn/equator/forms`   |  18,180 |   5,707 |   4,845 |
| `@neolorn/equator/http`    |  31,904 |   9,876 |   8,478 |
| `@neolorn/equator/router`  | 153,267 |  43,297 |  35,164 |
| `@neolorn/equator/ssr`     |   3,215 |   1,430 |   1,144 |
| `@neolorn/equator/testing` |  20,924 |   6,964 |   5,871 |

| Package                    | Files |     Bytes |
| -------------------------- | ----: | --------: |
| `@neolorn/equator`         |    38 | 3,804,611 |
| `@neolorn/equator-toolkit` |   214 | 3,732,778 |
