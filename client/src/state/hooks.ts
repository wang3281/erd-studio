import { useContext, type Dispatch } from "react";
import type { AppState, Action } from "./types";
import { AppStateContext, AppDispatchContext } from "./context";

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

export function useAppDispatch(): Dispatch<Action> {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be used within AppProvider");
  return ctx;
}
