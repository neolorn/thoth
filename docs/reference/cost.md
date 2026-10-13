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
| `@neolorn/equator`         |                   208,416 |                      0 |                        0 |                280,669 |                   0 |               235,627 |
| `@neolorn/equator/core`    |                    29,905 |                      0 |                        0 |                 69,353 |                   0 |               120,293 |
| `@neolorn/equator/forms`   |                         0 |                      0 |                        0 |                  4,383 |                   0 |                 3,549 |
| `@neolorn/equator/http`    |                         0 |                      0 |                        0 |                      0 |                   0 |                 6,789 |
| `@neolorn/equator/router`  |                         0 |                      0 |                        0 |                 41,489 |                   0 |                34,437 |
| `@neolorn/equator/ssr`     |                         0 |                      0 |                        0 |                      0 |                   0 |                   153 |
| `@neolorn/equator/testing` |                         0 |                      0 |                        0 |                      0 |                   0 |                     0 |

## Applications

Everything each build emits, including Angular and the application itself.

| Application      | Part    | Files |     Bytes |    gzip |  Brotli |
| ---------------- | ------- | ----: | --------: | ------: | ------: |
| Minimal consumer | initial |     1 |   330,548 |  99,848 |  86,031 |
| Minimal consumer | lazy    |     4 |     8,758 |   4,299 |   3,521 |
| Minimal consumer | server  |     0 |         0 |       0 |       0 |
| Full consumer    | initial |     1 |   726,819 | 210,064 | 176,067 |
| Full consumer    | lazy    |     6 |    63,164 |  17,543 |  15,415 |
| Full consumer    | server  |    20 | 1,619,885 | 473,207 | 408,414 |

## Generated contracts

The generated code in the initial files, and each lazily loaded catalog: one scope in one locale.

### Minimal consumer

Generated code in the initial files: 13,854 bytes.

| Scope | Locale | Bytes |  gzip | Brotli |
| ----- | ------ | ----: | ----: | -----: |
| shell | ar     | 2,333 | 1,138 |    916 |
| shell | ar-EG  | 2,042 | 1,040 |    851 |
| shell | en-US  | 2,259 | 1,037 |    862 |
| shell | th     | 2,124 | 1,084 |    892 |

### Full consumer

Generated code in the initial files: 51,246 bytes.

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
| `@neolorn/equator`         | 414,118 | 86,697 | 70,077 |
| `@neolorn/equator/core`    | 118,246 | 30,791 | 24,962 |
| `@neolorn/equator/forms`   |   7,177 |  2,251 |  1,958 |
| `@neolorn/equator/http`    |  13,680 |  4,114 |  3,595 |
| `@neolorn/equator/router`  |  57,051 | 13,469 | 11,597 |
| `@neolorn/equator/ssr`     |     658 |    310 |    275 |
| `@neolorn/equator/testing` |   9,654 |  3,218 |  2,753 |

| Package                    | Files |     Bytes |
| -------------------------- | ----: | --------: |
| `@neolorn/equator`         |    38 | 3,137,851 |
| `@neolorn/equator-toolkit` |   222 | 3,878,250 |
