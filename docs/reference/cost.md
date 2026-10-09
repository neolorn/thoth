# Cost

What each entry point adds to an application, what the generated contracts and the compiler produce, and what the packages weigh. Every figure is in bytes.

This page is generated from the packages and is not edited by hand.

## How it is measured

Two applications install the built packages and are built for production with the Angular CLI (`@angular/build` 22.2.1), which links the partially compiled runtime and removes what nothing reaches. Compressed sizes are gzip at level 9 and Brotli at quality 11, per file, on Node 26.10.0.

- Minimal consumer: selects the setup, one locale switcher and the recovery message, and nothing else.
- Full consumer: selects routing, forms, server rendering, hydration and the request handler.

The initial files are the browser entry and every file it imports statically. Lazy files are the other browser files, and server files are the server build.

## Entry points

The bytes of each entry point's own module in each build, before compression, as the build's metafile attributes them. An entry point that reaches another counts only its own bytes.

| Entry point                | Minimal consumer, initial | Minimal consumer, lazy | Minimal consumer, server | Full consumer, initial | Full consumer, lazy | Full consumer, server |
| -------------------------- | ------------------------: | ---------------------: | -----------------------: | ---------------------: | ------------------: | --------------------: |
| `@neolorn/equator`         |                   205,384 |                      0 |                        0 |                278,605 |                   0 |               232,947 |
| `@neolorn/equator/core`    |                    28,697 |                      0 |                        0 |                 65,323 |                   0 |               113,868 |
| `@neolorn/equator/forms`   |                         0 |                      0 |                        0 |                  4,385 |                   0 |                 3,549 |
| `@neolorn/equator/http`    |                         0 |                      0 |                        0 |                      0 |                   0 |                 6,162 |
| `@neolorn/equator/router`  |                         0 |                      0 |                        0 |                 38,809 |                   0 |                32,169 |
| `@neolorn/equator/ssr`     |                         0 |                      0 |                        0 |                      0 |                   0 |                   153 |
| `@neolorn/equator/testing` |                         0 |                      0 |                        0 |                      0 |                   0 |                     0 |

## Applications

Everything each build emits, including Angular and the application itself.

| Application      | Part    | Files |     Bytes |    gzip |  Brotli |
| ---------------- | ------- | ----: | --------: | ------: | ------: |
| Minimal consumer | initial |     1 |   326,920 |  98,788 |  85,218 |
| Minimal consumer | lazy    |     4 |     8,758 |   4,299 |   3,521 |
| Minimal consumer | server  |     0 |         0 |       0 |       0 |
| Full consumer    | initial |     1 |   719,840 | 207,823 | 174,018 |
| Full consumer    | lazy    |     6 |    63,161 |  17,537 |  15,407 |
| Full consumer    | server  |    20 | 1,607,798 | 469,704 | 405,368 |

## Generated contracts

The generated code in the initial files, and each lazily loaded catalog: one scope in one locale.

### Minimal consumer

Generated code in the initial files: 13,866 bytes.

| Scope | Locale | Bytes |  gzip | Brotli |
| ----- | ------ | ----: | ----: | -----: |
| shell | ar     | 2,333 | 1,138 |    916 |
| shell | ar-EG  | 2,042 | 1,040 |    851 |
| shell | en-US  | 2,259 | 1,037 |    862 |
| shell | th     | 2,124 | 1,084 |    892 |

### Full consumer

Generated code in the initial files: 51,274 bytes.

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
| Full consumer    |    16 | 179,696 |

## Packages

Each entry point as published, unminified, and each package as installed, source maps and declarations included.

| Entry point                |   Bytes |   gzip | Brotli |
| -------------------------- | ------: | -----: | -----: |
| `@neolorn/equator`         | 409,406 | 85,429 | 69,238 |
| `@neolorn/equator/core`    | 112,458 | 29,563 | 23,945 |
| `@neolorn/equator/forms`   |   7,177 |  2,251 |  1,958 |
| `@neolorn/equator/http`    |  12,432 |  3,811 |  3,310 |
| `@neolorn/equator/router`  |  53,195 | 12,574 | 10,890 |
| `@neolorn/equator/ssr`     |     658 |    310 |    275 |
| `@neolorn/equator/testing` |   8,838 |  3,012 |  2,554 |

| Package                    | Files |     Bytes |
| -------------------------- | ----: | --------: |
| `@neolorn/equator`         |    38 | 3,055,516 |
| `@neolorn/equator-toolkit` |   214 | 3,762,719 |
