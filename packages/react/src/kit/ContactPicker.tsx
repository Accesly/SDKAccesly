'use client';

import { useState } from 'react';
import { useContacts } from '../hooks/useContacts.js';
import type { ContactRecord } from '@accesly/core';

/**
 * `<ContactPicker>` — picker compacto de contactos del end-user.
 *
 * Pensado para embeber en `SendFlow`. Si el user no tiene contactos, no se
 * renderiza nada (el SendFlow pinta solo el campo address libre).
 *
 * Props:
 *  - `onPick(contact)`: callback al tap. El caller toma el address o handle
 *    y lo coloca en su input.
 *  - `query`: filtro opcional (matchea por substring de name / handle / address).
 */
export interface ContactPickerProps {
  readonly onPick: (contact: ContactRecord) => void;
  readonly query?: string;
  readonly emptyState?: React.ReactNode;
  readonly className?: string;
}

export function ContactPicker(props: ContactPickerProps): JSX.Element | null {
  const { contacts, isLoading } = useContacts();

  if (isLoading) return null;
  if (contacts.length === 0) {
    return props.emptyState ? (
      <div className={props.className ?? ''}>{props.emptyState}</div>
    ) : null;
  }

  const q = (props.query ?? '').trim().toLowerCase();
  const filtered = q
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.handle?.toLowerCase().includes(q) ||
          c.address?.toLowerCase().includes(q),
      )
    : contacts;

  return (
    <ul className={props.className ?? 'flex gap-2 overflow-x-auto py-1 -mx-2 px-2'}>
      {filtered.map((c) => (
        <li key={c.contactId}>
          <button
            type="button"
            onClick={() => props.onPick(c)}
            className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 min-w-[72px]"
          >
            <Avatar contact={c} />
            <span className="text-[11px] font-medium truncate max-w-[64px]">{c.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Avatar({ contact }: { contact: ContactRecord }) {
  const init = (contact.init ?? contact.name.slice(0, 2)).toUpperCase();
  return (
    <span
      aria-hidden
      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white"
      style={{ background: hashToColor(contact.contactId) }}
    >
      {init}
    </span>
  );
}

function hashToColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
