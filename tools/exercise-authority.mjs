/**
 * What the consumer's exercise sheet should show, written by the host's own formatters.
 *
 * `specs/12-verification.spec.md` section 8 has formatting checked against an authority Equator did
 * not write. For every value the sheet formats, that authority is the host's `Intl`, handed the
 * inputs the sheet was handed and the options each function's own documentation states. A
 * formatter that picked the wrong digits, the wrong zone, the wrong calendar or the wrong locale
 * would still round-trip through Equator's own parser, and it disagrees with this.
 *
 * Three answers are not the host's to give, and are written out here instead:
 *
 * - the message, which is the translator's, read from the consumer's catalog by the caller;
 * - a person's name, which `Intl` has no formatter for, written by hand from the pinned CLDR
 *   release with the pattern quoted beside it;
 * - which unit a relative time is counted in, which is a rule of Equator's policy rather than of
 *   any locale, worked out by hand from that rule below.
 *
 * It reads nothing outside its argument, so a browser row can hand this function to the engine and
 * compare the page with that engine's own formatters, and the consumer stage can run it on the
 * Node its server ran on.
 */
export function exerciseAuthority({ inputs, locale, catalog }) {
  const context = inputs.formattingContext;
  const tag = new Intl.Locale(locale, {
    numberingSystem: context.numberingSystem,
  }).toString();
  // What a moment is read against: the zone, calendar and hour cycle the application declares.
  const clock = {
    timeZone: context.timeZone,
    calendar: context.calendar,
    hourCycle: context.hourCycle,
  };
  const number = (options, value) =>
    new Intl.NumberFormat(tag, options).format(Number(value));
  const moment = (options, milliseconds) =>
    new Intl.DateTimeFormat(tag, options).format(milliseconds);
  const unsupported = 'unsupported-formatting-capability';

  // A plain date is noon on that day, read in UTC, so no zone can move it to another day.
  const plainDate = ({ year, month, day }) =>
    Date.UTC(year, month - 1, day, 12);
  const plainTime = ({ hour, minute, second }) =>
    Date.UTC(1970, 0, 1, hour, minute, second);
  const plainDateTime = ({ date, time }) =>
    Date.UTC(
      date.year,
      date.month - 1,
      date.day,
      time.hour,
      time.minute,
      time.second,
    );

  const decimal = number(inputs.decimal.options, inputs.decimal.value);
  const money = number(
    {
      ...inputs.money.options,
      style: 'currency',
      currency: inputs.money.currency,
    },
    inputs.money.amount,
  );
  const measurement = number(
    {
      ...inputs.measurement.options,
      style: 'unit',
      unit: inputs.measurement.unit,
    },
    inputs.measurement.amount,
  );
  // A percent is written from the fraction; a value on the percent-unit scale is a hundred times
  // it.
  const percent = number(
    { ...inputs.percent.options, style: 'percent' },
    inputs.percent.scale === 'fractional'
      ? Number(inputs.percent.amount)
      : Number(inputs.percent.amount) / 100,
  );
  // Points are the number itself; the unit is a part of the result, not a character in the text.
  const percentagePoints = number(
    inputs.percentagePoints.options,
    inputs.percentagePoints.amount,
  );
  const instant = moment(
    { ...inputs.instant.options, ...clock },
    inputs.instant.epochMilliseconds,
  );
  const date = moment(
    { ...inputs.plainDate.options, timeZone: 'UTC' },
    plainDate(inputs.plainDate),
  );
  const time = moment(
    {
      ...inputs.plainTime.options,
      timeZone: 'UTC',
      hourCycle: context.hourCycle,
    },
    plainTime(inputs.plainTime),
  );
  const dateTime = moment(
    {
      ...inputs.plainDateTime.options,
      timeZone: 'UTC',
      hourCycle: context.hourCycle,
    },
    plainDateTime(inputs.plainDateTime),
  );
  const zoned = moment(
    {
      ...inputs.zonedDateTime.options,
      ...clock,
      timeZone: inputs.zonedDateTime.timeZone,
    },
    inputs.zonedDateTime.epochMilliseconds,
  );
  // Node 22 has no duration formatter. There the sheet shows the typed result Equator returns in
  // its place, and a pipe shows nothing, which is what section 3 of
  // `specs/08-formatting-parsing-and-domain.spec.md` has a runtime without the capability do.
  const hostWritesDurations = typeof Intl.DurationFormat === 'function';
  const duration = hostWritesDurations
    ? new Intl.DurationFormat(tag, inputs.duration.options).format(
        inputs.duration.fields,
      )
    : undefined;

  // `largestUnit: 'week'` and a target three days before the reference: three days is short of a
  // week and at least a day, so the policy counts it in days, truncated toward zero, as -3.
  const resolved = { value: -3, unit: 'day' };

  // `en` givenFirst/medium/referring/informal is `{given-informal} {surname}`, and the name
  // carries no informal given name, so the given name stands in. `ar` defaults to long and formal,
  // and givenFirst/long/referring/formal is
  // `{title} {given} {given2} {surname} {generation}، {credentials}`; everything after the surname
  // is empty, and the Arabic comma goes with it.
  const personNames = {
    'en-US': 'Mary Hamish',
    'ar-EG': 'محمد المصري',
  };

  const localizedInput = inputs.localizedInput;

  return {
    localize: catalog[inputs.message],
    localizedDecimal: decimal,
    localizedMoney: money,
    localizedMeasurement: measurement,
    localizedPercent: percent,
    localizedPercentagePoints: percentagePoints,
    localizedInstant: instant,
    localizedPlainDate: date,
    localizedPlainTime: time,
    localizedPlainDateTime: dateTime,
    localizedZonedDateTime: zoned,
    localizedDuration: duration ?? '',

    formatNumber: decimal,
    formatMoney: money,
    formatMeasurement: measurement,
    formatPercent: percent,
    formatPercentagePoints: percentagePoints,
    formatInstant: instant,
    formatPlainDate: date,
    formatPlainTime: time,
    formatPlainDateTime: dateTime,
    formatZonedDateTime: zoned,
    formatDuration: duration ?? unsupported,
    formatNumberRange: new Intl.NumberFormat(
      tag,
      inputs.numberRange.options,
    ).formatRange(
      Number(inputs.numberRange.start),
      Number(inputs.numberRange.end),
    ),
    formatInstantRange: new Intl.DateTimeFormat(tag, {
      ...inputs.instantRange.options,
      ...clock,
    }).formatRange(
      inputs.instantRange.startEpochMilliseconds,
      inputs.instantRange.endEpochMilliseconds,
    ),
    formatList: new Intl.ListFormat(locale, inputs.list.options).format(
      inputs.list.values,
    ),
    formatRelativeTime: new Intl.RelativeTimeFormat(
      tag,
      inputs.relativeTime.options,
    ).format(Number(inputs.relativeTime.value), inputs.relativeTime.unit),
    resolveRelativeTime: new Intl.RelativeTimeFormat(
      tag,
      inputs.resolvedRelativeTime.options,
    ).format(resolved.value, resolved.unit),
    formatDisplayName: new Intl.DisplayNames(
      locale,
      inputs.displayName.options,
    ).of(inputs.displayName.value),
    selectPlural: new Intl.PluralRules(locale, inputs.plural.options).select(
      Number(inputs.plural.value),
    ),
    compareLocalized: [...inputs.collation.values]
      .sort(new Intl.Collator(locale, inputs.collation.options).compare)
      .join(' | '),
    segmentText: [
      ...new Intl.Segmenter(locale, inputs.segmentation.options).segment(
        inputs.segmentation.text,
      ),
    ]
      .map(({ segment }) => segment)
      .join('|'),
    formatPersonName: personNames[locale],
    // An input field writes its number without grouping unless its profile allows it.
    formatLocalizedInput: number(
      {
        style: 'currency',
        currency: localizedInput.profile.currency,
        useGrouping: false,
      },
      localizedInput.amount,
    ),
    parseLocalizedInput: `${localizedInput.amount} ${localizedInput.profile.currency}`,
  };
}
