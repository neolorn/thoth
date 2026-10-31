// Read by the Angular unit-test target, whose runnerConfig option is true. The JSON report it asks
// for is written only when the reporters set here reach Vitest.
export default {
  test: {
    reporters: [
      'default',
      ['json', { outputFile: 'runner-config-report.json' }],
    ],
  },
};
