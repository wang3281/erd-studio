import { createContext, type Dispatch } from "react";
import type { AppState, Action } from "./types";

export const AppStateContext = createContext<AppState | null>(null);
export const AppDispatchContext = createContext<Dispatch<Action> | null>(null);
