// The year inputs must show the range that is actually applied: an inverted, out-of-range or emptied
// entry is clamped, and the clamped value has to be written back when the field loses focus.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Filters from '../../src/components/Filters';

const THIS_YEAR = new Date().getUTCFullYear();

const show = (onYears: (y: [number, number]) => void) =>
  render(
    <Filters
      events={[]} context={[]} visible={new Set()} showContext={false} onSetVisible={() => undefined} onShowContext={() => undefined}
      activeCatalogs={new Set()} catalogCounts={{}} catalogErrors={{}}
      onToggleCatalog={() => undefined} years={[1900, THIS_YEAR]} onYears={onYears} onClose={() => undefined}
    />,
  );
const from = () => screen.getByLabelText('From year') as HTMLInputElement;
const to = () => screen.getByLabelText('To year') as HTMLInputElement;
const type = (el: HTMLInputElement, value: string) => fireEvent.change(el, { target: { value } });
const pause = () => act(() => { vi.advanceTimersByTime(300); });

describe('Filters: year range inputs show the applied range', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('writes the clamped range back on blur when From is after To', () => {
    const onYears = vi.fn();
    show(onYears);
    type(from(), '2020');
    type(to(), '2010');
    pause();
    expect(onYears).toHaveBeenLastCalledWith([2020, 2020]);
    fireEvent.blur(to());
    expect(from().value).toBe('2020');
    expect(to().value).toBe('2020');
  });

  it('shows 1900 after blur when From is before the supported range', () => {
    const onYears = vi.fn();
    show(onYears);
    type(from(), '1800');
    pause();
    fireEvent.blur(from());
    expect(from().value).toBe('1900');
    expect(to().value).toBe(String(THIS_YEAR));
  });

  it('shows the current year after blur when To is in the future or emptied', () => {
    const onYears = vi.fn();
    show(onYears);
    type(to(), String(THIS_YEAR + 4));
    pause();
    fireEvent.blur(to());
    expect(to().value).toBe(String(THIS_YEAR));
    type(to(), '');
    pause();
    fireEvent.blur(to());
    expect(to().value).toBe(String(THIS_YEAR));
  });

  it('applies and shows the range when the blur lands before the typing pause ends', () => {
    const onYears = vi.fn();
    show(onYears);
    type(from(), '2020');
    type(to(), '2010');
    fireEvent.blur(to());
    expect(onYears).toHaveBeenCalledTimes(1);
    expect(onYears).toHaveBeenLastCalledWith([2020, 2020]);
    expect(to().value).toBe('2020');
    pause();
    expect(onYears).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite a partly typed year while the field still has focus', () => {
    const onYears = vi.fn();
    show(onYears);
    type(from(), '19');
    pause();
    expect(from().value).toBe('19');
  });
});
