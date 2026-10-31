describe('the Angular unit-test target', () => {
  it('runs the setup file its setupFiles option names', () => {
    expect((globalThis as Record<string, unknown>)['thothSetupArrival']).toBe(
      'angular-test',
    );
  });
});
