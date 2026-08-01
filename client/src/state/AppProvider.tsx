import { useReducer, type ReactNode } from "react";
import { AppStateContext, AppDispatchContext } from "./context";
import { reducer, createInitialState } from "./reducer";
import { withHistory } from "./history";

const historyReducer = withHistory(reducer);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(historyReducer, undefined, createInitialState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
