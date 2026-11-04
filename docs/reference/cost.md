# Cost

What each entry point adds to an application, what the generated contracts and the compiler produce, and what the packages weigh. Every figure is in bytes.

This page is generated from the packages and is not edited by hand.

## How it is measured

Two applications install the built packages and are built for production with the Angular CLI (`@angular/build` 22.2.5), which links the partially compiled runtime and removes what nothing reaches. Compressed sizes are gzip at level 9 and Brotli at quality 11, per file, on Node 26.13.0.

- Minimal consumer: selects the setup, one locale switcher and the recovery message, and nothing else.
- Full consumer: selects routing, forms, server rendering, hydration and the request handler.

The initial files are the browser entry and every file it imports statically. Lazy files are the other browser files, and server files are the server build.

## Entry points

The bytes of each entry point's own module in each build, before compression, as the build's metafile attributes them. An entry point that reaches another counts only its own bytes.

| Entry point              | Minimal consumer, initial | Minimal consumer, lazy | Minimal consumer, server | Full consumer, initial | Full consumer, lazy | Full consumer, server |
| ------------------------ | ------------------------: | ---------------------: | -----------------------: | ---------------------: | ------------------: | --------------------: |
| `@neolorn/thoth`         |                   222,071 |                      0 |                        0 |                294,840 |                   0 |               252,710 |
| `@neolorn/thoth/core`    |                    30,324 |                      0 |                        0 |                 69,751 |                   0 |               121,154 |
| `@neolorn/thoth/forms`   |                         0 |                      0 |                        0 |                  4,384 |                   0 |                 3,547 |
| `@neolorn/thoth/http`    |                         0 |                      0 |                        0 |                      0 |                   0 |                 6,874 |
| `@neolorn/thoth/router`  |                         0 |                      0 |                        0 |                 41,330 |                   0 |                34,277 |
| `@neolorn/thoth/ssr`     |                         0 |                      0 |                        0 |                      0 |                   0 |                 1,075 |
| `@neolorn/thoth/testing` |                         0 |                      0 |                        0 |                      0 |                   0 |                     0 |

## Locale data in the runtime

The tables the formatters walk where a context names a locale the host has no data for, generated from the pinned CLDR release and measured as they stand in the primary entry point's module. They are why such a locale is written the same way on every host, and they count toward that entry point.

| Table                                                             | Bytes |  gzip | Brotli |
| ----------------------------------------------------------------- | ----: | ----: | -----: |
| The parent locales of the pinned CLDR release, for each component | 4,254 |   845 |    688 |
| The likely script of each language the host may have data for     | 1,999 | 1,127 |    947 |

## Applications

Everything each build emits, including Angular and the application itself.

| Application      | Part    | Files |     Bytes |    gzip |  Brotli |
| ---------------- | ------- | ----: | --------: | ------: | ------: |
| Minimal consumer | initial |     1 |   343,907 | 104,320 |  89,345 |
| Minimal consumer | lazy    |     4 |     8,718 |   4,289 |   3,508 |
| Minimal consumer | server  |     0 |         0 |       0 |       0 |
| Full consumer    | initial |     1 |   742,219 | 214,900 | 179,615 |
| Full consumer    | lazy    |     6 |    63,096 |  17,544 |  15,348 |
| Full consumer    | server  |    20 | 1,407,230 | 416,768 | 358,975 |

## Generated contracts

The generated code in the initial files, and each lazily loaded catalog: one scope in one locale.

### Minimal consumer

Generated code in the initial files: 13,879 bytes.

| Scope | Locale | Bytes |  gzip | Brotli |
| ----- | ------ | ----: | ----: | -----: |
| shell | ar     | 2,323 | 1,135 |    917 |
| shell | ar-EG  | 2,032 | 1,039 |    845 |
| shell | en-US  | 2,249 | 1,033 |    858 |
| shell | th     | 2,114 | 1,082 |    888 |

### Full consumer

Generated code in the initial files: 51,199 bytes.

| Scope | Locale |  Bytes |  gzip | Brotli |
| ----- | ------ | -----: | ----: | -----: |
| lazy  | ar-EG  |    936 |   599 |    493 |
| lazy  | en-US  |    918 |   564 |    465 |
| shell | ar-EG  | 25,938 | 6,362 |  5,502 |
| shell | en-US  | 24,016 | 5,815 |  5,169 |

## Compiler output

What `thoth generate` writes for each application. A second run over unchanged inputs writes nothing, which the consumer stages assert.

| Application      | Files |   Bytes |
| ---------------- | ----: | ------: |
| Minimal consumer |    15 |  42,220 |
| Full consumer    |    16 | 179,477 |

## Packages

Each entry point as published, unminified, and each package as installed, source maps and declarations included.

| Entry point              |   Bytes |   gzip | Brotli |
| ------------------------ | ------: | -----: | -----: |
| `@neolorn/thoth`         | 431,683 | 91,726 | 73,782 |
| `@neolorn/thoth/core`    | 118,728 | 30,874 | 24,982 |
| `@neolorn/thoth/forms`   |   7,167 |  2,248 |  1,952 |
| `@neolorn/thoth/http`    |  13,810 |  4,157 |  3,618 |
| `@neolorn/thoth/router`  |  56,891 | 13,439 | 11,573 |
| `@neolorn/thoth/ssr`     |   1,793 |    685 |    571 |
| `@neolorn/thoth/testing` |   9,669 |  3,223 |  2,770 |

| Package                  | Files |     Bytes |
| ------------------------ | ----: | --------: |
| `@neolorn/thoth`         |    38 | 3,180,249 |
| `@neolorn/thoth-toolkit` |   288 | 4,683,547 |
