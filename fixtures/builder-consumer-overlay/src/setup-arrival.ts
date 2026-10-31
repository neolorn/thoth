// Named by the setupFiles option of the Angular unit-test target in angular.json, and by nothing else,
// so the spec beside it passes only when that option reached Angular through Thoth's test builder.
(globalThis as Record<string, unknown>)['thothSetupArrival'] = 'angular-test';

export {};
