/**
 * A per-calendar `days_to_show` narrows one calendar's horizon inside the card's window.
 *
 * The request behind it is a card that lists several calendars at, say, seven days, but
 * wants one noisy calendar — school, a shared team calendar — to reach only a day or two
 * ahead. The card-wide `days_to_show` cannot do this: it belongs to the card, and lowering
 * it would take the week away from every other calendar.
 *
 * Four properties are pinned here:
 *
 * 1. **Unset means the card's window.** `DEFAULT_CONFIG` leaves the key unset, so every
 *    other suite exercises a card where this option is invisible. Each case below sets it
 *    deliberately.
 * 2. **The horizon counts from the card's start date, not from now.** `start_date` moves the
 *    window and the per-calendar horizon moves with it, like `days_to_show` itself.
 * 3. **It reads the display date.** Split segments are judged one by one, so a multi-day
 *    event on a two-day calendar keeps exactly its first two days; an unsplit event that
 *    began before the window is drawn on the window's first day and stays.
 * 4. **It is clamped to the card's `days_to_show`.** The card fetches one window for every
 *    calendar, so a wider per-calendar value has no events to show and would look like a
 *    bug. The two are equal rather than the calendar being widened.
 *
 * Other calendars on the same card are untouched: the option is stamped on the calendar
 * it belongs to via `_matchedConfig`, and the filter reads nothing else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildConfig } from './fixtures';
import * as Config from '../src/config/config';
import type * as Types from '../src/config/types';
import { groupEventsByDay } from '../src/utils/events';

/** Monday 2026-06-15 at 09:00 UTC — mid-month, clear of any month or year boundary. */
const MONDAY = new Date('2026-06-15T09:00:00.000Z');

const DATES = {
  monday: '2026-06-15',
  tuesday: '2026-06-16',
  wednesday: '2026-06-17',
  thursday: '2026-06-18',
  friday: '2026-06-19',
  saturday: '2026-06-20',
  sunday: '2026-06-21',
} as const;

/** A timed event at midday, so no fixture sits near a local midnight by accident. */
function timed(
  summary: string,
  date: string,
  entityId = 'calendar.school',
): Types.CalendarEventData {
  return {
    summary,
    start: { dateTime: `${date}T12:00:00.000Z` },
    end: { dateTime: `${date}T13:00:00.000Z` },
    _entityId: entityId,
  };
}

/** An all-day event. Home Assistant returns these with `date`, and an exclusive end. */
function allDay(summary: string, start: string, endExclusive: string): Types.CalendarEventData {
  return {
    summary,
    start: { date: start },
    end: { date: endExclusive },
    _entityId: 'calendar.school',
  };
}

/**
 * Stamp each event with the calendar settings production would have stamped on it.
 *
 * `processEvents` writes `_matchedConfig` on the fetch path, and `groupEventsByDay` reads
 * the stamp rather than re-deriving it — so a fixture that skips this is testing a code
 * path the card never takes.
 */
function stamped(
  events: Types.CalendarEventData[],
  entity: Partial<Types.EntityConfig>,
): Types.CalendarEventData[] {
  return events.map((event) => ({
    ...event,
    _matchedConfig: { entity: event._entityId, ...entity } as Types.EntityConfig,
  }));
}

