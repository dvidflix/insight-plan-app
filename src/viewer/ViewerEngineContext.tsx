import { createContext, useContext, useRef, type ReactNode } from 'react';
import { ViewerEngine } from './ViewerEngine';

const ViewerEngineCtx = createContext<ViewerEngine | null>(null);

export function ViewerEngineProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<ViewerEngine>();
  if (!engineRef.current) engineRef.current = new ViewerEngine();
  return <ViewerEngineCtx.Provider value={engineRef.current}>{children}</ViewerEngineCtx.Provider>;
}

export function useViewerEngine() {
  const engine = useContext(ViewerEngineCtx);
  if (!engine) throw new Error('useViewerEngine must be used within a ViewerEngineProvider');
  return engine;
}
