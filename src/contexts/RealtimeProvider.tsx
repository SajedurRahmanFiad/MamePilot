import React, { createContext, useContext } from 'react';

interface RealtimeContextType {
  isConnected: boolean;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <RealtimeContext.Provider value={{ isConnected: false }}>
      {children}
    </RealtimeContext.Provider>
  );
};

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useRealtime must be used within RealtimeProvider');
  }
  return ctx;
}

export { RealtimeContext };
