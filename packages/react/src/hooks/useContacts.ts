'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ContactInput, ContactRecord } from '@accesly/core';
import { AcceslyContext } from '../context.js';

/**
 * Phase 10 (2026-06-29) — `useContacts()`.
 *
 * CRUD para el address book del end-user. La sesión Cognito identifica al
 * dueño — no se requiere pasar userId.
 *
 * Cache local en el hook: tras `add` / `remove` se actualiza el state
 * optimísticamente. Refetch automático sólo al mount.
 */
export interface UseContactsResult {
  readonly contacts: ReadonlyArray<ContactRecord>;
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
  add(input: ContactInput): Promise<ContactRecord>;
  remove(contactId: string): Promise<void>;
}

export function useContacts(): UseContactsResult {
  const ctx = useContext(AcceslyContext);
  if (!ctx) throw new Error('useContacts must be used inside <AcceslyProvider>');

  const [contacts, setContacts] = useState<ReadonlyArray<ContactRecord>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const r = await ctx.endpoints.listContacts();
      if (cancelledRef.current) return;
      setContacts(r.contacts);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!cancelledRef.current) setIsLoading(false);
    }
  }, [ctx]);

  const add = useCallback(
    async (input: ContactInput): Promise<ContactRecord> => {
      const created = await ctx.endpoints.createContact(input);
      setContacts((prev) => [created, ...prev]);
      return created;
    },
    [ctx],
  );

  const remove = useCallback(
    async (contactId: string): Promise<void> => {
      await ctx.endpoints.deleteContact(contactId);
      setContacts((prev) => prev.filter((c) => c.contactId !== contactId));
    },
    [ctx],
  );

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  return { contacts, isLoading, error, refresh, add, remove };
}
