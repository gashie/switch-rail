import { describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { toastSlice, showToast, dismissToast, clearToasts } from '../toast-slice.js';

const makeStore = () =>
  configureStore({ reducer: { toasts: toastSlice.reducer } });

describe('toast-slice', () => {
  it('starts empty', () => {
    const s = makeStore();
    expect(s.getState().toasts.items).toEqual([]);
  });

  it('adds toasts via showToast and assigns ids', () => {
    const s = makeStore();
    s.dispatch(showToast({ kind: 'success', message: 'Saved' }));
    s.dispatch(showToast({ kind: 'error', message: 'Boom' }));
    const items = s.getState().toasts.items;
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe('success');
    expect(items[0].message).toBe('Saved');
    expect(items[0].id).toBeDefined();
    expect(items[1].id).not.toBe(items[0].id);
  });

  it('dismisses a single toast by id', () => {
    const s = makeStore();
    s.dispatch(showToast({ kind: 'info', message: 'A' }));
    s.dispatch(showToast({ kind: 'info', message: 'B' }));
    const [first] = s.getState().toasts.items;
    s.dispatch(dismissToast(first.id));
    expect(s.getState().toasts.items.map((t) => t.message)).toEqual(['B']);
  });

  it('clearToasts wipes everything', () => {
    const s = makeStore();
    s.dispatch(showToast({ kind: 'info', message: 'A' }));
    s.dispatch(showToast({ kind: 'info', message: 'B' }));
    s.dispatch(clearToasts());
    expect(s.getState().toasts.items).toEqual([]);
  });

  it('defaults ttl to 4000ms', () => {
    const s = makeStore();
    s.dispatch(showToast({ kind: 'info', message: 'X' }));
    expect(s.getState().toasts.items[0].ttl).toBe(4000);
  });
});
