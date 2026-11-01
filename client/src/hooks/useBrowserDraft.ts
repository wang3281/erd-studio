import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { Action, AppState } from "../state/types";
import {
  clearBrowserDraft,
  isBrowserDraftStorageAvailable,
  loadBrowserDraft,
  saveBrowserDraft,
  type BrowserDraft,
} from "../core/storage/draft";

export const BROWSER_DRAFT_DEBOUNCE_MS = 1000;

export type BrowserDraftOffer =
  | { status: "checking" }
  | { status: "offer"; draft: BrowserDraft }
  | { status: "ready" };

/**
 * Keeps changes that have not reached the server in IndexedDB.
 *
 * - While a previous draft is offered for restore, nothing is written or
 *   cleared, so the offered draft cannot be lost by accident.
 * - Dirty schemas are written after a short debounce and flushed on pagehide.
 * - A successful server save (or opening a server project) clears the slot.
 */
export function useBrowserDraft(state: AppState, dispatch: Dispatch<Action>) {
  const [offer, setOffer] = useState<BrowserDraftOffer>({ status: "checking" });
  const schemaRef = useRef(state.schema);
  const persistedRef = useRef(state.persistence.hasPersistedProject);
  const timerRef = useRef<number | null>(null);
  // Serialize storage operations so a clear never races an earlier write.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    schemaRef.current = state.schema;
    persistedRef.current = state.persistence.hasPersistedProject;
  }, [state.schema, state.persistence.hasPersistedProject]);

  const enqueue = useCallback((op: () => Promise<boolean>) => {
    const next = queueRef.current.then(op).then((ok) => {
      dispatch({ type: "SET_BROWSER_DRAFT_AVAILABLE", available: ok });
    });
    queueRef.current = next.catch(() => undefined);
    return next;
  }, [dispatch]);

  const writeNow = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return enqueue(() => saveBrowserDraft(schemaRef.current, { fromServerProject: persistedRef.current }));
  }, [enqueue]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([isBrowserDraftStorageAvailable(), loadBrowserDraft()]).then(([available, draft]) => {
      if (cancelled) return;
      dispatch({ type: "SET_BROWSER_DRAFT_AVAILABLE", available });
      setOffer(draft ? { status: "offer", draft } : { status: "ready" });
    });
    return () => { cancelled = true; };
  }, [dispatch]);

  const { dirty, saveState } = state.persistence;
  const ready = offer.status === "ready";

  useEffect(() => {
    if (!ready || !dirty) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void writeNow();
    }, BROWSER_DRAFT_DEBOUNCE_MS);
  }, [ready, dirty, state.schema, writeNow]);

  useEffect(() => {
    if (!ready || dirty || saveState !== "saved") return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void enqueue(clearBrowserDraft);
  }, [ready, dirty, saveState, enqueue]);

  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      if (timerRef.current !== null) void writeNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, writeNow]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const restore = useCallback(() => {
    if (offer.status !== "offer") return;
    dispatch({ type: "RESTORE_DRAFT", schema: offer.draft.schema });
    setOffer({ status: "ready" });
  }, [dispatch, offer]);

  const discard = useCallback(() => {
    if (offer.status !== "offer") return;
    void enqueue(clearBrowserDraft);
    setOffer({ status: "ready" });
  }, [enqueue, offer]);

  return { offer, restore, discard };
}