/** The date key `groupEventsByDay` buckets a day under, read back off its timestamp. */
function dateKeyOf(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Group a fixture and return the real summaries that survived, keyed by day.
 *
 * Empty-day placeholders are excluded: a calendar the filter empties falls through to the
 * padding and renders a notice on every day, which is not "an event survived".
 */
function render(
  events: Types.CalendarEventData[],
  entity: Partial<Types.EntityConfig>,
  overrides: Partial<Types.Config> = {},
): Record<string, string[]> {
  const config = buildConfig({
    entities: [{ entity: 'calendar.school', ...entity }],
    days_to_show: 7,
    ...overrides,
  } as Partial<Types.Config>);

  const days = groupEventsByDay(stamped(events, entity), config, true, 'en');

  const result: Record<string, string[]> = {};
  for (const day of days) {
    result[dateKeyOf(day.timestamp)] = day.events
      .filter((event) => !event._isEmptyDay)
      .map((event) => event.summary ?? '');
  }
  return result;
}

/** Every real summary the card rendered, in day order, flattened. */
function summaries(rendered: Record<string, string[]>): string[] {
  return Object.keys(rendered)
    .sort()
    .flatMap((key) => rendered[key]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('per-calendar days_to_show: the ordinary case', () => {
  const week = [
    timed('Mon', DATES.monday),
    timed('Tue', DATES.tuesday),
    timed('Wed', DATES.wednesday),
    timed('Thu', DATES.thursday),
  ];

  it('shows the whole card window when the option is unset', () => {
    expect(summaries(render(week, {}))).toEqual(['Mon', 'Tue', 'Wed', 'Thu']);
  });

  it('keeps only the first N days counted from the start date', () => {
    expect(summaries(render(week, { days_to_show: 2 }))).toEqual(['Mon', 'Tue']);
  });

  it('counts the start date as the first day, so 1 is today only', () => {
    expect(summaries(render(week, { days_to_show: 1 }))).toEqual(['Mon']);
  });

  it('moves with start_date rather than counting from now', () => {
    expect(summaries(render(week, { days_to_show: 2 }, { start_date: 'today+1' }))).toEqual([
      'Tue',
      'Wed',
    ]);
  });
});

describe('per-calendar days_to_show: the clamp', () => {
  const week = [
    timed('Mon', DATES.monday),
    timed('Tue', DATES.tuesday),
    timed('Wed', DATES.wednesday),
  ];

  it('never widens the card: a larger value is the card window', () => {
    expect(summaries(render(week, { days_to_show: 30 }, { days_to_show: 2 }))).toEqual([
      'Mon',
      'Tue',
    ]);
  });

  it('is inert when it equals the card window', () => {
    expect(summaries(render(week, { days_to_show: 7 }))).toEqual(['Mon', 'Tue', 'Wed']);
  });
});

describe('per-calendar days_to_show: it reads the display date', () => {
  it('keeps exactly the first N segments of a split multi-day event', () => {
    // Monday through Thursday, exclusive end Friday: four all-day segments once split.
    const conference = [allDay('Conference', DATES.monday, DATES.friday)];

    const rendered = render(conference, { days_to_show: 2, split_multiday_events: true });

    expect(Object.keys(rendered).filter((key) => rendered[key].length > 0)).toEqual([
      DATES.monday,
      DATES.tuesday,
    ]);
  });

  it('keeps an unsplit event that began before the window, drawn on the first day', () => {
    // Started last Thursday, still running: `resolveDisplayDate` clamps it to Monday, and
    // Monday is inside every horizon. A start-date reading would hide it wrongly.
    const carryOver = [allDay('Holiday', '2026-06-11', DATES.wednesday)];

    const rendered = render(carryOver, { days_to_show: 1, split_multiday_events: false });

    expect(rendered[DATES.monday]).toEqual(['Holiday']);
  });
});

describe('per-calendar days_to_show: other calendars are untouched', () => {
  it('narrows only the calendar it is set on', () => {
    const school = [timed('School Mon', DATES.monday), timed('School Wed', DATES.wednesday)];
    const family = [
      timed('Family Mon', DATES.monday, 'calendar.family'),
      timed('Family Sat', DATES.saturday, 'calendar.family'),
    ];

    const config = buildConfig({
      entities: [{ entity: 'calendar.school', days_to_show: 2 }, 'calendar.family'],
      days_to_show: 7,
    } as Partial<Types.Config>);

    const events = [
      ...stamped(school, { days_to_show: 2 }),
      ...family.map((event) => ({
        ...event,
        _matchedConfig: { entity: 'calendar.family' } as Types.EntityConfig,
      })),
    ];

    const days = groupEventsByDay(events, config, true, 'en');
    const kept = days.flatMap((day) => day.events).map((event) => event.summary);

    expect(kept).toEqual(['School Mon', 'Family Mon', 'Family Sat']);
  });
});

describe('per-calendar days_to_show: normalization', () => {
  it('carries a valid value through normalizeEntities', () => {
    const [entity] = Config.normalizeEntities([{ entity: 'calendar.school', days_to_show: 2 }]);
    expect(entity.days_to_show).toBe(2);
  });

  it.each([
    ['an empty string', ''],
    ['zero', 0],
    ['a negative number', -1],
    ['a word', 'two'],
  ])('drops %s rather than letting it empty the calendar', (_label, value) => {
    const [entity] = Config.normalizeEntities([
      { entity: 'calendar.school', days_to_show: value as unknown as number },
    ]);
    expect(entity.days_to_show).toBeUndefined();
  });

  it('accepts a numeric string, as a cleared-then-typed editor field arrives', () => {
    const [entity] = Config.normalizeEntities([
      { entity: 'calendar.school', days_to_show: '3' as unknown as number },
    ]);
    expect(entity.days_to_show).toBe(3);
  });
});
